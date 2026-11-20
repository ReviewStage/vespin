/**
 * thread-dms.ts -- the DMs our Slack bot wrote members about the inbox threads that waited on them, which it writes no more, still answered and pressed.
 *
 * The bot once wrote the member a thread waited on a DM saying its title,
 * and each post of the agent's as a reply in that DM's Slack thread, each
 * kept on the agent's message it said (`inbox_message.slack_dm`). It writes
 * none now and rewrites none on its own, since an agent sends what it wants
 * in Slack itself (`send_slack_message`); the DMs already written keep
 * working. A member's reply in a DM's Slack thread is found back to its
 * thread by that DM (`threadDmAt`) and posted there as their own reply
 * (`slack-agent-starts.ts`). A DM's buttons still answer its ask: a decide
 * ask that takes one option offers each as a button (`SlackChoice`), and one
 * that takes several offers checkboxes with a Submit button, whose press
 * names the ticked ones by their place among the options
 * (`SLACK_PICKS_ACTION`); a do ask offers Mark done and Couldn't do it. Our
 * Slack route answers the ask with any of these (`slack-events-app.ts`) and
 * rewrites the DM pressed to say what came of it (`rewriteThreadDm`), a
 * press on a title DM drawing the title again with the ask still open on
 * it, if any.
 *
 * Every call here waits on Slack, so it is never yielded inside a
 * transaction; a runtime that holds no bot, such as a test's, writes
 * nothing.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { Database } from "@repo/database/core/query";
import { organization } from "@repo/database/schemas/auth";
import { inboxItem } from "@repo/database/schemas/inbox";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_REPLY,
  type InboxReadAsk,
  inboxReadAskSchema,
  knownAsk,
} from "@repo/features/inbox-wire";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import {
  type SlackBlock,
  SlackBot,
  type SlackMessage,
  type SlackMessageContent,
  type SlackWorkspaceBot,
} from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";

/** Slack's own limits a DM's parts are clipped to: a header's text, a button's, and a checkbox's. */
const SLACK_TEXT_BOUND = { HEADER: 150, BUTTON: 75, OPTION: 75 } as const;

/** What a thread's title DM says before its title, so the DM reads as the inbox's. */
const TITLE_PREFIX = "📥 ";

/** The most of an open ask's words a title DM says under its title; its reply in the Slack thread says them whole. */
const OPEN_ASK_PREVIEW_CHARS = 500;

/** What a checkbox says after its label, in parentheses, where the agent recommends it. */
const RECOMMENDED_NOTE = " (Recommended)";

/** The words on the button that answers an ask taking several options with the ones ticked. */
const SUBMIT_LABEL = "Submit";

/**
 * The action id of the checkboxes an ask taking several options is drawn
 * with, which the route reads the ticked ones under in a press's state;
 * each checkbox's value is its option's place among the ask's options.
 */
export const SLACK_PICKS_ACTION = "picks";

/** The answers a do ask's buttons give: Mark done and Couldn't do it. */
const SLACK_DO_REPLIES = [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE] as const;

/** A do ask's answer as its button gives it. */
type SlackDoReply = (typeof SLACK_DO_REPLIES)[number];

