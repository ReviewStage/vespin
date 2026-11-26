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

import type { AgentSummary } from "@repo/features/agent-wire";
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
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  ChannelMessage,
  EmptyState,
  GlyphSlot,
  IconButton,
  LineClamp,
  type MenuAction,
  OneLine,
  TEXT_BUTTON_TONE,
  TextButton,
  ThreadReplies,
  ThreadRule,
  TIME_LOOK,
  Time,
  Tooltip,
  UnreadMark,
  useMenu,
} from "@repo/ui";
import {
  AlarmClockIcon,
  CheckCheckIcon,
  CheckIcon,
  ICON_SIZE,
  MailIcon,
  MessagesSquareIcon,
} from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { MessageAction } from "../ai-elements/message.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { usePerson } from "../member-directory.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { useAgentBox } from "./agent-box.js";
import { AgentComposer } from "./agent-composer.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { useHandedWords } from "./box-words.js";
import { REMIND_ME } from "./inbox-remind.js";
import { AskCard, PROTO_MANAGER, usePrototypeChat } from "./prototype-chat-ask.js";
import { type BoxHeld, heldUpdateOver } from "./refused-send.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { AgentsControl } from "./use-agents.js";

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
      /** The agent that posted the thread, whose box the card's reply goes through; none for an agent the fixture keeps no record of. */
      readonly agentId?: string;
    };

