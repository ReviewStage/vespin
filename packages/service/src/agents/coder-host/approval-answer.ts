/**
 * approval-answer.ts -- a member's answer to an ask an agent's runner holds: written to the runner the way a message steers it, then the ask settled.
 *
 * Only a member who controls the agent answers (`controlsAgent`), as only
 * they steer it, and for an agent its starter's plan pays for, one the plan
 * policy admits as a writer (`admitsPlanWriter`). The answer first claims the
 * ask, a compare-and-set on its standing pending that records the member as
 * who decided, so of two members answering at once one claims it and the
 * other is refused with how it stands (`approval-settled`), and nothing of
 * theirs reaches the runner. The claim is then written to the runner as an
 * `approval` line naming the CLI's id for the ask, the way the agent's
 * messages go: the store's line in the cloud, the device's MESSAGE line on a
 * host (`runtime-sessions.ts`'s `runnerApprovalAnswered`), and the runner's
 * own word of what it took (`APPROVAL_RESOLVED`) lands on the row
 * (`runner-approvals.ts`). The delivery and what follows from its outcome
 * run to their end whatever happens to the request, so a claim is never
 * handed back for a line that may have landed. Where the line could not be
 * written, the claim is handed back: pending again where the runner could not be reached just
 * now, the answer refused as unavailable, to be sent again; and expired
 * where no runner of the agent runs, since none holds the ask.
 */

import { INPUT_LINE } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  answerApproval,
  readApproval,
  releaseApprovalClaim,
} from "@repo/database/models/agent-approvals";
import type { Agent } from "@repo/database/models/agent-store";
import {
  APPROVAL_STATUS,
  APPROVAL_STATUS_OF_ANSWER,
  type ApprovalAnswerAnswer,
  type ApprovalAnswerRequest,
} from "@repo/features/agent-approval-wire";
import { failureKind } from "@repo/runtime/effect";
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
  const at = new Date(yield* Clock.currentTimeMillis);

  // The answer claims the ask first, so of two members answering at once the runner hears only the one the row records.
  const claimed = yield* hostedStoreOrUnavailable(
    answerApproval({
      userId,
      agentId: agent.id,
      approvalId,
      status: APPROVAL_STATUS_OF_ANSWER[request.answer],
      at,
    }),
  );

  if (Option.isNone(claimed)) return yield* refusedAsItStands(userId, agent.id, approvalId);

  const line: ApprovalLine = {
    type: INPUT_LINE.APPROVAL,
    requestId: claimed.value.requestId,
    decision: DECISION_OF_ANSWER[request.answer],
    ...(request.message === undefined ? undefined : { message: request.message }),
  };

  // A claim whose line never reached a runner goes back, uninterruptibly; a release that fails is said, and
  // the answer's own outcome kept.
  const released = (to: typeof APPROVAL_STATUS.PENDING | typeof APPROVAL_STATUS.EXPIRED) =>
    releaseApprovalClaim({ agentId: agent.id, approvalId, userId, to, at }).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(`an answer's claim of an ask was not released: ${failureKind(failure)}`),
      ),
      Effect.asVoid,
      Effect.annotateLogs({ agentId: agent.id }),
      Effect.uninterruptible,
    );

  // Note that the delivery runs to its end whatever happens to the request, because a line cut off as it
  // lands leaves no word of whether the runner has it: its outcome alone says, and the claim follows it.
  const reached = yield* Effect.uninterruptible(
    Effect.andThen(runnerApprovalAnswered(agent, line), (answer) =>
      answer === RUNNER_ANSWER.WRITTEN
        ? Effect.succeed(answer)
        : Effect.as(
            released(
              answer === RUNNER_ANSWER.NOT_LIVE ? APPROVAL_STATUS.EXPIRED : APPROVAL_STATUS.PENDING,
            ),
            answer,
          ),
    ),
  );

  if (reached === RUNNER_ANSWER.WRITTEN) {
    return { approval: { id: claimed.value.id, status: claimed.value.status } };
  }

  // The line never reached a runner, and the claim went back: pending for another answer where the runner
  // could not be reached just now, and expired where none runs, so no runner holds the ask.
  if (reached === RUNNER_ANSWER.FAILED) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);

  return yield* refusedAsItStands(userId, agent.id, approvalId);
});