/** The words on a do ask's buttons, by the answer each gives, as the app words them. */
const DO_BUTTON = {
  [INBOX_REPLY.DONE]: "Mark done",
  [INBOX_REPLY.NOT_DONE]: "Couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

/** What a settled DM says once its member answered its do ask from it, by the answer. */
const DO_LINE = {
  [INBOX_REPLY.DONE]: "You marked it done",
  [INBOX_REPLY.NOT_DONE]: "You couldn't do it",
} as const satisfies Record<SlackDoReply, string>;

/** The indent that keeps a step's later lines, a fenced block's among them, inside its numbered item. */
const STEP_INDENT = "   ";

/** What a settled DM says in its button's place, by where its ask now stands. */
const SETTLED_LINE = {
  [INBOX_ASK_STATUS.ANSWERED]: `Answered in ${PRODUCT_NAME}`,
  [INBOX_ASK_STATUS.WITHDRAWN]: "Withdrawn",
  [INBOX_ASK_STATUS.REPLACED]: "Replaced by a newer ask",
} as const;

/** What a settled DM says once its member chose options from it. */
export function chosenLine(labels: readonly string[]): string {
  return `You chose ${labels.join(", ")}`;
}

/** What a settled DM says once its member answered its do ask from it. */
export function doneLine(reply: SlackDoReply): string {
  return DO_LINE[reply];
}

/**
 * What a button carries back when pressed: the item, the message whose ask
 * it answers, and an option's label, or a do ask's answer, or neither for
 * the Submit of an ask taking several, whose picks the press's checkboxes
 * hold; as JSON in the button's value, which Slack bounds at 2,000
 * characters, far past two ids and a label.
 */
export const SlackChoiceSchema = Schema.fromJsonString(
  Schema.Struct({
    item: Schema.String,
    ask: Schema.String,
    choice: Schema.optionalKey(Schema.String),
    reply: Schema.optionalKey(Schema.Literals(SLACK_DO_REPLIES)),
  }),
);

/** A press of an option's button, a do ask's, or a Submit, as `SlackChoiceSchema` reads it. */
export type SlackChoice = typeof SlackChoiceSchema.Type;

/** What an open ask is drawn with in its DM: blocks of their own above the buttons, and buttons beside the open one. */
interface AskControls {
  readonly blocks: readonly SlackBlock[];
  readonly buttons: readonly SlackBlock[];
}

const NO_CONTROLS: AskControls = { blocks: [], buttons: [] };

/** What a reply about a thread is drawn from. */
interface ThreadDmView {
  readonly title: string;
  /** The agent's words, in Markdown. */
  readonly text: string;
  readonly link: string;
  /** Whether the DM stands alone, as one from before the title DM did, so says the title as its header. */
  readonly titled?: boolean;
}

/** A do ask's steps, as the message's ask names them; none for any other ask. */
function askSteps(ask: InboxReadAsk | undefined): readonly string[] {
  const known = ask === undefined ? undefined : knownAsk(ask);

  return known?.type === INBOX_ASK.DO ? known.steps : [];
}

/** The agent's words with a do ask's steps listed under them, numbered, each step's later lines kept inside its item. */
function wordsWithSteps(text: string, steps: readonly string[]): string {
  if (steps.length === 0) return text;

  const list = steps.map(
    (step, at) => `${at + 1}. ${step.trim().replaceAll("\n", `\n${STEP_INDENT}`)}`,
  );

  return [text.trim(), ...list].filter((part) => part !== "").join("\n\n");
}

/**
 * The controls of an open decide ask: a button per option where it takes
 * one, the recommended ones primary, each under an action id of its own,
 * which the route answers the ask under, so a press Slack sends again is the
 * same answer; where it takes several, a checkbox per option, the
 * recommended ones saying so in parentheses after the label, and a Submit
 * button under an action id of its own on the same terms. An open do ask's
 * Mark done and Couldn't do it, each under an action id of its own. None for
 * any other ask.
 */
function askControls(
  itemId: string,
  message: { readonly id: string; readonly ask?: InboxReadAsk | undefined },
): AskControls {
  if (message.ask === undefined || message.ask.status !== INBOX_ASK_STATUS.OPEN) {
    return NO_CONTROLS;
  }

  const ask = knownAsk(message.ask);

  if (ask?.type === INBOX_ASK.DO) {
    const buttons = SLACK_DO_REPLIES.map((reply) => ({
      type: "button",
      text: { type: "plain_text", text: DO_BUTTON[reply] },
      action_id: randomUUID(),
      value: Schema.encodeSync(SlackChoiceSchema)({ item: itemId, ask: message.id, reply }),
      ...(reply === INBOX_REPLY.DONE ? { style: "primary" } : undefined),
    }));

    return { blocks: [], buttons };
  }

  if (ask?.type !== INBOX_ASK.DECIDE) return NO_CONTROLS;

  const recommended = new Set([
    ...(ask.recommended === undefined ? [] : [ask.recommended]),
    ...(ask.recommendations ?? []),
  ]);

  const value = (choice?: string) =>
    Schema.encodeSync(SlackChoiceSchema)({
      item: itemId,
      ask: message.id,
      ...(choice === undefined ? undefined : { choice }),
    });

  if (ask.multiple !== true) {
    const buttons = ask.options.map(({ label }) => ({
      type: "button",
      text: { type: "plain_text", text: slackClipped(label, SLACK_TEXT_BOUND.BUTTON) },
      action_id: randomUUID(),
      value: value(label),
      ...(recommended.has(label) ? { style: "primary" } : undefined),
    }));

    return { blocks: [], buttons };
  }

  // Note that a recommended label is clipped short of its note, so the note always shows.
  const options = ask.options.map(({ label }, index) => {
    const note = recommended.has(label) ? RECOMMENDED_NOTE : "";
    const text = `${slackClipped(label, SLACK_TEXT_BOUND.OPTION - note.length)}${note}`;

    return { text: { type: "plain_text", text }, value: String(index) };
  });

  return {
    blocks: [
      {
        type: "actions",
        elements: [{ type: "checkboxes", action_id: SLACK_PICKS_ACTION, options }],
      },
    ],
    buttons: [
      {
        type: "button",
        text: { type: "plain_text", text: SUBMIT_LABEL },
        action_id: randomUUID(),
        value: value(),
        style: "primary",
      },
    ],
  };
}

/** A thread's title, after the inbox's emoji, as a DM's header block. */
function titleHeader(title: string): SlackBlock {
  const text = slackClipped(`${TITLE_PREFIX}${title}`, SLACK_TEXT_BOUND.HEADER);

  return { type: "header", text: { type: "plain_text", text } };
}

/** The button that opens the thread in the app, by its link. */
function openButton(link: string): SlackBlock {
  return {
    type: "button",
    text: { type: "plain_text", text: `Open in ${PRODUCT_NAME}` },
    url: link,
  };
}

/**
 * The DM a thread's Slack thread stands under: its title as the header, the
 * open ask's words under it where given, clipped short, the ask's own
 * controls, its options or Mark done, and the open button. Note that the
 * button stands whether an ask is open or not, and the ask's controls while
 * it is, because the title DM is what a member scanning their DMs sees, and
 * the reply that carries them too is a press further in.
 */
function titleDmContent(
  title: string,
  link: string,
  openAsk = "",
  controls: AskControls = NO_CONTROLS,
): SlackMessageContent {
  const words = openAsk.trim();

  return {
    text: `${TITLE_PREFIX}${title}`,
    blocks: [
      titleHeader(title),
      ...(words === "" ? [] : [slackMarkdownBlock(words, OPEN_ASK_PREVIEW_CHARS)]),
      ...controls.blocks,
      { type: "actions", elements: [...controls.buttons, openButton(link)] },
    ],
  };
}

/**
 * The reply a post is written as under its thread's title DM: the agent's
 * words in a `markdown` block, any checkboxes of its ask, and the open
 * button after any other button of its ask; a settled one says where its ask
 * stands, in the line given, above the button. Note that the title is left
 * out of the blocks, since the DM above says it, and kept in the text Slack
 * notifies with, which says no thread of its own; a DM that stands alone
 * keeps it as its header.
 */
function threadDmContent(
  view: ThreadDmView,
  line?: string,
  controls: AskControls = NO_CONTROLS,
): SlackMessageContent {
  const words = view.text.trim();

  const blocks: SlackBlock[] = [
    ...(view.titled === true ? [titleHeader(view.title)] : []),
    ...(words === "" ? [] : [slackMarkdownBlock(words)]),
    ...(line === undefined
      ? []
      : [{ type: "context", elements: [{ type: "plain_text", text: line }] }]),
    ...controls.blocks,
    {
      type: "actions",
      elements: [...controls.buttons, openButton(view.link)],
    },
  ];

  return { text: line === undefined ? view.title : `${view.title} · ${line}`, blocks };
}

/** What an item's DMs are drawn with beside a message's words: its title, its agent, and its workspace, by id and by the slug its links are written under. */
const findItemPlace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({
    title: Schema.String,
    agentId: Schema.String,
    organizationId: Schema.String,
    step: Schema.String,
  }),
  execute: (itemId) =>
    Database.use((db) =>
      db
        .select({
          title: inboxItem.title,
          agentId: inboxItem.agentId,
          organizationId: inboxItem.organizationId,
          step: organization.slug,
        })
        .from(inboxItem)
        .innerJoin(organization, eq(organization.id, inboxItem.organizationId))
        .where(eq(inboxItem.id, itemId)),
    ),
});

