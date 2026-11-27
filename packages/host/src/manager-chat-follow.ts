import {
  AGENT_CALL_FAILURE,
  type AgentChatSendAnswerView,
  type AgentChatSendParams,
  type AgentTranscriptOlderAnswer,
  type ManagerChatEditAnswerView,
  type ManagerChatEditParams,
  type ManagerChatReactAnswerView,
  type ManagerChatReactParams,
  type ManagerChatSending,
  type ManagerChatUnsendParams,
} from "@repo/features/agent-view";
import type { FailureFacts } from "@repo/features/failure-facts";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  MANAGER_CHAT_READ,
  type ManagerChatPageView,
  managerChatPageOf,
  withEditPress,
  withReactionPress,
} from "@repo/features/manager-chat-live";
import { Clock, Effect, Option, Schema, type Scope } from "effect";
import { type AppManagerChat, type AppManagerChats, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldRows, type HeldSlice, heldSlice } from "./live-collection.js";
import type { LiveFailure, SealedRead } from "./live-follow.js";
import { pushLive } from "./live-push.js";

/**
 * manager-chat-follow.ts -- each Manager's chat the windows show, its newest page followed over the service's held poll and the older pages read past it laid after it, told whole on its app-state slice.
 *
 * A Manager's chat is its own rows (`manager_chat_message`), read a page at
 * a time, newest first (`@repo/features/manager-chat-live`). A window holds
 * a chat by its agent's id while it shows it, and the host follows the
 * chat's newest page while any window holds it, the few let go lately
 * standing paused, so a chat shown again draws its messages in its first
 * frame (`heldSlice`). Each newest page is laid over the older pages held
 * (`withNewestPage`), so a chat read back keeps what it read as messages
 * land. An older page is read once, its rows inline, and laid past the
 * messages held only while they still end where it was asked
 * (`withOlderPage`), so one that answers after the held chat moved leaves
 * no gap.
 *
 * A message the reader sends stands drawn on the chat from the moment it is
 * sent (`sending`), whether or not the chat is held, until a row written
 * under the key it went under stands in the chat's messages, which lets it go
 * in the draw the row lands in, whether the read brings the row before the
 * send answers or after. One the service
 * refused stands marked with why until it is sent again under its key,
 * which draws it on its way again, or let go (`unsend`). Note that the
 * messages on their way are kept for the account that sent them, in this
 * process alone, and a sign-out lets them all go, since the next account
 * signed in may reach the same chat but never another's words that did not go.
 *
 * A reaction the reader gives a message, or takes off it, is written into
 * the chat held as the service takes it (`reacting`), as a read would
 * carry it, so it stands from the answer rather than from the next read;
 * the window draws it before that, while it is asked. One refused writes
 * nothing. An edit of the reader's own message is written into the chat
 * held the same way (`editing`), its words those given and marked edited.
 */

/** A read the service did not answer, as the client and the gate tell it, with what failed beneath it where the client said. */
interface ChatUnanswered {
  readonly failure: string;
  readonly cause?: FailureFacts;
}

/** The parts of a chat's read: its messages. */
type ChatPart = keyof typeof MANAGER_CHAT_READ.parts;

/** A chat's read sealed, its rows inline where it was polled. */
type ChatSealed = SealedRead<ChatPart>;

/** A delivery's rows, by part, as they arrive, before they are decoded. */
type ChatRows = Readonly<Record<ChatPart, readonly unknown[]>>;

/** One page of a Manager's chat as it is sealed: the agent's, for the account, before the `seq` it names, the newest where it names none. */
export interface ManagerChatPageAsked {
  readonly agentId: string;
  readonly userId: string;
  readonly before?: number;
}

export interface ManagerChatFollowDependencies {
  /** The read of the page asked sealed, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    page: ManagerChatPageAsked,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<ChatSealed | ChatUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** Epoch milliseconds now, which a message sent is stamped with. */
  readonly now: () => number;
  readonly tell: (held: AppManagerChats) => void;
}

/** A person's message sent to a Manager's chat, as the service is asked it. */
type ChatSend = (params: AgentChatSendParams) => Effect.Effect<AgentChatSendAnswerView>;

/** A member's reaction to a message of a Manager's chat, as the service is asked it. */
type ChatReact = (params: ManagerChatReactParams) => Effect.Effect<ManagerChatReactAnswerView>;

/** A member's edit of their own message of a Manager's chat, as the service is asked it. */
type ChatEdit = (params: ManagerChatEditParams) => Effect.Effect<ManagerChatEditAnswerView>;

