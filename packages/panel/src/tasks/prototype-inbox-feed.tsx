/**
 * prototype-inbox-feed.tsx -- PROTOTYPE 2, never merged: the Inbox as one feed of threads, as Slack's Threads view lists them, each expanding in place.
 *
 * One stream, filtered to what Needs you or showing Everything. Needs you
 * holds an ask waiting on the reader (decide, do, form) and a message
 * naming them, and stays until it is answered or handled; FYI holds new
 * replies in a thread the reader is in, an agent that finished or failed
 * without posting, and a pull request merged, and clears once read. Each
 * thread keeps the reader's own read marker, Slack's model: a row shows the
 * thread's first message, the replies before the marker folded under "N
 * earlier replies", a New rule, and the replies after it. Mark read moves
 * the marker to the end, and "Mark unread from here" on any message moves
 * it back to that message. A row expands in place to answer its ask, reply
 * with its box, or mark it read, and Open goes to its full thread: a
 * Manager's chat thread, or the task.
 *
 * A Manager's thread is its chat's own thread (`@repo/host/fixture-inbox`),
 * so an answer or a reply here stands in the chat too; a task's thread is
 * this module's own fixture.
 */

import { ENTITY_KIND } from "@repo/features/entity-kind";
import { REMIND_TIMES, remindWords } from "@repo/features/inbox-remind-times";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  type InboxAnswers,
  type InboxAsk,
  type InboxMessage,
} from "@repo/features/inbox-wire";
import type { ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import {
  answerPrototypeChatAsk,
  PROTOTYPE_LONG_ROOT,
  prototypeChatAnswer,
  prototypeChatAsk,
  prototypeChatThread,
  replyPrototypeChat,
} from "@repo/host/fixture-inbox";
import {
  BackButton,
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  ChannelMessage,
  ChoiceBar,
  COMPOSER_LOOK,
  ComposerFoot,
  ComposerFrame,
  EmptyState,
  GlyphSlot,
  IconButton,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  ListRow,
  type MenuAction,
  OneLine,
  ShowMoreRow,
  STATUS_TONE,
  ThreadReplies,
  ThreadRule,
  TIME_LOOK,
  Time,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { AlarmClockIcon, CheckCheckIcon, ICON_SIZE, MailIcon } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { MessageAction } from "../ai-elements/message.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { usePerson } from "../member-directory.js";
import { useHandedWords } from "./box-words.js";
import { REMIND_ME } from "./inbox-remind.js";
import { MessageField, useMessageBox } from "./message-box.js";
import { AskCard, PROTO_MANAGER, usePrototypeChat } from "./prototype-chat-ask.js";
import { TranscriptWords } from "./transcript-blocks.js";

/* ----- The fixture ----- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LANDED = Date.now();

/** The account the fixture signs in as, whose name a message mentions it by. */
const READER = { userId: "user-ada", name: "Ada Lovelace" } as const;

/** How a message names the reader, as a mention link. */
const MENTIONS_READER = "/person/user-ada)";

/** The release Manager's face, as the fixture stages it. */
const MANAGER_FACE = { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.BLUE };

/** The fixture's tasks the feed's threads stand on. */
const TASK = {
  INVITES: { id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60", name: "Teammate invitations" },
  DIGEST: { id: "3c9d5f7b-1e4a-4b62-8d8a-4f5a6b7c8d93", name: "Weekly digest email" },
  ROUNDING: { id: "4dae6081-2f5b-4c73-9e9b-5a6b7c8d9ea4", name: "Ledger rounding" },
  ALERTS: { id: "92f3b536-7eaf-4bc8-a3ea-afb0c1d2e3f9", name: "Usage alerts" },
} as const;

/** What a thread's last word may be besides a message: an agent that ended, or a pull request merged. */
const FEED_EVENT = {
  FINISHED: "finished",
  FAILED: "failed",
  MERGED: "merged",
} as const;

type FeedEvent = (typeof FEED_EVENT)[keyof typeof FEED_EVENT];

/** Who wrote a message of the feed. */
type FeedAuthor =
  | { readonly kind: "manager" }
  | { readonly kind: "agent"; readonly name: string }
  | { readonly kind: "person"; readonly userId: string; readonly name: string };

interface FeedMessage {
  readonly id: string;
  readonly by: FeedAuthor;
  readonly text: string;
  readonly at: number;
  readonly event?: FeedEvent;
}

/** A task agent's ask on its thread, as the Inbox reads it. */
interface FeedAsk {
  readonly itemId: string;
  readonly title: string;
  readonly ask: InboxAsk;
  readonly message: InboxMessage;
  readonly waitsOn: { readonly userId: string; readonly name: string };
}

/** Where a thread stands: a Manager's chat thread by its root, or a task's agent's thread. */
type FeedPlace =
  | { readonly kind: "manager"; readonly root: string }
  | {
      readonly kind: "task";
      readonly taskId: string;
      readonly taskName: string;
      readonly agentName: string;
    };

interface FeedThread {
  readonly id: string;
  readonly place: FeedPlace;
  readonly title: string;
}

/** A task agent's message. */
function agentSaid(
  id: string,
  agentName: string,
  text: string,
  ago: number,
  event?: FeedEvent,
): FeedMessage {
  return {
    id,
    by: { kind: "agent", name: agentName },
    text,
    at: LANDED - ago,
    ...(event === undefined ? undefined : { event }),
  };
}

/** A person's message. */
function personSaid(
  id: string,
  who: { userId: string; name: string },
  text: string,
  ago: number,
): FeedMessage {
  return { id, by: { kind: "person", userId: who.userId, name: who.name }, text, at: LANDED - ago };
}

const GRACE = { userId: "user-grace", name: "Grace Hopper" } as const;

/** The invitations agent's ask, which waits on the reader. */
const WITHDRAW_ASK: FeedAsk = (() => {
  const ask: InboxAsk = {
    type: INBOX_ASK.DECIDE,
    options: [
      { label: "The member who sent it", detail: "Admins can't touch someone else's invite." },
      { label: "Any admin", detail: "Senders wait on an admin to take one back." },
      { label: "Both", detail: "The sender, or any admin of the workspace." },
    ],
    recommended: "Both",
    status: INBOX_ASK_STATUS.OPEN,
  } as InboxAsk;

  return {
    itemId: "81e2a425-6d9f-4ab7-92df-000000008001",
    title: "Who can withdraw an invite?",
    ask,
    message: {
      id: "81e2a425-6d9f-4ab7-92df-000000008101",
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "An invite is a pending memberships row, so withdrawing one deletes it.",
      ask,
      createdAt: LANDED - 12 * MINUTE,
    } as InboxMessage,
    waitsOn: READER,
  };
})();

/** The feed's threads; a Manager's read their messages from its chat. */
const THREADS: readonly FeedThread[] = [
  {
    id: "m-email",
    place: { kind: "manager", root: "81e2a425-6d9f-4ab7-92df-000000007002" },
    title: "Which invite email ships?",
  },
  {
    id: "m-prod",
    place: { kind: "manager", root: "81e2a425-6d9f-4ab7-92df-000000007003" },
    title: "Set up production for invites",
  },
  {
    id: "m-notes",
    place: { kind: "manager", root: "81e2a425-6d9f-4ab7-92df-000000007004" },
    title: "Release notes for 0.25.0",
  },
  {
    id: "m-checklist",
    place: { kind: "manager", root: PROTOTYPE_LONG_ROOT },
    title: "Release checklist for 0.25.0",
  },
  {
    id: "m-merge",
    place: { kind: "manager", root: "81e2a425-6d9f-4ab7-92df-000000007001" },
    title: "Merge #128 now?",
  },
  {
    id: "t-withdraw",
    place: {
      kind: "task",
      taskId: TASK.INVITES.id,
      taskName: TASK.INVITES.name,
      agentName: "Build teammate invitations",
    },
    title: WITHDRAW_ASK.title,
  },
  {
    id: "t-subject",
    place: {
      kind: "task",
      taskId: TASK.DIGEST.id,
      taskName: TASK.DIGEST.name,
      agentName: "Send the weekly digest",
    },
    title: "The digest's subject line",
  },
  {
    id: "t-merged",
    place: {
      kind: "task",
      taskId: TASK.INVITES.id,
      taskName: TASK.INVITES.name,
      agentName: "Build teammate invitations",
    },
    title: "#128 Invite a teammate by email",
  },
  {
    id: "t-rounding",
    place: {
      kind: "task",
      taskId: TASK.ROUNDING.id,
      taskName: TASK.ROUNDING.name,
      agentName: "Fix ledger rounding",
    },
    title: "Fix ledger rounding",
  },
  {
    id: "t-alerts",
    place: {
      kind: "task",
      taskId: TASK.ALERTS.id,
      taskName: TASK.ALERTS.name,
      agentName: "Wire usage alerts",
    },
    title: "Wire usage alerts",
  },
];

/** The task threads' messages, oldest first; a reply here is laid on. */
const taskMessages = new Map<string, FeedMessage[]>([
  [
    "t-withdraw",
    [agentSaid("w0", "Build teammate invitations", WITHDRAW_ASK.message.text, 12 * MINUTE)],
  ],
  [
    "t-subject",
    [
      agentSaid(
        "s0",
        "Send the weekly digest",
        "The digest needs a subject line. I'd lead with the week's count: \"Your week: 12 tasks done\".",
        5 * HOUR,
      ),
      personSaid("s1", READER, "Lead with the count, but say the workspace's name too.", 4 * HOUR),
      agentSaid(
        "s2",
        "Send the weekly digest",
        'Done: "Acme, your week: 12 tasks done".',
        4 * HOUR - 10 * MINUTE,
      ),
      personSaid("s3", GRACE, "Can we drop the colon? It reads like a log line.", 50 * MINUTE),
      agentSaid(
        "s4",
        "Send the weekly digest",
        'Changed to "Acme had 12 tasks done this week". The preview is on the PR.',
        40 * MINUTE,
      ),
      personSaid("s5", GRACE, "Much better, ship it.", 30 * MINUTE),
    ],
  ],
  [
    "t-merged",
    [
      agentSaid(
        "g0",
        "Build teammate invitations",
        "#128 is ready: invites by email, with resend and expiry.",
        3 * HOUR,
      ),
      agentSaid(
        "g1",
        "Build teammate invitations",
        "Merged #128 into main. CI is green and the preview is torn down.",
        20 * MINUTE,
        FEED_EVENT.MERGED,
      ),
    ],
  ],
  [
    "t-rounding",
    [
      agentSaid(
        "r0",
        "Fix ledger rounding",
        "Finished in 42m without posting anything. Its last turn changed 3 files and the tests pass.",
        2 * HOUR,
        FEED_EVENT.FINISHED,
      ),
    ],
  ],
  [
    "t-alerts",
    [
      agentSaid(
        "a0",
        "Wire usage alerts",
        "Failed: the sandbox ran out of disk while installing dependencies.",
        70 * MINUTE,
        FEED_EVENT.FAILED,
      ),
    ],
  ],
]);

/** The reader's markers, by thread: how many of its messages they have read. */
const markers = new Map<string, number>([
  ["m-checklist", 13],
  ["m-merge", 99],
  ["t-subject", 3],
  ["t-merged", 1],
]);

/** The task agents' asks the reader answered, by item. */
const taskAnswers = new Map<string, InboxAnswers>();

const listeners = new Set<() => void>();
let version = 0;

function moved(): void {
  version += 1;

  for (const listener of listeners) listener();
}

function useFeedVersion(): number {
  // Note that the chat's moves count too, so a Manager's word landing in its thread draws the feed again.
  const chat = usePrototypeChat();

  return (
    chat * 100_000 +
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
      () => version,
    )
  );
}

/* ----- What a thread holds for the reader ----- */

/** A chat message as the feed draws it. */
function chatMessageOf(message: ManagerChatLiveMessage): FeedMessage {
  return {
    id: message.id,
    by:
      message.authorKind === MANAGER_CHAT_AUTHOR.AGENT
        ? { kind: "manager" }
        : { kind: "person", userId: message.authorUserId ?? "", name: message.authorName },
    text: message.text,
    at: message.createdAt,
  };
}

function messagesOf(thread: FeedThread): readonly FeedMessage[] {
  if (thread.place.kind === "manager")
    return prototypeChatThread(thread.place.root).map(chatMessageOf);

  return taskMessages.get(thread.id) ?? [];
}

/** Why a thread needs the reader, or why it is worth a look: the reason its row is listed for. */
const FEED_REASON = {
  ASK: "ask",
  MENTION: "mention",
  REPLIES: "replies",
  FINISHED: "finished",
  FAILED: "failed",
  MERGED: "merged",
} as const;

type FeedReason = (typeof FEED_REASON)[keyof typeof FEED_REASON];

/** Whether a reason is the reader's to handle, which stays until handled, rather than a look, which clears once read. */
function needsYou(reason: FeedReason | undefined): boolean {
  return reason === FEED_REASON.ASK || reason === FEED_REASON.MENTION;
}

/** A thread as the reader stands with it. */
interface ThreadStanding {
  readonly thread: FeedThread;
  readonly messages: readonly FeedMessage[];
  readonly marker: number;
  readonly unread: readonly FeedMessage[];
  readonly reason: FeedReason | undefined;
  readonly lastAt: number;
  readonly openAsk: boolean;
}

/** Whether the thread's ask still waits on the reader. */
function asksReader(thread: FeedThread): boolean {
  if (thread.place.kind === "manager") {
    const ask = prototypeChatAsk(thread.place.root);

    return (
      ask !== undefined &&
      ask.waitsOn.userId === READER.userId &&
      prototypeChatAnswer(ask.id) === undefined
    );
  }

  return thread.id === "t-withdraw" && !taskAnswers.has(WITHDRAW_ASK.itemId);
}

function standingOf(thread: FeedThread): ThreadStanding {
  const messages = messagesOf(thread);
  const marker = Math.min(markers.get(thread.id) ?? 0, messages.length);
  const unread = messages.slice(marker);
  const last = unread.at(-1);
  const openAsk = asksReader(thread);

  const reason: FeedReason | undefined = openAsk
    ? FEED_REASON.ASK
    : unread.some((message) => message.text.includes(MENTIONS_READER))
      ? FEED_REASON.MENTION
      : last === undefined
        ? undefined
        : last.event === FEED_EVENT.FINISHED
          ? FEED_REASON.FINISHED
          : last.event === FEED_EVENT.FAILED
            ? FEED_REASON.FAILED
            : last.event === FEED_EVENT.MERGED
              ? FEED_REASON.MERGED
              : FEED_REASON.REPLIES;

  return { thread, messages, marker, unread, reason, lastAt: messages.at(-1)?.at ?? 0, openAsk };
}

/* ----- The reader's acts ----- */

function markRead(thread: ThreadStanding): void {
  markers.set(thread.thread.id, thread.messages.length);
  moved();
}

function markUnreadFrom(thread: ThreadStanding, at: number): void {
  markers.set(thread.thread.id, at);
  moved();
}

/** The reader's reply on a thread: in a Manager's chat thread, or on the task's thread with its agent's word after; either way the thread reads as read. */
function reply(thread: ThreadStanding, text: string): void {
  const { place, id } = thread.thread;

  if (place.kind === "manager") {
    replyPrototypeChat(place.root, text);
    // Note that the reader has read through their own reply, so the word after it is new.
    markers.set(id, thread.messages.length + 1);
    moved();

    return;
  }

  const held = taskMessages.get(id) ?? [];
  held.push(personSaid(`reply-${held.length}`, READER, text, 0));
  markers.set(id, held.length);
  moved();
  setTimeout(() => {
    held.push(agentSaid(`ack-${held.length}`, place.agentName, "Thanks, on it.", 0));
    // Note that the agent's word after the reader's is new to them.
    moved();
  }, 1200);
}

/* ----- Drawing ----- */

/** A message's picture: the Manager's face, a person's, or a task agent's glyph. */
function Avatar({ by }: { by: FeedAuthor }): React.JSX.Element {
  const person = usePerson(by.kind === "person" ? { userId: by.userId, name: by.name } : undefined);

  if (by.kind === "manager")
    return <ManagerFace face={MANAGER_FACE} size={MANAGER_FACE_SIZE.MESSAGE} />;

  if (by.kind === "person") return <ActorMark actor={person} size={ACTOR_SIZE.CARD} />;

  return (
    <GlyphSlot size={ICON_SIZE.LARGE}>
      <EntityGlyph kind={ENTITY_KIND.AGENT} />
    </GlyphSlot>
  );
}

function nameOf(by: FeedAuthor): string {
  if (by.kind === "manager") return "Release manager";

  return by.name;
}

/** The badge an event wears under its words. */
function EventBadge({ event }: { event: FeedEvent }): React.JSX.Element {
  if (event === FEED_EVENT.FINISHED) return <Badge tone={STATUS_TONE.COMPLETE}>Finished</Badge>;

  if (event === FEED_EVENT.FAILED) return <Badge tone={STATUS_TONE.DANGER}>Failed</Badge>;

  return <Badge tone={STATUS_TONE.MERGED}>Merged</Badge>;
}

/** What an ask asks for, in a badge's one word or two. */
function askKindWords(thread: FeedThread): string {
  const ask =
    thread.place.kind === "manager"
      ? prototypeChatAsk(thread.place.root)?.message.ask
      : WITHDRAW_ASK.ask;

  if (ask?.type === INBOX_ASK.DO) return "To do";

  if (ask?.type === INBOX_ASK.ANSWER) return "Fill in";

  return "Decide";
}

/** What a row says it is listed for. */
function ReasonBadge({ standing }: { standing: ThreadStanding }): React.JSX.Element | null {
  const { reason, unread } = standing;

  switch (reason) {
    case FEED_REASON.ASK:
      return <Badge tone={STATUS_TONE.ATTENTION}>{askKindWords(standing.thread)}</Badge>;
    case FEED_REASON.MENTION:
      return <Badge tone={STATUS_TONE.ATTENTION}>Mention</Badge>;
    case FEED_REASON.REPLIES:
      return <Badge tone={STATUS_TONE.NEUTRAL}>{`${unread.length} new`}</Badge>;
    case FEED_REASON.FINISHED:
      return <Badge tone={STATUS_TONE.COMPLETE}>Finished</Badge>;
    case FEED_REASON.FAILED:
      return <Badge tone={STATUS_TONE.DANGER}>Failed</Badge>;
    case FEED_REASON.MERGED:
      return <Badge tone={STATUS_TONE.MERGED}>Merged</Badge>;
    default:
      return null;
  }
}

/** One message of a thread in the feed, with "Mark unread from here" among its actions. */
function FeedLine({
  message,
  onMarkUnread,
  under,
}: {
  message: FeedMessage;
  onMarkUnread: () => void;
  under?: React.ReactNode;
}): React.JSX.Element {
  return (
    <ChannelMessage
      messageId={message.id}
      avatar={<Avatar by={message.by} />}
      name={nameOf(message.by)}
      at={<Time at={message.at} look={TIME_LOOK.DAY} />}
      actions={
        <MessageAction label="Mark unread from here" tooltip onClick={onMarkUnread}>
          <MailIcon />
        </MessageAction>
      }
      under={
        <>
          {message.event === undefined ? null : (
            <span className="flex">
              <EventBadge event={message.event} />
            </span>
          )}
          {under}
        </>
      }
    >
      <TranscriptWords text={message.text} />
    </ChannelMessage>
  );
}

/** The thread's box: the chat's own field, its Reply sending to the thread. */
function ReplyBox({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const [words, setWords] = useState("");

  const send = () => {
    const text = words.trim();

    if (text === "") return;
    onSend(text);
    setWords("");
  };

  const box = useMessageBox({
    draft: useHandedWords(words),
    setDraft: setWords,
    placeholder: "Reply…",
    label: "Reply",
    maxLength: 8000,
    onSubmit: send,
    takesFiles: false,
    takesFocus: false,
  });

  return (
    <ComposerFrame look={COMPOSER_LOOK.CARD}>
      <MessageField box={box} look={COMPOSER_LOOK.BARE} />
      <ComposerFoot send={{ label: "Reply", empty: words.trim() === "", onSend: send }} />
    </ComposerFrame>
  );
}

/** A row's expanded thread: its first message with its ask, the replies before the marker folded, New, the replies after, and the box. */
function ThreadBody({
  standing,
  shownFrom,
  onMarkUnreadFrom,
  readInboxImage,
}: {
  standing: ThreadStanding;
  /** Where the reader's marker stood as the thread opened, which New stands at. */
  shownFrom: number;
  onMarkUnreadFrom: (at: number) => void;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element {
  const [earlierShown, setEarlierShown] = useState(false);
  const { messages, thread } = standing;
  // Note that the first message always stands, so the marker never folds it.
  const marker = Math.max(Math.min(shownFrom, messages.length), 1);
  const earlier = messages.slice(1, marker);
  const after = messages.slice(marker);
  const root = messages[0];

  const askCard = (() => {
    if (thread.place.kind === "manager") {
      const ask = prototypeChatAsk(thread.place.root);

      if (ask?.message.ask === undefined) return null;

      return (
        <AskCard
          itemId={ask.id}
          ask={ask.message.ask as InboxAsk}
          title={ask.title}
          thread={[{ ...ask.message, text: ask.text }]}
          waitsOn={ask.waitsOn}
          readerId={READER.userId}
          answers={prototypeChatAnswer(ask.id)?.answers}
          onAnswer={(answers, words) => {
            answerPrototypeChatAsk(ask.id, answers, words);
            markers.set(thread.id, messages.length + 1);
            moved();
          }}
          readInboxImage={readInboxImage}
        />
      );
    }

    if (thread.id !== "t-withdraw") return null;

    return (
      <AskCard
        itemId={WITHDRAW_ASK.itemId}
        ask={WITHDRAW_ASK.ask}
        title={WITHDRAW_ASK.title}
        thread={[WITHDRAW_ASK.message]}
        waitsOn={WITHDRAW_ASK.waitsOn}
        readerId={READER.userId}
        answers={taskAnswers.get(WITHDRAW_ASK.itemId)}
        onAnswer={(answers, words) => {
          taskAnswers.set(WITHDRAW_ASK.itemId, answers);
          reply(standing, words);
        }}
        readInboxImage={readInboxImage}
      />
    );
  })();

  return (
    <div className="flex min-w-0 flex-col gap-tight-gap" data-prototype-feed-body={thread.id}>
      {root === undefined ? null : (
        <FeedLine message={root} onMarkUnread={() => onMarkUnreadFrom(0)} under={askCard} />
      )}
      {earlier.length === 0 ? null : (
        <div className="ps-ui-8">
          <ThreadReplies
            count={earlier.length}
            faces={[]}
            open={earlierShown}
            label={
              earlierShown
                ? "Hide earlier replies"
                : earlier.length === 1
                  ? "1 earlier reply"
                  : `${earlier.length} earlier replies`
            }
            onOpen={() => setEarlierShown((was) => !was)}
          />
        </div>
      )}
      {earlierShown
        ? earlier.map((message, at) => (
            <FeedLine
              key={message.id}
              message={message}
              onMarkUnread={() => onMarkUnreadFrom(at + 1)}
            />
          ))
        : null}
      {after.length === 0 || shownFrom === 0 ? null : <ThreadRule count={1} label="New" />}
      {after.map((message, at) => (
        <FeedLine
          key={message.id}
          message={message}
          onMarkUnread={() => onMarkUnreadFrom(marker + at)}
        />
      ))}
    </div>
  );
}

/** Where a row's holder is named: the Manager's face, or the task's glyph. */
function HolderGlyph({ place }: { place: FeedPlace }): React.JSX.Element {
  return place.kind === "manager" ? (
    <ManagerFace face={MANAGER_FACE} size={MANAGER_FACE_SIZE.ROW} />
  ) : (
    <GlyphSlot size={ICON_SIZE.SMALL}>
      <EntityGlyph kind={ENTITY_KIND.PLAN} />
    </GlyphSlot>
  );
}

function holderName(place: FeedPlace): string {
  return place.kind === "manager" ? "Release manager" : place.taskName;
}

/** A message's words as a row's one line reads them: a mention as its name. */
function plainWords(text: string): string {
  return text.replace(/\[@([^\]]+)\]\([^)]*\)/gu, "@$1").replace(/[`*]/gu, "");
}

/** The thread's latest activity as its row says it: who, and what. */
function latestWords(standing: ThreadStanding): string {
  const latest = standing.unread.at(-1) ?? standing.messages.at(-1);

  if (latest === undefined) return holderName(standing.thread.place);
  const who =
    latest.by.kind === "person" && latest.by.userId === READER.userId ? "You" : nameOf(latest.by);
  const holder = holderName(standing.thread.place);

  return who === holder
    ? `${holder}: ${plainWords(latest.text)}`
    : `${holder} · ${who}: ${plainWords(latest.text)}`;
}

/** Whether a row reads unread: something new, or an ask still waiting. */
function rowUnread(standing: ThreadStanding): boolean {
  return standing.unread.length > 0 || standing.openAsk;
}

/** The reader's reminder on a thread, as the Inbox's Remind me sets one. */
const snoozed = new Map<string, number>();

/** The Inbox's Remind me times, as a menu's actions. */
function remindActions(onAt: (at: number) => void): MenuAction[] {
  const now = Date.now();

  return REMIND_TIMES.map((time) => ({
    label: time.label,
    detail: remindWords(time.at(now), now),
    onSelect: () => onAt(time.at(Date.now())),
  }));
}

/** Remind me, the Inbox's own times, on the thread shown. */
function RemindButton({
  shown,
  onAt,
}: {
  shown: boolean;
  onAt: (at: number) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);

  return (
    <>
      <Tooltip label={REMIND_ME}>
        <IconButton
          icon={<AlarmClockIcon />}
          label={REMIND_ME}
          size={BUTTON_SIZE.COMPACT}
          {...menu.trigger()}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={REMIND_ME}
          menu={menu.drawn}
          groups={[remindActions(onAt)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The thread shown beside the list: its head with its acts, the thread at the reader's marker, and its box. */
function ThreadPane({
  standing,
  shownFrom,
  narrow,
  onBack,
  onOpen,
  onToggleRead,
  onRemind,
  onMarkUnreadFrom,
  readInboxImage,
}: {
  standing: ThreadStanding;
  shownFrom: number;
  narrow: boolean;
  onBack: () => void;
  onOpen: () => void;
  onToggleRead: () => void;
  onRemind: (at: number) => void;
  onMarkUnreadFrom: (at: number) => void;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element {
  const { thread } = standing;
  const unread = standing.unread.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-prototype-feed-pane={thread.id}>
      <div className="flex flex-none flex-wrap items-center gap-control-gap border-b border-border px-list-inset py-tight-gap">
        {narrow ? <BackButton label="Inbox" place="inbox" onBack={onBack} /> : null}
        <span
          className={`flex min-w-0 items-center gap-icon-gap ${narrow ? "order-last basis-full" : "flex-1"}`}
        >
          <HolderGlyph place={thread.place} />
          <span className="flex min-w-0 flex-col">
            <OneLine className="font-ui-semibold text-foreground">{thread.title}</OneLine>
            <OneLine className="text-caption text-muted-foreground">
              {holderName(thread.place)}
            </OneLine>
          </span>
        </span>
        <span className="ms-auto flex flex-none items-center gap-control-gap">
          <ReasonBadge standing={standing} />
          <Tooltip label={unread ? "Mark read (U)" : "Mark unread (U)"}>
            <IconButton
              icon={unread ? <CheckCheckIcon /> : <MailIcon />}
              label={unread ? "Mark read" : "Mark unread"}
              size={BUTTON_SIZE.COMPACT}
              onClick={onToggleRead}
            />
          </Tooltip>
          <RemindButton shown onAt={onRemind} />
          <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={onOpen}>
            {thread.place.kind === "manager" ? "Open in chat" : "Open task"}
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-list-inset py-list-inset">
        <div className="mx-auto w-full max-w-[760px]">
          <ThreadBody
            key={thread.id}
            standing={standing}
            shownFrom={shownFrom}
            onMarkUnreadFrom={onMarkUnreadFrom}
            readInboxImage={readInboxImage}
          />
        </div>
      </div>
      <div className="flex-none px-list-inset pb-list-inset">
        <div className="mx-auto w-full max-w-[760px]">
          <ReplyBox key={thread.id} onSend={(text) => reply(standing, text)} />
        </div>
      </div>
    </div>
  );
}

/** The feed's filters. */
const FEED_FILTER = {
  NEEDS_YOU: "needs-you",
  EVERYTHING: "everything",
} as const;

type FeedFilter = (typeof FEED_FILTER)[keyof typeof FEED_FILTER];

/** Whether a key press stands in a field, where J and K are words. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
  );
}

/**
 * The Inbox as one feed of threads, Linear's Inbox in shape (see the
 * file's header): a list of threads on the left, Needs you or Everything,
 * the latest first, and the thread chosen open on the right at the
 * reader's marker, with its box. Opening a thread that only informs reads
 * it, as Linear's does; one that needs the reader stays until handled. A
 * row listed while the feed stands keeps its place once read, until the
 * filter moves; one reminded leaves until its time. J and K step, U marks
 * read or unread, ⌥U marks every one read. `only` narrows it to
 * the Manager's threads, as its page's Inbox tab draws it; `narrow`, a
 * phone's room, shows the list or the thread.
 */
export function PrototypeInboxFeed({
  only,
  narrow = false,
  onOpenManagerThread,
  onOpenTask,
  readInboxImage,
}: {
  only?: "manager" | undefined;
  narrow?: boolean | undefined;
  onOpenManagerThread: (root: string) => void;
  onOpenTask: (taskId: string) => void;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element {
  const feedVersion = useFeedVersion();
  const [filter, setFilter] = useState<FeedFilter>(FEED_FILTER.NEEDS_YOU);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [shownFrom, setShownFrom] = useState<ReadonlyMap<string, number>>(new Map());
  const [snoozedShown, setSnoozedShown] = useState(false);
  const [held, setHeld] = useState<{
    readonly filter: FeedFilter;
    readonly ids: ReadonlySet<string>;
  }>({
    filter,
    ids: new Set(),
  });

  // Note that the version is read so every act draws the feed again.
  const standings = useMemo(
    () =>
      feedVersion >= 0
        ? THREADS.filter((thread) => only === undefined || thread.place.kind === only)
            .map(standingOf)
            .toSorted((a, b) => b.lastAt - a.lastAt)
        : [],
    [feedVersion, only],
  );

  const now = Date.now();
  const isSnoozed = (standing: ThreadStanding) => (snoozed.get(standing.thread.id) ?? 0) > now;

  const listedNow = (standing: ThreadStanding, by: FeedFilter) =>
    !isSnoozed(standing) &&
    (by === FEED_FILTER.NEEDS_YOU ? needsYou(standing.reason) : standing.reason !== undefined);

  // Note that a row listed while the feed stands stays in its place once handled or read, until the filter moves; one reminded leaves at once.
  const heldIds = held.filter === filter ? held.ids : new Set<string>();

  const listed = standings.filter(
    (each) => listedNow(each, filter) || (heldIds.has(each.thread.id) && !isSnoozed(each)),
  );

  const nextHeld = new Set(listed.map((each) => each.thread.id));

  if (held.filter !== filter || [...nextHeld].some((id) => !held.ids.has(id))) {
    setHeld({ filter, ids: new Set([...(held.filter === filter ? held.ids : []), ...nextHeld]) });
  }

  const snoozedRows = standings.filter(isSnoozed);
  const needsCount = standings.filter((each) => listedNow(each, FEED_FILTER.NEEDS_YOU)).length;
  const newCount = standings.filter((each) => listedNow(each, FEED_FILTER.EVERYTHING)).length;
  const shown = standings.find((each) => each.thread.id === chosen);

  /** Opens a thread on the right at the reader's marker; one that only informs is read as it opens. */
  const choose = (standing: ThreadStanding) => {
    setChosen(standing.thread.id);
    setShownFrom((was) => new Map(was).set(standing.thread.id, standing.marker));

    if (!needsYou(standing.reason) && standing.unread.length > 0) markRead(standing);
  };

  const toggleRead = (standing: ThreadStanding) => {
    if (standing.unread.length > 0) {
      markRead(standing);

      return;
    }

    // Note that marking unread brings back its last message, as Linear's U does.
    const at = Math.max(standing.messages.length - 1, 0);
    markUnreadFrom(standing, at);
    setShownFrom((was) => new Map(was).set(standing.thread.id, at));
  };

  const remind = (standing: ThreadStanding, at: number) => {
    snoozed.set(standing.thread.id, at);
    setChosen(undefined);
    moved();
  };

  const markAllRead = () => {
    for (const each of listed) markers.set(each.thread.id, each.messages.length);
    moved();
  };

  // J and K step through the list, U marks read or unread, ⌥U marks all read, as Linear's Inbox keys them.
  const keys = useRef({ listed, shown, choose, toggleRead, remind, markAllRead });
  keys.current = { listed, shown, choose, toggleRead, remind, markAllRead };
  useEffect(() => {
    const heard = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey) return;
      const {
        listed: rows,
        shown: open,
        choose: pick,
        toggleRead: read,
        markAllRead: all,
      } = keys.current;
      const at = rows.findIndex((each) => each.thread.id === open?.thread.id);

      if (event.altKey && event.code === "KeyU") {
        event.preventDefault();
        all();

        return;
      }

      if (event.altKey) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;

      if (step !== 0) {
        const next = rows[Math.min(Math.max(at + step, 0), rows.length - 1)];

        if (next !== undefined) pick(next);

        return;
      }

      if (event.key === "u" && open !== undefined) read(open);
    };
    document.addEventListener("keydown", heard);

    return () => document.removeEventListener("keydown", heard);
  }, []);

  const rowOf = (standing: ThreadStanding) => {
    const reminded = snoozed.get(standing.thread.id);

    return (
      <ListRow
        key={standing.thread.id}
        leading={<HolderGlyph place={standing.thread.place} />}
        title={standing.thread.title}
        description={latestWords(standing)}
        meta={
          <span className="flex items-center gap-ui-4">
            <ReasonBadge standing={standing} />
            <span className="text-caption text-muted-foreground">
              {reminded !== undefined && reminded > now ? (
                remindWords(reminded, now)
              ) : (
                <Time at={standing.lastAt} look={TIME_LOOK.SINCE} />
              )}
            </span>
          </span>
        }
        metaAt={LIST_ROW_META.TITLE}
        unread={rowUnread(standing)}
        current={standing.thread.id === chosen ? LIST_ROW_CURRENT.ITEM : undefined}
        onPress={() => choose(standing)}
        id={`prototype-feed-row-${standing.thread.id}`}
      />
    );
  };

  const list = (
    <div className="flex min-h-0 min-w-0 flex-col" data-prototype-feed-list="">
      <div className="flex flex-none items-center gap-control-gap px-list-inset pt-list-inset pb-tight-gap">
        <span className="min-w-0 flex-1">
          <ChoiceBar
            label="Inbox filter"
            items={[
              {
                value: FEED_FILTER.NEEDS_YOU,
                label: "Needs you",
                count: needsCount === 0 ? undefined : [{ text: String(needsCount) }],
              },
              {
                value: FEED_FILTER.EVERYTHING,
                label: "Everything",
                count: newCount === 0 ? undefined : [{ text: String(newCount) }],
              },
            ]}
            value={filter}
            look={CHOICE_BAR_LOOK.FILL}
            onChange={setFilter}
          />
        </span>
        <Tooltip label="Mark all as read (⌥U)">
          <IconButton
            icon={<CheckCheckIcon />}
            label="Mark all as read"
            size={BUTTON_SIZE.COMPACT}
            onClick={markAllRead}
          />
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-list-inset pb-list-inset">
        {listed.length === 0 ? (
          <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}>
            {filter === FEED_FILTER.NEEDS_YOU ? "Nothing needs you." : "Nothing new."}
          </EmptyState>
        ) : (
          <div className="flex flex-col">{listed.map(rowOf)}</div>
        )}
        {snoozedRows.length === 0 ? null : (
          <div className="flex flex-col pt-tight-gap">
            {snoozedShown ? <ThreadRule count={1} label="Reminders" /> : null}
            {snoozedShown ? snoozedRows.map(rowOf) : null}
            <ShowMoreRow
              more={snoozedRows.length}
              shown={snoozedShown}
              onToggle={() => setSnoozedShown((was) => !was)}
            />
          </div>
        )}
      </div>
    </div>
  );

  const pane =
    shown === undefined ? (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}>
          Choose a thread, or step with J and K
        </EmptyState>
      </div>
    ) : (
      <ThreadPane
        standing={shown}
        shownFrom={shownFrom.get(shown.thread.id) ?? shown.marker}
        narrow={narrow}
        onBack={() => setChosen(undefined)}
        onOpen={() =>
          shown.thread.place.kind === "manager"
            ? onOpenManagerThread(shown.thread.place.root)
            : onOpenTask(shown.thread.place.taskId)
        }
        onToggleRead={() => toggleRead(shown)}
        onRemind={(at) => remind(shown, at)}
        onMarkUnreadFrom={(at) => {
          markUnreadFrom(shown, at);
          setShownFrom((was) => new Map(was).set(shown.thread.id, at));
        }}
        readInboxImage={readInboxImage}
      />
    );

  if (narrow) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-prototype-feed="">
        {shown === undefined ? list : pane}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-prototype-feed="">
      <div className="flex min-h-0 w-[380px] flex-none flex-col border-e border-border">{list}</div>
      {pane}
    </div>
  );
}

export { PROTO_MANAGER };