/** A DM as a message keeps it: where it is, the member it went to, the DM whose thread a reply stands in, and whether its ask has settled. */
const SlackDmSchema = Schema.Struct({
  channel: Schema.String,
  ts: Schema.String,
  to: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(Schema.String),
  settled: Schema.optionalKey(Schema.Boolean),
});

/** The DM kept on a message, by the message's id; nothing where none was written. */
const findMessageDm = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ dm: SlackDmSchema }),
  execute: (messageId) =>
    Database.use((db) =>
      db
        .select({ dm: inboxMessage.slackDm })
        .from(inboxMessage)
        .where(and(eq(inboxMessage.id, messageId), isNotNull(inboxMessage.slackDm))),
    ),
});

/** Where a title DM is, by its conversation and timestamp. */
interface TitleDm {
  readonly channel: string;
  readonly ts: string;
}

/**
 * The item's message whose reply stands in the Slack thread under the title
 * DM and whose ask stands open: its id, its words, and its ask; nothing
 * where none does, so another member's DM never says an ask that waits on
 * someone else.
 */
const findOpenAskAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ itemId: Schema.String, channel: Schema.String, ts: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, text: Schema.String, ask: inboxReadAskSchema }),
  execute: ({ itemId, channel, ts }) =>
    Database.use((db) =>
      db
        .select({ id: inboxMessage.id, text: inboxMessage.text, ask: inboxMessage.ask })
        .from(inboxMessage)
        .where(
          and(
            eq(inboxMessage.itemId, itemId),
            sql`${inboxMessage.slackDm} ->> 'channel' = ${channel}`,
            sql`${inboxMessage.slackDm} ->> 'thread' = ${ts}`,
            sql`${inboxMessage.ask} ->> 'status' = ${INBOX_ASK_STATUS.OPEN}`,
          ),
        )
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

/** A DM of the item's in the Slack thread under the DM that opened it, by that DM's conversation and timestamp: its item, that item's workspace, and the DM as kept. */
const findDmAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ channel: Schema.String, ts: Schema.String }),
  Result: Schema.Struct({
    itemId: Schema.String,
    organizationId: Schema.String,
    dm: SlackDmSchema,
  }),
  execute: ({ channel, ts }) =>
    Database.use((db) =>
      db
        .select({
          itemId: inboxMessage.itemId,
          organizationId: inboxItem.organizationId,
          dm: inboxMessage.slackDm,
        })
        .from(inboxMessage)
        .innerJoin(inboxItem, eq(inboxItem.id, inboxMessage.itemId))
        .where(
          and(
            sql`${inboxMessage.slackDm} ->> 'channel' = ${channel}`,
            sql`coalesce(${inboxMessage.slackDm} ->> 'thread', ${inboxMessage.slackDm} ->> 'ts') = ${ts}`,
          ),
        )
        .orderBy(desc(inboxMessage.createdAt))
        .limit(1),
    ),
});

