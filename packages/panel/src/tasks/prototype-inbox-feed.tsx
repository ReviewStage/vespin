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
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CHOICE_BAR_LOOK,
  ChannelMessage,
  ChoiceBar,
  COMPOSER_LOOK,
  ComposerFoot,
  ComposerFrame,
  EmptyState,
  GlyphSlot,
  IconButton,
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
  XIcon,
} from "@repo/ui/icons";
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
    activity: "Pull request merged in Teammate invitations",
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
}: {
  message: FeedMessage;
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
      <MessageField
        box={box}
        look={COMPOSER_LOOK.BARE}
        // PROTOTYPE: the editor keeps its overscroll to itself, which would stop the feed's scroll over every card's box.
        className="[&_.composer-editor]:overscroll-auto!"
      />
      <ComposerFoot send={{ label: "Reply", empty: words.trim() === "", onSend: send }} />
    </ComposerFrame>
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
  // Note that the first message always stands, so the marker never folds it, and a thread read through shows its latest reply under the fold, as Slack's Threads does.
  const read = Math.max(Math.min(shownFrom, messages.length), 1);
  const marker =
    !whole && read >= messages.length && messages.length > 1 ? messages.length - 1 : read;
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
        <FeedLine
          message={root}
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
                  ? "Show 1 more reply"
                  : `Show ${earlier.length} more replies`
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
              onView={onView}
            />
          ))
        : null}
      {after.length === 0 || shownFrom === 0 || read >= messages.length ? null : (
        <div data-prototype-feed-new="">
          <ThreadRule count={1} label="New" />
        </div>
      )}
      {after.map((message, at) => (
        <FeedLine
          key={message.id}
          message={message}
          onMarkUnread={() => onMarkUnreadFrom(marker + at)}
          onView={onView}
        />
      ))}
    </div>
  );
}

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

/** Whether something of the thread is new to the reader. */
function isUnread(standing: ThreadStanding): boolean {
  return standing.unread.length > 0;
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
  readonly onRead: () => void;
  readonly onRemind: (at: number) => void;
  readonly onMarkUnreadFrom: (at: number) => void;
  readonly readInboxImage: (input: { itemId: string; attachmentId: string }) => Promise<unknown>;
}

/**
 * A thread as the feed draws it, Slack's Threads card: where it stands and
 * what it is about, its first message with its ask, the replies before the
 * reader's marker folded, New, the replies after, and its own box.
 */