/** The held chats, the read of an older page of one laid on them, and the reader's messages on their way to one drawn over it. */
export type HeldManagerChats = HeldSlice<string> &
  HeldRows<string, AppManagerChat> & {
    /** Reads the page of `agentId`'s chat before `before` and lays it past the messages held where they still end there: whether it landed, or why it was not read. */
    readonly older: (agentId: string, before: number) => Effect.Effect<AgentTranscriptOlderAnswer>;
    /** `send` drawn on the chat as the message it sends: on its way from the moment it is asked until its row lands, or refused, marked with why. */
    readonly sending: (send: ChatSend) => ChatSend;
    /** A refused message let go, by the key it went under. */
    readonly unsend: (params: ManagerChatUnsendParams) => Effect.Effect<void>;
    /** `react` written into the chat held as the reaction it gives or takes off, once the service takes it. */
    readonly reacting: (react: ChatReact) => ChatReact;
    /** `edit` written into the chat held as the words it gives the message, marked edited, once the service takes it. */
    readonly editing: (edit: ChatEdit) => ChatEdit;
  };

const decodePage = Schema.decodeUnknownOption(MANAGER_CHAT_READ.rows);

/** A refusal that names nothing the account reaches, after which the read is followed no longer. */
function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/** A sealed answer as a follow reads it, a failure marked gone where it names nothing the account reaches, with what failed beneath it. */
function sealedOrGone(sealed: ChatSealed | ChatUnanswered): ChatSealed | LiveFailure {
  if (!("failure" in sealed)) return sealed;
  const { failure, cause } = sealed;
  const gone = goneAfter(failure);

  return cause === undefined ? { failure, gone } : { failure, cause, gone };
}

/** The page a delivery's rows stand for; none where a row does not decode. */
function pageOfRows(rows: ChatRows): Option.Option<ManagerChatPageView> {
  return Option.map(decodePage(rows), managerChatPageOf);
}

/** The newest `seq` of the messages held, newest first; none where none are held. */
function newestSeq(chat: AppManagerChat): number | undefined {
  return chat.messages[0]?.seq;
}

/**
 * A chat's newest page laid over the chat held: the page whole, then every
 * older message held past it, and where the next older page is read before,
 * as the held chat says. Note that the held messages are kept only where the
 * page reaches back to them, because a page whose oldest message is newer
 * than every one held may stand past messages neither holds, which would
 * stand as a gap; the page alone is drawn then, as is a page that reaches
 * the chat's start.
 */
function withNewestPage(
  held: AppManagerChat | undefined,
  page: ManagerChatPageView,
): AppManagerChat {
  const oldest = page.messages.at(-1)?.seq;
  const newest = held === undefined ? undefined : newestSeq(held);

  if (held === undefined || page.before === undefined || oldest === undefined) return page;

  if (newest === undefined || oldest > newest) return page;
  const older = held.messages.filter((message) => message.seq < oldest);

  if (older.length === 0) return page;
  const messages = [...page.messages, ...older];

  return held.before === undefined ? { messages } : { messages, before: held.before };
}

/**
 * An older page of a chat, read before the `seq` `before` names, laid past
 * the chat held: the messages held, then the page, and where the next older
 * page is read before as the page says. None where the chat held no longer
 * ends at `before`, as after a newer page took its place, or is not held.
 */
function withOlderPage(
  held: AppManagerChat | undefined,
  before: number,
  page: ManagerChatPageView,
): AppManagerChat | undefined {
  if (held === undefined || held.before !== before) return undefined;
  const messages = [...held.messages, ...page.messages];

  return page.before === undefined ? { messages } : { messages, before: page.before };
}

/** Follows `agentId`'s newest page live until let go, each page laid over the older ones held, drawn with the messages on their way (`drawn`), and told through `answers`, and unanswered where a page could not be read. */
function followChat(
  dependencies: ManagerChatFollowDependencies,
  agentId: string,
  answers: HeldAnswers<AppManagerChat>,
  drawn: (agentId: string, chat: ManagerChatPageView) => AppManagerChat,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
  const userId = dependencies.accountId();

  return pushLive({
    seal: (poll, after) =>
      dependencies.gate() && userId !== undefined
        ? Effect.map(dependencies.seal({ agentId, userId }, poll, after), sealedOrGone)
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: pageOfRows,
    publish: (page, cause) =>
      Effect.sync(() => {
        if (page === undefined) return answers.unanswered(cause);
        answers.answered(drawn(agentId, withNewestPage(answers.rows(), page)));
      }),
  });
}

/** `sending` with `message` in its key's place, or after the rest where none stands under its key. */
function withSending(
  sending: readonly ManagerChatSending[],
  message: ManagerChatSending,
): readonly ManagerChatSending[] {
  const at = sending.findIndex((each) => each.clientKey === message.clientKey);

  return at === -1 ? [...sending, message] : sending.with(at, message);
}

/**
 * The held lifetime over every Manager's chat the windows show
 * (`heldSlice`), told whole on its slice: each chat's newest page as its
 * follow last told it with the older pages read past it and the messages on
 * their way, kept where a later read does not answer, and failed where it
 * never answered. A chat let go stops following, its messages standing for
 * a window that steps back to it. One the service refused for good, an
 * agent the account does not reach or one that is no Manager, is told failed
 * and followed no longer until every window lets it go and one holds it anew.
 */