/**
 * Rewrites each title DM to say the open ask whose reply stands in its Slack
 * thread under the item's title, with that ask's controls, or the title alone
 * where none does, with the thread's link, as `titleDmContent` draws it.
 */
function redrawTitleDms(
  bot: SlackWorkspaceBot,
  itemId: string,
  thread: { readonly title: string; readonly link: string },
  titles: readonly TitleDm[],
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.forEach(
    titles,
    (at) =>
      Effect.flatMap(findOpenAskAt({ itemId, ...at }), (open) => {
        const content = Option.match(open, {
          onNone: () => titleDmContent(thread.title, thread.link),
          onSome: (message) =>
            titleDmContent(
              thread.title,
              thread.link,
              wordsWithSteps(message.text, askSteps(message.ask)),
              askControls(itemId, message),
            ),
        });

        return bot.update(at.channel, at.ts, content);
      }),
    { discard: true },
  );
}

/** The item's link by its id alone, whose agent and task a reader asks the service for. */
function threadLink(itemId: string, place: { readonly step: string }) {
  return linkOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId }, place.step);
}

/** The workspace an item is in, which a press from Slack finds its member under; nothing for an item that is gone. */
export function itemWorkspace(
  itemId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findItemPlace(itemId),
    Option.map((place) => place.organizationId),
  );
}

