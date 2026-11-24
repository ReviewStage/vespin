import { AGENT_CALL_FAILURE, type AgentTranscriptOlderAnswer } from "@repo/features/agent-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  MANAGER_CHAT_READ,
  type ManagerChatPageView,
  managerChatPageOf,
} from "@repo/features/manager-chat-live";
import { Effect, Option, Schema, type Scope } from "effect";
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
 */

/** A read the service did not answer, as the client and the gate tell it. */
interface ChatUnanswered {
  readonly failure: string;
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
  readonly tell: (held: AppManagerChats) => void;
}

/** The held chats, and the read of an older page of one laid on them. */
export type HeldManagerChats = HeldSlice<string> &
  HeldRows<string, AppManagerChat> & {
    /** Reads the page of `agentId`'s chat before `before` and lays it past the messages held where they still end there: whether it landed, or why it was not read. */
    readonly older: (agentId: string, before: number) => Effect.Effect<AgentTranscriptOlderAnswer>;
  };

const decodePage = Schema.decodeUnknownOption(MANAGER_CHAT_READ.rows);

/** A refusal that names nothing the account reaches, after which the read is followed no longer. */
function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/** A sealed answer as a follow reads it, a failure marked gone where it names nothing the account reaches. */
function sealedOrGone(sealed: ChatSealed | ChatUnanswered): ChatSealed | LiveFailure {
  return "failure" in sealed
    ? { failure: sealed.failure, gone: goneAfter(sealed.failure) }
    : sealed;
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

/** Follows `agentId`'s newest page live until let go, each page laid over the older ones held and told through `answers`, and unanswered where a page could not be read. */
function followChat(
  dependencies: ManagerChatFollowDependencies,
  agentId: string,
  answers: HeldAnswers<AppManagerChat>,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
  const userId = dependencies.accountId();

  return pushLive({
    seal: (poll, after) =>
      dependencies.gate() && userId !== undefined
        ? Effect.map(dependencies.seal({ agentId, userId }, poll, after), sealedOrGone)
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    decode: pageOfRows,
    publish: (page) =>
      Effect.sync(() => {
        if (page === undefined) return answers.unanswered();
        answers.answered(withNewestPage(answers.rows(), page));
      }),
  });
}

/**
 * The held lifetime over every Manager's chat the windows show
 * (`heldSlice`), told whole on its slice: each chat's newest page as its
 * follow last told it with the older pages read past it, kept where a later
 * read does not answer, and failed where it never answered. A chat let go
 * stops following, its messages standing for a window that steps back to it.
 * One the service refused for good, an agent the account does not reach or
 * one that is no Manager, is told failed and followed no longer until every
 * window lets it go and one holds it anew.
 */
export function heldManagerChats(
  dependencies: ManagerChatFollowDependencies,
): Effect.Effect<HeldManagerChats, never, Scope.Scope> {
  return Effect.map(
    heldSlice<typeof LIVE_READ.MANAGER_CHAT, string>({
      empty: NO_KEYS_HELD,
      path: (agentId) => [agentId],
      gate: dependencies.gate,
      follow: (agentId, answers) => followChat(dependencies, agentId, answers),
      tell: dependencies.tell,
      pause: true,
    }),
    (slice) => ({
      ...slice,
      // Note that the page is polled with no `after`, so its rows come inline at once rather than held for a move.
      older: (agentId, before) =>
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

          if (laid !== undefined) slice.lay(agentId, laid);

          return { landed: laid !== undefined };
        }),
    }),
  );
}
