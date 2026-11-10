/**
 * runner-approvals.ts -- a runner's asks and its word of how each was settled, as the events route lands them beside the agent's transcript.
 *
 * A launch whose mode asks (`PERMISSION_MODE`) posts APPROVAL_REQUESTED as
 * it holds a tool call for a member's answer, and APPROVAL_RESOLVED once the
 * ask is settled, whatever settled it, before its END. Each lands in the
 * batch's own transaction, under the conversation's lock, in order with
 * the turn's own writes (`NATIVE_WRITE.APPROVAL`), so an ask lands after the
 * write that opens its turn and before any that ends it, and an event
 * posted again lands nothing twice: an ask under the turn that runs as it
 * is applied, and a settle on the ask its CLI id names
 * (`@repo/database/models/agent-approvals`). An ask posted with no turn
 * running has no turn to expire with, so it is not kept, and its runner,
 * which still holds the call, settles it at the launch's end.
 *
 * The call's input is the agent's transcript content, a command or a
 * file's contents among it: it is cut again to the service's bound and
 * kept beside the transcript, and nothing of it, its title, or its
 * description is said in a log. Every string kept is made well formed,
 * since a cut a runner made inside a surrogate pair leaves half a
 * character, which Postgres refuses in a JSON value and would fail the
 * whole batch on.
 */

import {
  APPROVAL_BY,
  APPROVAL_DECISION,
  APPROVAL_INPUT,
  type ApprovalBy,
  type ApprovalDecision,
  RUNNER_EVENT,
  RunnerApprovalRequestedSchema,
  RunnerApprovalResolvedSchema,
} from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { recordApprovalAsked, settleApprovalByRunner } from "@repo/database/models/agent-approvals";
import {
  type AgentPendingApproval,
  APPROVAL_ANSWER,
  APPROVAL_BOUNDS,
  APPROVAL_SETTLED_BY,
  APPROVAL_STATUS,
  APPROVAL_STATUS_OF_ANSWER,
  type ApprovalAnswer,
  type ApprovalSettledBy,
  type ApprovalStatus,
  agentPendingApprovalSchema,
} from "@repo/features/agent-approval-wire";
import type { WireValue } from "@repo/wire";
import { Effect, Option, Schema } from "effect";

/** The runner's decisions as a member's answers name them, one for one. */
const ANSWER_OF_DECISION = {
  [APPROVAL_DECISION.ALLOW]: APPROVAL_ANSWER.ALLOW,
  [APPROVAL_DECISION.ALLOW_FOR_AGENT]: APPROVAL_ANSWER.ALLOW_FOR_AGENT,
  [APPROVAL_DECISION.DENY]: APPROVAL_ANSWER.DENY,
} as const satisfies Record<ApprovalDecision, ApprovalAnswer>;

/** The member's answers as the runner's `approval` line names them, one for one. */
export const DECISION_OF_ANSWER = {
  [APPROVAL_ANSWER.ALLOW]: APPROVAL_DECISION.ALLOW,
  [APPROVAL_ANSWER.ALLOW_FOR_AGENT]: APPROVAL_DECISION.ALLOW_FOR_AGENT,
  [APPROVAL_ANSWER.DENY]: APPROVAL_DECISION.DENY,
} as const satisfies Record<ApprovalAnswer, ApprovalDecision>;

/** What the runner said settled an ask, as the service records it. */
const SETTLED_BY_OF_RUNNER = {
  [APPROVAL_BY.MEMBER]: APPROVAL_SETTLED_BY.MEMBER,
  [APPROVAL_BY.MESSAGE]: APPROVAL_SETTLED_BY.MESSAGE,
  [APPROVAL_BY.ABORTED]: APPROVAL_SETTLED_BY.STOP,
  [APPROVAL_BY.ENDED]: APPROVAL_SETTLED_BY.ENDED,
} as const satisfies Record<ApprovalBy, ApprovalSettledBy>;

/** The settlings no one decided, which leave the ask expired whatever the runner answered the CLI. */
const UNDECIDED: ReadonlySet<ApprovalBy> = new Set([APPROVAL_BY.ABORTED, APPROVAL_BY.ENDED]);

/** How deep a call's input is kept; a value deeper is kept as null. */
const MAX_INPUT_DEPTH = 6;