function ThreadCard({
  standing,
  shownFrom,
  doors,
}: {
  standing: ThreadStanding;
  shownFrom: number;
  doors: EntryDoors;
}): React.JSX.Element {
  const { thread } = standing;
  const unread = isUnread(standing);

  return (
    <Card
      look={CARD_LOOK.SURFACE}
      padding={CARD_PADDING.FLUSH}
      data-prototype-feed-card={thread.id}
    >
      <div className="relative z-2 flex min-w-0 items-center gap-icon-gap px-card-head-inline pt-card-head-block">
        <UnreadMark unread={unread} />
        <HolderGlyph place={thread.place} />
        <span className="flex min-w-0 flex-1 items-baseline gap-icon-gap">
          <OneLine className="font-ui-semibold text-foreground">{holderName(thread.place)}</OneLine>
          <OneLine className="text-caption text-muted-foreground">{thread.title}</OneLine>
        </span>
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
        <ReplyBox onSend={(text) => reply(standing, text)} />
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

/** The whole thread beside the feed, Slack's Thread panel: where it stands, which opens it, every message, and its box. */
function ThreadSide({
  standing,
  shownFrom,
  narrow,
  onClose,
  onOpenPlace,
  doors,
}: {
  standing: ThreadStanding;
  shownFrom: number;
  narrow: boolean;
  onClose: () => void;
  onOpenPlace: () => void;
  doors: EntryDoors;
}): React.JSX.Element {
  const { thread } = standing;
  const scroller = useRef<HTMLDivElement>(null);

  // Note that the thread opens at New, as Slack's lands at the first unread, scrolling its own box alone.
  useEffect(() => {
    const box = scroller.current;
    const rule = box?.querySelector<HTMLElement>("[data-prototype-feed-new]");

    if (box !== null && box !== undefined && rule !== null && rule !== undefined) {
      box.scrollTop = rule.offsetTop - box.offsetTop - 120;
    }
  }, [thread.id]);

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col ${narrow ? "flex-1" : "w-[440px] flex-none border-s border-border"}`}
      data-prototype-feed-side={thread.id}
    >
      <div className="flex flex-none items-center gap-control-gap border-b border-border px-list-inset py-tight-gap">
        {narrow ? <BackButton label="Inbox" place="inbox" onBack={onClose} /> : null}
        <span className="flex min-w-0 flex-1 items-baseline gap-icon-gap">
          <span className="font-ui-semibold text-foreground">Thread</span>
          <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={onOpenPlace}>
            {holderName(thread.place)}
          </TextButton>
        </span>
        {narrow ? null : (
          <IconButton
            icon={<XIcon />}
            label="Close thread"
            size={BUTTON_SIZE.COMPACT}
            onClick={onClose}
          />
        )}
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto px-list-inset py-list-inset"
      >
        <ThreadBody
          key={`${thread.id}-${shownFrom}`}
          standing={standing}
          shownFrom={shownFrom}
          whole
          onMarkUnreadFrom={doors.onMarkUnreadFrom}
          readInboxImage={doors.readInboxImage}
        />
      </div>
      <div className="flex-none px-list-inset pb-list-inset">
        <ReplyBox key={thread.id} onSend={(text) => reply(standing, text)} />
      </div>
    </div>
  );
}

/** Which threads the feed lists, as today's Inbox's views choose them. */
const FEED_VIEW = {
  QUESTIONS: "questions",
  OPEN: "open",
  ALL: "all",
  REMINDERS: "reminders",
} as const;

type FeedView = (typeof FEED_VIEW)[keyof typeof FEED_VIEW];

/** Whether the feed lists activity lines beside its threads, the prototype's one fork. */
const FEED_SHAPE = {
  WITH_ACTIVITY: "with-activity",
  THREADS: "threads",
} as const;

type FeedShape = (typeof FEED_SHAPE)[keyof typeof FEED_SHAPE];

/** The day a moment falls on, as the feed heads its days: Today, Yesterday, or the weekday and date. */
function dayWords(at: number, now: number): string {
  const day = new Date(at);
  const today = new Date(now);
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(day)) / (24 * HOUR));

  if (days === 0) return "Today";

  if (days === 1) return "Yesterday";

  return day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/**
 * The Inbox as one feed, Slack's Threads and Activity in one stream: each
 * thread a card, each agent that ended or pull request merged a line,
 * newest first under its day, in today's Inbox's views (Questions, the asks
 * waiting on the reader; Open, what they are not done with; All; and
 * Reminders), Unreads narrowing any view to what is new. Nothing leaves the
 * stream as it is read or answered: it stands where it was, read or
 * answered, and a view lets go of it only once the reader moves to
 * another. View thread opens the whole thread beside the feed, which reads
 * it, its head naming the Manager or the task it opens. `only` narrows the
 * feed to the Manager's threads, as its page's Inbox tab draws it;
 * `narrow`, a phone's room, shows the feed or the thread.
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
  const [view, setView] = useState<FeedView>(FEED_VIEW.OPEN);
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  const [shape, setShape] = useState<FeedShape>(FEED_SHAPE.WITH_ACTIVITY);
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [shownFrom, setShownFrom] = useState<ReadonlyMap<string, number>>(new Map());
  const listing = `${view}-${unreadsOnly}-${shape}`;
  const [held, setHeld] = useState<{ readonly listing: string; readonly ids: ReadonlySet<string> }>(
    { listing, ids: new Set() },
  );

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

  /** Whether a view lists a thread now, as today's Inbox's views read an item. */
  const inView = (standing: ThreadStanding, by: FeedView) => {
    if (by === FEED_VIEW.REMINDERS) return isSnoozed(standing);

    if (isSnoozed(standing)) return false;

    if (by === FEED_VIEW.QUESTIONS) return standing.openAsk;

    if (by === FEED_VIEW.OPEN) return standing.openAsk || isUnread(standing);

    return true;
  };

  const listedNow = (standing: ThreadStanding) =>
    (shape === FEED_SHAPE.WITH_ACTIVITY || standing.thread.activity === undefined) &&
    inView(standing, view) &&
    (!unreadsOnly || isUnread(standing));

  // Note that what a listing showed stays in its place once read or answered, until the reader moves to another listing; one reminded leaves at once.
  const heldIds = held.listing === listing ? held.ids : new Set<string>();

  const listed = standings.filter(
    (each) =>
      listedNow(each) ||
      (heldIds.has(each.thread.id) && (view === FEED_VIEW.REMINDERS || !isSnoozed(each))),
  );

  if (held.listing !== listing || listed.some((each) => !held.ids.has(each.thread.id))) {
    setHeld({
      listing,
      ids: new Set([...heldIds, ...listed.map((each) => each.thread.id)]),
    });
  }

  const count = (by: FeedView) =>
    standings.filter(
      (each) =>
        (shape === FEED_SHAPE.WITH_ACTIVITY || each.thread.activity === undefined) &&
        inView(each, by),
    ).length;

  const shown = standings.find((each) => each.thread.id === viewing);

  const doorsOf = (standing: ThreadStanding): EntryDoors => ({
    onView: () => {
      // Note that the thread opens at the reader's marker, and opening it reads it.
      setViewing(standing.thread.id);
      setShownFrom((was) => new Map(was).set(standing.thread.id, standing.marker));
      markRead(standing);
    },
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
  });

  const markAllRead = () => {
    for (const each of listed) markers.set(each.thread.id, each.messages.length);
    moved();
  };

  // The feed's entries under their days, newest first.
  const days: { readonly day: string; readonly entries: ThreadStanding[] }[] = [];

  for (const each of listed) {
    const day = dayWords(each.lastAt, now);
    const last = days.at(-1);

    if (last?.day === day) last.entries.push(each);
    else days.push({ day, entries: [each] });
  }

  const entryOf = (standing: ThreadStanding) =>
    standing.thread.activity === undefined ? (
      <ThreadCard
        key={standing.thread.id}
        standing={standing}
        shownFrom={shownFrom.get(standing.thread.id) ?? standing.marker}
        doors={doorsOf(standing)}
      />
    ) : (
      <ActivityLine key={standing.thread.id} standing={standing} doors={doorsOf(standing)} />
    );

  const counted = (by: FeedView) => {
    const n = count(by);

    return n === 0 ? undefined : [{ text: String(n) }];
  };

  const feed = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-prototype-feed-stream="">
      <div className="flex flex-none justify-center px-list-inset pt-list-inset pb-tight-gap">
        <div className="flex w-full max-w-[760px] flex-wrap items-center gap-control-gap">
          <span className="min-w-0 flex-1">
            <ChoiceBar
              label="Inbox view"
              items={[
                {
                  value: FEED_VIEW.QUESTIONS,
                  label: "Questions",
                  count: counted(FEED_VIEW.QUESTIONS),
                },
                { value: FEED_VIEW.OPEN, label: "Open", count: counted(FEED_VIEW.OPEN) },
                { value: FEED_VIEW.ALL, label: "All" },
                {
                  value: FEED_VIEW.REMINDERS,
                  label: "Reminders",
                  count: counted(FEED_VIEW.REMINDERS),
                },
              ]}
              value={view}
              look={CHOICE_BAR_LOOK.FILL}
              onChange={setView}
            />
          </span>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            size={BUTTON_SIZE.COMPACT}
            pressed={unreadsOnly}
            onClick={() => setUnreadsOnly((was) => !was)}
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
      <div className="flex flex-none justify-center px-list-inset pb-tight-gap">
        <div className="flex w-full max-w-[760px] items-center gap-control-gap">
          <span className="text-caption text-muted-foreground">Prototype variant</span>
          <span className="min-w-0 flex-1">
            <ChoiceBar
              label="Prototype variant"
              items={[
                { value: FEED_SHAPE.WITH_ACTIVITY, label: "Threads and activity" },
                { value: FEED_SHAPE.THREADS, label: "Threads only" },
              ]}
              value={shape}
              look={CHOICE_BAR_LOOK.FILL}
              onChange={setShape}
            />
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-tight-gap px-list-inset pb-list-inset">
          {listed.length === 0 ? (
            <EmptyState icon={<EntityGlyph kind={ENTITY_KIND.INBOX_ITEM} />}>
              {unreadsOnly ? "Nothing unread here." : "Nothing here."}
            </EmptyState>
          ) : (
            days.map(({ day, entries }) => (
              <div key={day} className="flex flex-col gap-tight-gap">
                <ThreadRule count={1} label={day} />
                {entries.map(entryOf)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const side =
    shown === undefined ? null : (
      <ThreadSide
        standing={shown}
        shownFrom={shownFrom.get(shown.thread.id) ?? shown.marker}
        narrow={narrow}
        onClose={() => setViewing(undefined)}
        onOpenPlace={() =>
          shown.thread.place.kind === "manager"
            ? onOpenManagerThread(shown.thread.place.root)
            : onOpenTask(shown.thread.place.taskId)
        }
        doors={doorsOf(shown)}
      />
    );

  if (narrow) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-prototype-feed="">
        {side ?? feed}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-prototype-feed="">
      {feed}
      {side}
    </div>
  );
}

export { PROTO_MANAGER };