/**
 * The thread a Slack thread stands under where its first message is a DM
 * the bot wrote about one: the item, its workspace, and the member the DM
 * went to, where it was kept; nothing for any other Slack thread.
 */
export function threadDmAt(
  channel: string,
  threadTs: string,
): Effect.Effect<
  Option.Option<{
    readonly itemId: string;
    readonly organizationId: string;
    readonly to: string | undefined;
  }>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.map(
    findDmAt({ channel, ts: threadTs }),
    Option.map(({ itemId, organizationId, dm }) => ({ itemId, organizationId, to: dm.to })),
  );
}

/**
 * Rewrites one DM the bot wrote about the item's message to say the line
 * given in its buttons' place, as a press on an ask already settled is
 * told, keeping the title of one that stands alone; a press on the title DM
 * the message's reply stands under draws that title DM again, as
 * `redrawTitleDms` does, so it keeps its title and says the ask open now,
 * if any; nothing where the runtime holds no bot or the item is gone.
 */
export function rewriteThreadDm(
  dm: SlackMessage,
  itemId: string,
  message: {
    readonly id: string;
    readonly text: string;
    readonly ask?: InboxReadAsk | undefined;
  },
  line: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const slack = yield* Effect.serviceOption(SlackBot);

    if (Option.isNone(slack) || !slack.value.configured) return;
    const place = yield* findItemPlace(itemId);

    if (Option.isNone(place)) return;
    const bot = yield* slack.value.forWorkspace(place.value.organizationId);
    const kept = yield* findMessageDm(message.id);
    const link = threadLink(itemId, place.value);

    // A press on the title DM, which the message's reply stands under, has it say the thread's open ask anew rather than the reply's line.
    if (Option.isSome(kept) && kept.value.dm.thread === dm.ts) {
      yield* redrawTitleDms(bot, itemId, { title: place.value.title, link }, [dm]);

      return;
    }

    const view = {
      title: place.value.title,
      text: wordsWithSteps(message.text, askSteps(message.ask)),
      link,
      titled: Option.isSome(kept) && kept.value.dm.thread === undefined,
    };

    yield* bot.update(dm.channel, dm.ts, threadDmContent(view, line));
  });
}

/** Where the ask a press named stands, as its DM says it: settled as the line says, or no longer the thread's open ask. */
export function settledLine(
  status: (typeof INBOX_ASK_STATUS)[keyof typeof INBOX_ASK_STATUS] | undefined,
): string {
  return status === undefined || status === INBOX_ASK_STATUS.OPEN
    ? `No longer open in ${PRODUCT_NAME}`
    : SETTLED_LINE[status];
}