const readAsked = Schema.decodeUnknownOption(RunnerApprovalRequestedSchema);

const readResolved = Schema.decodeUnknownOption(RunnerApprovalResolvedSchema);

const readInput = Schema.decodeUnknownOption(agentPendingApprovalSchema.fields.input);

/** A surrogate standing alone, half of a character, which no store keeps; read by code point, a whole pair is no match. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

/** The approval events of the runner's own, which the events route lands apart from the run's moments. */
const APPROVAL_EVENTS: ReadonlySet<unknown> = new Set([
  RUNNER_EVENT.APPROVAL_REQUESTED,
  RUNNER_EVENT.APPROVAL_RESOLVED,
]);

/** Words cut to the bound, an ellipsis ending one cut, as the runner cuts them, and well formed: half a character, the runner's cut's or ours, is replaced. */
function cutText(text: string, max: number): string {
  const cut = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return cut.replace(LONE_SURROGATE, "\uFFFD");
}

/** A value of a call's input cut as the runner cuts it, and no deeper than the bound. */
function cutValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return cutText(value, APPROVAL_INPUT.TEXT_MAX);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_INPUT_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.slice(0, APPROVAL_INPUT.ITEMS_MAX).map((each) => cutValue(each, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key.replace(LONE_SURROGATE, "\uFFFD"),
      cutValue(each, depth + 1),
    ]),
  );
}

/**
 * A call's input as the service keeps it: cut as the runner cuts it, whatever
 * a runner sent, and empty where it is still past the bound, since the call
 * stands whole in the transcript.
 */
export function keptApprovalInput(
  input: Readonly<Record<string, unknown>>,
): AgentPendingApproval["input"] {
  const cut = readInput(cutValue(input, 0));
  if (Option.isNone(cut)) return {};
  return new TextEncoder().encode(JSON.stringify(cut.value)).length >
    APPROVAL_BOUNDS.MAX_INPUT_BYTES
    ? {}
    : cut.value;
}

/** Where an ask stands as its runner said it was settled: the decision of a member's answer or message, and expired where no one decided. */
function statusOfResolved(by: ApprovalBy, decision: ApprovalDecision): ApprovalStatus {
  return UNDECIDED.has(by)
    ? APPROVAL_STATUS.EXPIRED
    : APPROVAL_STATUS_OF_ANSWER[ANSWER_OF_DECISION[decision]];
}

/** Whether the message is one of the runner's approval events, an ask or its settle. */
export function isApprovalEvent(message: WireValue): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    !Array.isArray(message) &&
    "type" in message &&
    APPROVAL_EVENTS.has(message.type)
  );
}

/**
 * Lands one of the runner's approval events, where the message is one: an
 * ask under the running turn, or how one was settled. Anything else lands
 * nothing, as does an ask with no turn running.
 */
export function landApprovalEvent(
  conversationId: string,
  runningTurnId: string | undefined,
  message: WireValue,
  now: number,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const at = new Date(now);
    const asked = readAsked(message);
    if (Option.isSome(asked)) {
      if (runningTurnId === undefined) {
        yield* Effect.logWarning("runner-events: an ask came with no turn running").pipe(
          Effect.annotateLogs({ conversationId }),
        );
        return;
      }
      const ask = asked.value;
      yield* recordApprovalAsked({
        conversationId,
        turnId: runningTurnId,
        requestId: ask.requestId,
        toolUseId: ask.toolUseId,
        subagentId: ask.agentId ?? null,
        toolName: cutText(ask.toolName, APPROVAL_BOUNDS.MAX_TEXT_CHARS),
        title: cutText(ask.title, APPROVAL_BOUNDS.MAX_TEXT_CHARS),
        description:
          ask.description === undefined
            ? null
            : cutText(ask.description, APPROVAL_BOUNDS.MAX_TEXT_CHARS),
        input: keptApprovalInput(ask.input),
        at,
      });
      return;
    }
    const resolved = readResolved(message);
    if (Option.isNone(resolved)) return;
    const { requestId, decision, by } = resolved.value;
    yield* settleApprovalByRunner({
      conversationId,
      requestId,
      status: statusOfResolved(by, decision),
      settledBy: SETTLED_BY_OF_RUNNER[by],
      at,
    });
  });
}