interface FeedThread {
  readonly id: string;
  readonly place: FeedPlace;
  readonly title: string;
  /** Where an activity line says it happened, quiet under its words; none for a thread. */
  readonly activity?: string;
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
      agentId: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5",
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
      agentId: "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6",
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
      agentId: "5ebf7192-3a6c-4d84-8fac-6b7c8d9eafb5",
    },
    title: "#128 Invite a teammate by email",
    activity: "Pull request merged in Teammate invitations",
  },
  {
    id: "t-rounding",
    place: {
      kind: "task",
      taskId: TASK.ROUNDING.id,
      taskName: TASK.ROUNDING.name,
      agentName: "Fix ledger rounding",
      agentId: "70d19314-5c8e-4fa6-81ce-8d9eafb0c1d7",
    },
    title: "Fix ledger rounding",
    activity: "Agent finished in Ledger rounding",
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
    activity: "Agent failed in Usage alerts",
  },
  {
    id: "t-billing",
    place: {
      kind: "task",
      taskId: "c526e869-a1d2-4efb-96bd-d2e3f405162c",
      taskName: "Billing export",
      agentName: "Export invoices to CSV",
    },
    title: "Export invoices to CSV",
    activity: "Agent finished in Billing export",
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
        30 * HOUR,
      ),
      personSaid("s1", READER, "Lead with the count, but say the workspace's name too.", 29 * HOUR),
      agentSaid(
        "s2",
        "Send the weekly digest",
        'Done: "Acme, your week: 12 tasks done".',
        28 * HOUR,
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
        26 * HOUR,
        FEED_EVENT.FINISHED,
      ),
    ],
  ],
  [
    "t-billing",
    [
      agentSaid(
        "b0",
        "Export invoices to CSV",
        "Finished in 18m without posting anything. The export runs nightly now.",
        52 * HOUR,
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
        "The sandbox ran out of disk while installing dependencies.",
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
  ["t-rounding", 1],
  ["t-billing", 1],
]);

/** Where the reader's marker stood as they opened each thread beside the feed, which its tab's New stands at. */
const openedFrom = new Map<string, number>();

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
  fired.delete(thread.thread.id);
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

/** One message of a thread in the feed, with "Mark unread from here" among its actions. */
function FeedLine({
  message,
  onMarkUnread,
  onView,
  under,
  clamp = false,
}: {
  message: FeedMessage;
  /** Whether its words stop at six lines with Show more, as a card in the feed draws them. */
  clamp?: boolean | undefined;
  onMarkUnread: () => void;
  /** Opens the whole thread beside the feed; none where it stands open there already. */
  onView?: (() => void) | undefined;
  under?: React.ReactNode;
}): React.JSX.Element {
  return (
    <ChannelMessage
      messageId={message.id}
      avatar={<Avatar by={message.by} />}
      name={nameOf(message.by)}
      at={<Time at={message.at} look={TIME_LOOK.DAY} />}
      actions={
        <>
          {onView === undefined ? null : (
            <MessageAction label="View thread" tooltip onClick={onView}>
              <MessagesSquareIcon />
            </MessageAction>
          )}
          <MessageAction label="Mark unread from here" tooltip onClick={onMarkUnread}>
            <MailIcon />
          </MessageAction>
        </>
      }
      under={under}
    >
      <ClampedWords text={message.text} clamp={clamp} />
    </ChannelMessage>
  );
}

/** A message's words, stopped at six lines with Show more where `clamp` asks, as Slack's Threads stops a long message; whole otherwise. */
function ClampedWords({ text, clamp }: { text: string; clamp: boolean }): React.JSX.Element {
  if (!clamp) return <TranscriptWords text={text} />;

  return (
    <LineClamp>
      <TranscriptWords text={text} />
    </LineClamp>
  );
}

/** No stop: a reply in the feed never stops its agent's turn. */
function neverStops(): Promise<boolean> {
  return Promise.resolve(false);
}

/** Nothing to try again: a reply in the feed lands at once. */
function noRetry(): void {}

/** The agent of `agentId` as the window holds it: among its agents' rows, else as the task list lists it, which the box reads its model and servers off. */
function useFeedAgent(agentId: string, agents: AgentsControl): AgentSummary | undefined {
  const listed = useTaskListRow(useTaskListCollections().agents, agentId);
  const held = agents.agents?.find((each) => each.id === agentId);

  // SAFETY: PROTOTYPE: a listed agent carries every field the box reads off an agent.
  return held ?? (listed as unknown as AgentSummary | undefined);
}

/**
 * A thread's reply box: the agent composer itself, as the Inbox's answer
 * box draws it (`inbox-answer-box.tsx`), over what it reads off the
 * thread's agent (`useAgentBox`), so its `@` and `/` lists, dictation, +,
 * files, and model chip are every box's; its Send replies on the thread
 * (`onSend`).
 */
function FeedComposer({
  agentId,
  agents,
  onSend,
}: {
  agentId: string;
  agents: AgentsControl;
  onSend: (text: string) => void;
}): React.JSX.Element {
  const agent = useFeedAgent(agentId, agents);
  const agentBox = useAgentBox({ agentId, agent, agents });
  const [held, setHeld] = useState<BoxHeld>({ text: "", attachments: [] });
  const words = useHandedWords(held.text);
  const latest = useRef(held);
  latest.current = held;

  const composer: AgentComposerControl = {
    held: { words, attachments: held.attachments },
    updateHeld: heldUpdateOver(setHeld),
    sending: false,
    note: undefined,
    closed: undefined,
    send: () => {
      const text = latest.current.text.trim();

      if (text === "" && latest.current.attachments.length === 0) return;
      onSend(text);
      setHeld({ text: "", attachments: [] });
    },
    retry: noRetry,
    sent: [],
  };

  return (
    <AgentComposer
      {...agentBox}
      // Note that a reply in a thread never stops its agent's turn, as the Inbox's box never does.
      stoppable={false}
      onClear={undefined}
      composer={composer}
      usage={undefined}
      onStop={neverStops}
      followsUp
      keywords={agents.keywords}
      skills={agents.readSkills}
      wording={{ placeholder: "Reply…", label: "Reply", send: "Send" }}
      maxLength={8000}
      takesFocus={false}
    />
  );
}

/** Who a thread's box writes to: its Manager, or the task's agent that posted it; none where the fixture keeps no record of the agent. */
function threadAgentOf(thread: FeedThread): string | undefined {
  return thread.place.kind === "manager" ? PROTO_MANAGER : thread.place.agentId;
}

/**
 * A task agent's Inbox thread as the window's side panel draws it beside
 * the feed (`STRIP_TAB_KIND.INBOX_THREAD`), as a Manager's thread tab draws
 * its own: the whole thread, at the reader's marker, in the log a tab
 * scrolls, and the agent composer at its foot.
 */
export function PrototypeInboxThreadTab({
  threadId,
  agents,
  readInboxImage,
}: {
  threadId: string;
  agents: AgentsControl;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element | null {
  const feedVersion = useFeedVersion();
  const thread = THREADS.find((each) => each.id === threadId);
  const [shownFrom] = useState(
    () => openedFrom.get(threadId) ?? (thread === undefined ? 0 : standingOf(thread).marker),
  );

  if (thread === undefined || feedVersion < 0) return null;
  const standing = standingOf(thread);
  const agentId = threadAgentOf(thread);

  return (
    <AgentTabFrame label={TAB_WORDS.THREAD}>
      <Conversation>
        <ConversationContent>
          <ThreadBody
            standing={standing}
            shownFrom={shownFrom}
            whole
            onMarkUnreadFrom={(at) => markUnreadFrom(standing, at)}
            readInboxImage={readInboxImage}
          />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {agentId === undefined ? null : (
        <AgentTabFoot>
          <FeedComposer
            agentId={agentId}
            agents={agents}
            onSend={(text) => reply(standing, text)}
          />
        </AgentTabFoot>
      )}
    </AgentTabFrame>
  );
}

/** A row's expanded thread: its first message with its ask, the replies before the marker folded, New, the replies after, and the box. */
function ThreadBody({
  standing,
  shownFrom,
  whole = false,
  onView,
  onMarkUnreadFrom,
  readInboxImage,
}: {
  standing: ThreadStanding;
  /** Where the reader's marker stood as the thread opened, which New stands at. */
  shownFrom: number;
  /** Whether every reply stands, as the thread beside the feed draws it, rather than the read ones folded. */
  whole?: boolean | undefined;
  onView?: (() => void) | undefined;
  onMarkUnreadFrom: (at: number) => void;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element {
  const [earlierShown, setEarlierShown] = useState(whole);
  const { messages, thread } = standing;
  // Note that a card shows the latest replies alone, as Slack's Threads does, the earlier folded above them; the thread beside the feed shows every one.
  const start = whole || earlierShown ? 1 : Math.max(1, messages.length - LATEST_REPLIES);
  const earlier = messages.slice(1, Math.max(1, messages.length - LATEST_REPLIES));
  const shownReplies = messages.slice(start);
  // New stands before the first reply new to the reader that the card shows.
  const newAt =
    shownFrom > 0 && shownFrom < messages.length ? Math.max(shownFrom, start) : undefined;
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
        <FeedLine
          message={root}
          clamp={!whole}
          onMarkUnread={() => onMarkUnreadFrom(0)}
          onView={onView}
          under={askCard}
        />
      )}
      {earlier.length === 0 || whole ? null : (
        <div className="ps-ui-8">
          <ThreadReplies
            count={earlier.length}
            faces={[]}
            open={earlierShown}
            label={
              earlierShown
                ? "Show fewer replies"
                : earlier.length === 1
                  ? "1 earlier reply"
                  : `${earlier.length} earlier replies`
            }
            onOpen={() => setEarlierShown((was) => !was)}
          />
        </div>
      )}
      {shownReplies.map((message, at) => (
        <div key={message.id} className="contents">
          {newAt === start + at ? (
            <div data-prototype-feed-new="">
              <ThreadRule count={1} label="New" />
            </div>
          ) : null}
          <FeedLine
            message={message}
            clamp={!whole}
            onMarkUnread={() => onMarkUnreadFrom(start + at)}
            onView={onView}
          />
        </div>
      ))}
    </div>
  );
}

/** PROTOTYPE: whether the list repeats itself, to measure the scroll over many full composers. */
const STRESS =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("feedStress");

/** How many of a thread's latest replies its card shows, the rest folded above them. */
const LATEST_REPLIES = 3;

/** Where a thread stands: the Manager's face, or the task's glyph. */
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

/** Whether something of the thread is new to the reader, or its reminder came due. */
function isUnread(standing: ThreadStanding): boolean {
  return standing.unread.length > 0 || fired.has(standing.thread.id);
}

/** The reader's reminder on a thread, as the Inbox's Remind me sets one: when it comes due. */
const snoozed = new Map<string, number>();

/** The threads whose reminder came due, by when, which stand at the list's top, new, until read. */
const fired = new Map<string, number>();

/** Brings back every thread whose reminder is due, as Slack's Remind me does. */
function fireDue(now: number): readonly string[] {
  const due = [...snoozed].filter(([, at]) => at <= now).map(([id]) => id);

  for (const id of due) {
    snoozed.delete(id);
    fired.set(id, now);
  }

  if (due.length > 0) moved();

  return due;
}

/** The Inbox's Remind me times, as a menu's actions. */
function remindActions(onAt: (at: number) => void): MenuAction[] {
  const now = Date.now();

  return [
    // PROTOTYPE: a reminder that comes due at once, so a reviewer can watch one fire.
    { label: "In 10 seconds", detail: "Prototype", onSelect: () => onAt(Date.now() + 10_000) },
    ...REMIND_TIMES.map((time) => ({
      label: time.label,
      detail: remindWords(time.at(now), now),
      onSelect: () => onAt(time.at(Date.now())),
    })),
  ];
}

/** Remind me, the Inbox's own times. */
function RemindButton({ onAt }: { onAt: (at: number) => void }): React.JSX.Element {
  const menu = useMenu(true);

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

/** Mark as read, as a check, where something of it is new. */
function MarkReadButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Tooltip label="Mark as read">
      <IconButton
        icon={<CheckIcon />}
        label="Mark as read"
        size={BUTTON_SIZE.COMPACT}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** The acts a card or a line offers its reader: Remind me, and Mark as read where something is new. */
interface EntryDoors {
  readonly onView: () => void;
  /** Opens where the thread stands: the Manager's chat thread, or the task. */
  readonly onOpenPlace: () => void;
  readonly onRead: () => void;
  readonly onRemind: (at: number) => void;
  readonly onMarkUnreadFrom: (at: number) => void;
  readonly readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
  /** The window's agents, whose box each card's reply goes through. */
  readonly agents: AgentsControl;
}

/**
 * A thread as the feed draws it, Slack's Threads card: where it stands and
 * what it is about, its first message with its ask, the replies before the
 * reader's marker folded, New, the replies after, and its own box.
 */
function ThreadCard({
  standing,
  shownFrom,
  reminder,
  doors,
}: {
  standing: ThreadStanding;
  shownFrom: number;
  /** When the reader's reminder on it comes due; none where they set none. */
  reminder: number | undefined;
  doors: EntryDoors;
}): React.JSX.Element {
  const { thread } = standing;
  const unread = isUnread(standing);
  const due = fired.has(thread.id);
  const agentId = threadAgentOf(thread);

  return (
    <Card
      look={CARD_LOOK.SURFACE}
      padding={CARD_PADDING.FLUSH}
      data-prototype-feed-card={thread.id}
    >
      <div className="isolate">
        <div className="relative z-2 flex min-w-0 items-center gap-icon-gap px-card-head-inline pt-card-head-block">
          <UnreadMark unread={unread} />
          <HolderGlyph place={thread.place} />
          <span className="flex min-w-0 flex-1 items-baseline gap-icon-gap">
            <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={doors.onOpenPlace}>
              {holderName(thread.place)}
            </TextButton>
            <OneLine className={unread ? "font-ui-semibold text-foreground" : "text-foreground"}>
              {thread.title}
            </OneLine>
            {/* Its time, as Slack's Threads heads each thread with when it last moved. */}
            <span className="flex-none text-caption text-muted-foreground">
              <Time at={activityAt(standing)} look={TIME_LOOK.SINCE} />
            </span>
          </span>
          {due || reminder !== undefined ? (
            <span className="flex flex-none items-center gap-ui-4 text-caption text-muted-foreground">
              <GlyphSlot size={ICON_SIZE.SMALL}>
                <AlarmClockIcon aria-hidden="true" />
              </GlyphSlot>
              {due ? "Reminder" : remindWords(reminder ?? 0, Date.now())}
            </span>
          ) : null}
          <RemindButton onAt={doors.onRemind} />
          {unread ? <MarkReadButton onPress={doors.onRead} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-tight-gap px-card-head-inline pt-ui-8 pb-card-head-block">
          <ThreadBody
            key={`${thread.id}-${shownFrom}`}
            standing={standing}
            shownFrom={shownFrom}
            onView={doors.onView}
            onMarkUnreadFrom={doors.onMarkUnreadFrom}
            readInboxImage={doors.readInboxImage}
          />
          {agentId === undefined ? null : (
            <FeedComposer
              agentId={agentId}
              agents={doors.agents}
              onSend={(text) => reply(standing, text)}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * An agent that finished or failed without posting, or a pull request
 * merged, as one line of the feed, Slack's Activity row: who, when, what,
 * and where, quiet under it, with Mark as read beside it while it is new.
 */
function ActivityLine({
  standing,
  doors,
}: {
  standing: ThreadStanding;
  doors: EntryDoors;
}): React.JSX.Element {
  const message = standing.messages.at(-1);
  const unread = isUnread(standing);

  if (message === undefined) return <></>;

  return (
    <div className="flex min-w-0 items-start" data-prototype-feed-activity={standing.thread.id}>
      <span className="pt-ui-12">
        <UnreadMark unread={unread} />
      </span>
      <div className="min-w-0 flex-1">
        <ChannelMessage
          messageId={message.id}
          avatar={<Avatar by={message.by} />}
          name={nameOf(message.by)}
          at={<Time at={message.at} look={TIME_LOOK.DAY} />}
          actions={
            <>
              {unread ? (
                <MessageAction label="Mark as read" tooltip onClick={doors.onRead}>
                  <CheckIcon />
                </MessageAction>
              ) : (
                <MessageAction
                  label="Mark unread"
                  tooltip
                  onClick={() => doors.onMarkUnreadFrom(0)}
                >
                  <MailIcon />
                </MessageAction>
              )}
            </>
          }
          under={
            <span className="text-caption text-muted-foreground">{standing.thread.activity}</span>
          }
        >
          <TranscriptWords text={message.text} />
        </ChannelMessage>
      </div>
    </div>
  );
}

/** The feed's entries in the order they stood as the reader came, newest activity first, a reminder come due at the top. */
function activityAt(standing: ThreadStanding): number {
  return Math.max(standing.lastAt, fired.get(standing.thread.id) ?? 0);
}

/**
 * The Inbox as one list, Slack's Threads with its Activity beside it:
 * every thread the reader is in, each a card, and each agent that ended or
 * pull request merged a quiet line, newest activity first under its day,
 * what is new to the reader drawn bold. The list keeps the order it had as
 * the reader came, a thread written on staying where it stood until they
 * leave, and a reminder come due bringing its thread back to the top, new.
 * Unreads narrows it to what is new. View thread opens a Manager's thread
 * in the window's side panel, as its chat does. `only` narrows the list to
 * the Manager's threads, as its page's Inbox tab draws it.
 */
export function PrototypeInboxFeed({
  only,
  agents,
  onViewManagerThread,
  onViewTaskThread,
  onOpenManagerThread,
  onOpenTask,
  readInboxImage,
}: {
  only?: "manager" | undefined;
  agents: AgentsControl;
  onViewManagerThread: (root: string) => void;
  /** Opens a task agent's thread in the window's side panel, by the thread and its agent. */
  onViewTaskThread?: ((threadId: string, agentId: string) => void) | undefined;
  onOpenManagerThread: (root: string) => void;
  onOpenTask: (taskId: string) => void;
  readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}): React.JSX.Element {
  const feedVersion = useFeedVersion();
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  const [shownFrom, setShownFrom] = useState<ReadonlyMap<string, number>>(new Map());
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  /** The order the list stood in as the reader came, which it keeps until they leave; a reminder come due moves its thread to the top. */
  const order = useRef<string[] | undefined>(undefined);

  // Note that the version is read so every act draws the feed again.
  const standings = useMemo(
    () =>
      feedVersion >= 0
        ? THREADS.filter((thread) => only === undefined || thread.place.kind === only).map(
            standingOf,
          )
        : [],
    [feedVersion, only],
  );

  // Brings back what came due each second, as Slack's reminders land.
  useEffect(() => {
    const ticking = setInterval(() => {
      const due = fireDue(Date.now());

      if (order.current === undefined || due.length === 0) return;
      order.current = [...due, ...order.current.filter((id) => !due.includes(id))];
    }, 1000);

    return () => clearInterval(ticking);
  }, []);

  if (order.current === undefined) {
    order.current = standings
      .toSorted((a, b) => activityAt(b) - activityAt(a))
      .map((each) => each.thread.id);
  }

  // Note that a thread new to the list since the reader came stands at its top.
  const known = order.current;
  const arrived = standings
    .filter((each) => !known.includes(each.thread.id))
    .toSorted((a, b) => activityAt(b) - activityAt(a))
    .map((each) => each.thread.id);
  const ordered = [...arrived, ...known]
    .map((id) => standings.find((each) => each.thread.id === id))
    .filter((each) => each !== undefined);

  // Note that a thread read while Unreads stands stays in its place until the reader turns it off.
  const listed = unreadsOnly
    ? ordered.filter((each) => isUnread(each) || held.has(each.thread.id))
    : ordered;

  if (unreadsOnly && listed.some((each) => !held.has(each.thread.id))) {
    setHeld(new Set([...held, ...listed.map((each) => each.thread.id)]));
  }

  const unreadCount = ordered.filter(isUnread).length;

  const doorsOf = (standing: ThreadStanding): EntryDoors => ({
    onView: () => {
      // Note that the thread opens at the reader's marker, and opening it reads it.
      const { place } = standing.thread;
      setShownFrom((was) => new Map(was).set(standing.thread.id, standing.marker));
      openedFrom.set(standing.thread.id, standing.marker);
      markRead(standing);

      if (place.kind === "manager") onViewManagerThread(place.root);
      else if (place.agentId !== undefined) onViewTaskThread?.(standing.thread.id, place.agentId);
    },
    onOpenPlace: () =>
      standing.thread.place.kind === "manager"
        ? onOpenManagerThread(standing.thread.place.root)
        : onOpenTask(standing.thread.place.taskId),
    onRead: () => markRead(standing),
    onRemind: (at) => {
      snoozed.set(standing.thread.id, at);
      moved();
    },
    onMarkUnreadFrom: (at) => {
      markUnreadFrom(standing, at);
      setShownFrom((was) => new Map(was).set(standing.thread.id, at));
    },
    readInboxImage,
    agents,
  });

  const markAllRead = () => {
    for (const each of listed) {
      markers.set(each.thread.id, each.messages.length);
      fired.delete(each.thread.id);
    }

    moved();
  };

  const entryOf = (standing: ThreadStanding) =>
    standing.thread.activity === undefined ? (
      <ThreadCard
        key={standing.thread.id}
        standing={standing}
        shownFrom={shownFrom.get(standing.thread.id) ?? standing.marker}
        reminder={snoozed.get(standing.thread.id)}
        doors={doorsOf(standing)}
      />
    ) : (
      <ActivityLine key={standing.thread.id} standing={standing} doors={doorsOf(standing)} />
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-prototype-feed="">
      <div className="flex flex-none justify-center px-list-inset pt-list-inset pb-tight-gap">
        <div className="flex w-full max-w-page-measure items-center justify-end gap-control-gap">
          <Button
            variant={BUTTON_VARIANT.QUIET}
            size={BUTTON_SIZE.COMPACT}
            pressed={unreadsOnly}
            trailing={unreadCount === 0 ? undefined : String(unreadCount)}
            onClick={() => {
              setUnreadsOnly((was) => !was);
              setHeld(new Set());
            }}
          >
            Unreads
          </Button>
          <Tooltip label="Mark all as read">
            <IconButton
              icon={<CheckCheckIcon />}
              label="Mark all as read"
              size={BUTTON_SIZE.COMPACT}
              onClick={markAllRead}
            />
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-prototype-feed-stream="">
        <div className="mx-auto flex w-full max-w-page-measure flex-col gap-tight-gap px-list-inset pb-list-inset">
          {listed.length === 0 ? (
            <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}>
              {unreadsOnly ? "Nothing unread." : "Nothing here."}
            </EmptyState>
          ) : (
            // PROTOTYPE: `?feedStress=1` repeats the list six times, to measure the scroll over many full composers.
            (STRESS ? Array.from({ length: 6 }, () => listed).flat() : listed).map((each, at) => (
              <div key={`${each.thread.id}-${at}`} className="contents">
                {entryOf(each)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export { PROTO_MANAGER };
