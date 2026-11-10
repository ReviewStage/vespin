/**
 * approval-answer.ts -- a member's answer to an ask an agent's runner holds: written to the runner the way a message steers it, then the ask settled.
 *
 * Only a member who controls the agent answers (`controlsAgent`), as only
 * they steer it, and for an agent its starter's plan pays for, one the plan
 * policy admits as a writer (`admitsPlanWriter`). An ask that no longer
 * waits is refused with how it stands (`approval-settled`), and nothing
 * reaches the runner. One still pending is written to the runner first, as
 * an `approval` line naming the CLI's id for it, the way the agent's
 * messages go: the store's line in the cloud, the device's MESSAGE line on
 * a host (`runtime-sessions.ts`'s `runnerApprovalAnswered`). Then the ask is
 * settled, a compare-and-set on its standing pending, so of two answers
 * racing one settles it and the other is refused; the runner takes the
 * first line to reach it and skips the other, and its own word of what it
 * took (`APPROVAL_RESOLVED`) stands over the row (`runner-approvals.ts`).
 * Note that the line goes first, because an ask settled with no line
 * written would leave the runner holding a call no one can answer again.
 * Where no runner of the agent runs, none holds the ask, which is expired
 * and refused; where the runner could not be reached just now, the ask
 * still waits, and the answer is refused as unavailable, to be sent again.
 */

import { INPUT_LINE } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  answerApproval,
  expireApproval,
  readApproval,
} from "@repo/database/models/agent-approvals";
import type { Agent } from "@repo/database/models/agent-store";
import {
  APPROVAL_STATUS,
  APPROVAL_STATUS_OF_ANSWER,
  type ApprovalAnswerAnswer,
  type ApprovalAnswerRequest,
} from "@repo/features/agent-approval-wire";
import { Clock, Effect, Option } from "effect";
import {
  approvalSettled,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { DECISION_OF_ANSWER } from "../native-events/runner-approvals.js";
import { type ApprovalLine, RUNNER_ANSWER, runnerApprovalAnswered } from "./runtime-sessions.js";

/** How an ask the member could not settle stands now, as the refusal names it; not found where it went with its agent. */
const refusedAsItStands = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  approvalId: string,
): Effect.fn.Return<never, HostedRefusal, DatabaseServices> {
  const now = yield* hostedStoreOrUnavailable(readApproval(userId, agentId, approvalId));
  if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return yield* Effect.fail(approvalSettled(now.value.status));
});

/** The ask the path names answered as the member asks, written to the agent's runner and settled; refused by why otherwise. */
export const answeredApproval = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
  id: string,
  request: ApprovalAnswerRequest,
): Effect.fn.Return<ApprovalAnswerAnswer, HostedRefusal, DatabaseServices> {
  const approvalId = yield* pathUuid(id);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(userId, agent);
  const standing = yield* hostedStoreOrUnavailable(readApproval(userId, agent.id, approvalId));
  if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (standing.value.status !== APPROVAL_STATUS.PENDING) {
    return yield* Effect.fail(approvalSettled(standing.value.status));
  }
  const line: ApprovalLine = {
    type: INPUT_LINE.APPROVAL,
    requestId: standing.value.requestId,
    decision: DECISION_OF_ANSWER[request.answer],
    ...(request.message === undefined ? undefined : { message: request.message }),
  };
  const reached = yield* runnerApprovalAnswered(agent, line);
  if (reached === RUNNER_ANSWER.FAILED) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const at = new Date(yield* Clock.currentTimeMillis);
  if (reached === RUNNER_ANSWER.NOT_LIVE) {
    // No runner holds the ask, so no answer can reach it: it expires now rather than at its turn's reap.
    yield* hostedStoreOrUnavailable(expireApproval(agent.id, approvalId, at));
    return yield* refusedAsItStands(userId, agent.id, approvalId);
  }
  const settled = yield* hostedStoreOrUnavailable(
    answerApproval({
      userId,
      agentId: agent.id,
      approvalId,
      status: APPROVAL_STATUS_OF_ANSWER[request.answer],
      at,
    }),
  );
  if (Option.isNone(settled)) return yield* refusedAsItStands(userId, agent.id, approvalId);
  return { approval: { id: settled.value.id, status: settled.value.status } };
});
