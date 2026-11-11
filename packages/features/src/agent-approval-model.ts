/**
 * agent-approval-model.ts -- how a window holds the calls an agent holds for an answer: each ask waiting, answered, or settled without it, and the words its row and its presses say, which the panel's tab and the iPhone's agent page both draw.
 *
 * The agent's row carries the asks that wait (`pendingApprovals`). A window
 * takes each in as it first sees it and keeps it once it leaves the row, so
 * a call answered here says how it came out ("Allowed", "Denied"), and one
 * that stopped waiting with no answer of this window's says why: denied by
 * a message the window sent while it waited, answered elsewhere while the
 * agent still runs, or expired as its turn ended. One that comes back to the
 * row opens again, since a write that left it may still let it go.
 */

import {
  type AgentPendingApproval,
  APPROVAL_STATUS,
  type ApprovalStatus,
} from "./agent-approval-wire.js";
import { AGENT_CALL_FAILURE } from "./agent-view.js";

/** What a held call's line says: that it waits, then how it came out. */
export const HELD_WORDS = {
  WAITING: "Waiting for approval",
  ALLOWED: "Allowed",
  ALLOWED_FOR_AGENT: "Always allowed",
  DENIED: "Denied",
  EXPIRED: "Expired",
  ELSEWHERE: "Answered elsewhere",
} as const;

/** What the presses on a held call say, and say while their answer is out. */
export const APPROVAL_PRESS_WORDS = {
  ALLOW: "Allow",
  ALLOW_FOR_AGENT: "Always allow",
  ALLOWING: "Allowing",
  DENY: "Deny",
  DENYING: "Denying",
} as const;

/** Why an answer did not go: refused as not the reader's to answer or gone, or not heard back, which a press again may mend. */
const ANSWER_FAILED = {
  NOT_PERMITTED: "Only a member who controls this agent can answer it.",
  NOT_FOUND: "This approval is no longer here.",
  UNANSWERED: "The answer did not reach the agent. Try again.",
} as const;

/** What the composer says over its field while an ask waits. */
export const DENIES_WAITING = "Sending a message denies the waiting approval.";

/** Who asks, where a subagent does, said in the row's body. */
const SUBAGENT_ASKS = "Asked by a subagent.";

/** The word an ask's line settles into by the status it stands at, as an answer lands or finds it settled already. */
export const SETTLED_WORD = {
  [APPROVAL_STATUS.PENDING]: undefined,
  [APPROVAL_STATUS.ALLOWED]: HELD_WORDS.ALLOWED,
  [APPROVAL_STATUS.ALLOWED_FOR_AGENT]: HELD_WORDS.ALLOWED_FOR_AGENT,
  [APPROVAL_STATUS.DENIED]: HELD_WORDS.DENIED,
  [APPROVAL_STATUS.EXPIRED]: HELD_WORDS.EXPIRED,
} as const satisfies Record<ApprovalStatus, string | undefined>;

/** One ask as a window holds it: the ask, the answer out, how it settled, and why an answer did not go, in the window's own terms. */
export interface HeldAsk<Answering, Failure> {
  readonly approval: AgentPendingApproval;
  readonly answering?: Answering | undefined;
  /** The word its line settled into; none while it waits. */
  readonly settled?: string | undefined;
  /** Whether it was settled only by leaving the row's waiting asks, which its return to them takes back. */
  readonly vanished?: boolean | undefined;
  /** Whether a message went while it waited, which the service denies it with; a return to the waiting asks clears it. */
  readonly messaged?: boolean | undefined;
  readonly error?: Failure | undefined;
}

/** The line an ask that stopped waiting with no answer of this window's settles into. */
export function vanishedLine(byMessage: boolean, running: boolean): string {
  if (byMessage) return HELD_WORDS.DENIED;
  return running ? HELD_WORDS.ELSEWHERE : HELD_WORDS.EXPIRED;
}

/**
 * The asks held with the agent's row laid over them: each waiting one taken
 * in, and each that stopped waiting with no answer of this window's settled.
 * Note that one settled only by leaving the waiting asks opens again as it
 * comes back to them, its last failure kept, because a write that left it
 * may still let it go, and an answer that did not reach the agent is the
 * reader's to send again.
 */
export function heldWith<Answering, Failure>(
  held: ReadonlyMap<string, HeldAsk<Answering, Failure>>,
  pending: readonly AgentPendingApproval[],
  running: boolean,
): ReadonlyMap<string, HeldAsk<Answering, Failure>> {
  const waiting = new Set(pending.map((each) => each.id));
  const next = new Map(held);
  for (const approval of pending) {
    const was = next.get(approval.id);
    if (was === undefined) next.set(approval.id, { approval });
    else if (was.vanished === true) next.set(approval.id, { approval, error: was.error });
  }
  for (const [id, ask] of next) {
    if (waiting.has(id) || ask.settled !== undefined || ask.answering !== undefined) continue;
    next.set(id, { ...ask, settled: vanishedLine(ask.messaged === true, running), vanished: true });
  }
  return next;
}

/** Whether two holdings hold the same asks as they stand. */
export function sameHeld<Ask>(a: ReadonlyMap<string, Ask>, b: ReadonlyMap<string, Ask>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ask] of a) if (b.get(id) !== ask) return false;
  return true;
}

/** An ask marked as a message's to deny, or the mark taken back, its line said again where it was settled by leaving the waiting asks. */
export function markedAsk<Answering, Failure>(
  ask: HeldAsk<Answering, Failure>,
  messaged: boolean,
  running: boolean,
): HeldAsk<Answering, Failure> {
  if (messaged) return ask.settled === undefined ? { ...ask, messaged: true } : ask;
  if (ask.messaged !== true) return ask;
  return ask.vanished === true
    ? { ...ask, messaged: false, settled: vanishedLine(false, running) }
    : { ...ask, messaged: false };
}

/** Why an answer did not go, by the failure it came back with, and whether the service refused it, which a press again will not mend. */
export function answerFailedOf(failure: string): {
  readonly words: string;
  readonly refused: boolean;
} {
  if (failure === AGENT_CALL_FAILURE.NOT_PERMITTED) {
    return { words: ANSWER_FAILED.NOT_PERMITTED, refused: true };
  }
  if (failure === AGENT_CALL_FAILURE.NOT_FOUND) {
    return { words: ANSWER_FAILED.NOT_FOUND, refused: true };
  }
  return { words: ANSWER_FAILED.UNANSWERED, refused: false };
}

/** What a held call's body says of who asks and why: the subagent where one does, and the CLI's own words where they are not the call's own description. */
export function heldAbout(approval: AgentPendingApproval): string | undefined {
  const asker = approval.subagentId === undefined ? undefined : SUBAGENT_ASKS;
  const why =
    approval.description === approval.input.description ? undefined : approval.description;
  const words = [asker, why].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join(" ");
}

/** What the working line says while asks wait: that the agent waits on the reader, and on how many. */
export function waitingOnYouWords(waiting: number): string {
  return `Waiting on you · ${waiting} ${waiting === 1 ? "approval" : "approvals"}`;
}