export function heldManagerChats(
  dependencies: ManagerChatFollowDependencies,
): Effect.Effect<HeldManagerChats, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** The reader's messages on their way to each chat, by the agent's id, oldest sent first. */
    const sendings = new Map<string, readonly ManagerChatSending[]>();

    /** `chat` with the messages on their way to it, each whose row it holds, by the key it went under, let go. */
    const drawn = (agentId: string, chat: ManagerChatPageView): AppManagerChat => {
      const landed = new Set(chat.messages.map((message) => message.clientKey));

      const sending = (sendings.get(agentId) ?? []).filter(
        (message) => !landed.has(message.clientKey),
      );

      if (sending.length === 0) sendings.delete(agentId);
      else sendings.set(agentId, sending);
      const { messages, before } = chat;
      const page = before === undefined ? { messages } : { messages, before };

      return sending.length === 0 ? page : { ...page, sending };
    };

    const slice = yield* heldSlice<typeof LIVE_READ.MANAGER_CHAT, string>({
      empty: NO_KEYS_HELD,
      path: (agentId) => [agentId],
      gate: dependencies.gate,
      follow: (agentId, answers) => followChat(dependencies, agentId, answers, drawn),
      tell: dependencies.tell,
      pause: true,
    });

    // Note that a chat not read yet draws its messages on their way with its first page, so nothing is laid over a chat that holds none.
    const redraw = (agentId: string) => {
      const chat = slice.rowsOf(agentId);

      if (chat !== undefined) slice.lay(agentId, drawn(agentId, chat));
    };

    const draw = (agentId: string, message: ManagerChatSending) => {
      sendings.set(agentId, withSending(sendings.get(agentId) ?? [], message));
      redraw(agentId);
    };

    // Note that the page is polled with no `after`, so its rows come inline at once rather than held for a move.
    const older = (agentId: string, before: number) =>
      Effect.gen(function* () {
        const userId = dependencies.accountId();

        if (!dependencies.gate() || userId === undefined) {
          return { failure: AGENT_CALL_FAILURE.UNANSWERED };
        }

        const sealed = yield* dependencies.seal({ agentId, userId, before }, true);

        if ("failure" in sealed) {
          return {
            failure:
              sealed.failure === AGENT_CALL_FAILURE.NOT_FOUND
                ? AGENT_CALL_FAILURE.NOT_FOUND
                : AGENT_CALL_FAILURE.UNANSWERED,
          };
        }

        const rows = sealed.queries.messages.rows;
        const page = rows === undefined ? Option.none() : pageOfRows({ messages: rows });

        if (Option.isNone(page)) return { failure: AGENT_CALL_FAILURE.UNANSWERED };
        const laid = withOlderPage(slice.rowsOf(agentId), before, page.value);

        if (laid !== undefined) slice.lay(agentId, drawn(agentId, laid));

        return { landed: laid !== undefined };
      });

    // Note that a message sent again under its key takes its refused one's place, drawn on its way again in the same draw.
    const sending =
      (send: ChatSend): ChatSend =>
      (params) =>
        Effect.gen(function* () {
          const { agentId, clientKey, text, attachments, threadRoot } = params;
          const sentBy = dependencies.accountId();

          const message: ManagerChatSending = {
            clientKey,
            text,
            ...(attachments === undefined ? undefined : { attachments }),
            ...(threadRoot === undefined ? undefined : { threadRoot }),
            sentAt: dependencies.now(),
            ...(sentBy === undefined ? undefined : { sentBy }),
          };

          draw(agentId, message);
          const answer = yield* send(params);

          // Note that a message the service took stands on its way until its row lands, which may be before this answer or after.
          if ("failure" in answer) draw(agentId, { ...message, refused: answer });

          return answer;
        });

    const unsend = ({ agentId, clientKey }: ManagerChatUnsendParams) =>
      Effect.sync(() => {
        const kept = (sendings.get(agentId) ?? []).filter(
          (message) => message.clientKey !== clientKey || message.refused === undefined,
        );

        sendings.set(agentId, kept);
        redraw(agentId);
      });

    const reacting =
      (react: ChatReact): ChatReact =>
      (params) =>
        Effect.gen(function* () {
          const answer = yield* react(params);
          const { agentId, ...press } = params;
          const chat = slice.rowsOf(agentId);

          if ("failure" in answer || chat === undefined) return answer;
          slice.lay(agentId, { ...chat, messages: withReactionPress(chat.messages, press) });

          return answer;
        });

    const editing =
      (edit: ChatEdit): ChatEdit =>
      (params) =>
        Effect.gen(function* () {
          const answer = yield* edit(params);
          const { agentId, messageId, text } = params;
          const chat = slice.rowsOf(agentId);

          if ("failure" in answer || !answer.changed || chat === undefined) return answer;
          const editedAt = yield* Clock.currentTimeMillis;
          const messages = withEditPress(chat.messages, { messageId, text, editedAt });
          slice.lay(agentId, { ...chat, messages });

          return answer;
        });

    // Note that a sign-out lets every message on its way go with the chats, since they are the signed-out account's words.
    const end = Effect.andThen(
      Effect.sync(() => sendings.clear()),
      slice.end,
    );

    return { ...slice, end, older, sending, unsend, reacting, editing };
  });
}
