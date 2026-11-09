import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import {
  REWIND_REFUSAL,
  rewindConversation,
  rewindUnheard,
  UNHEARD_REFUSAL,
} from "@repo/database/models/conversation-rewind";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { harnessOf } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";

/**
 * rewind.ts -- a coding agent taken back to just before one of the developer's lines, as though that line and everything after it were never said.
 *
 * Where nothing the cut drops was heard, every line of it still queued for
 * the runner and never handed to one, as a Start's first line is while its
 * sandbox opens, the cut withdraws those lines and stops nothing
 * (`conversation-rewind.ts`'s `rewindUnheard`): a launch under way goes on,
 * and its runner reads whatever is sent in their place. Otherwise whatever
 * the agent is doing stops first, so nothing it still writes lands after
 * the cut: a native agent's runner is ended, keeping its sandbox and the
 * harness's own session, which the next message's launch cuts before the
 * same line and resumes (`conversation-rewind.ts`'s `nativeRewind`); one on
 * no harness ended for good, so nothing of it runs. Then the conversation is
 * cut in one transaction, and whatever a message sent meanwhile started is
 * stopped again. A cut that would be refused is refused by the first try,
 * so it stops nothing. The agent's checkout is left as it stands: only the
 * conversation goes back.
 */

/** Why a cut the store refused is refused to its caller. */
const REFUSAL_OF_REWIND = {
  [REWIND_REFUSAL.NOT_FOUND]: HOSTED_REFUSAL.NOT_FOUND,
  [REWIND_REFUSAL.INSIDE_TURN]: HOSTED_REFUSAL.INVALID_REQUEST,
  [REWIND_REFUSAL.BUSY]: HOSTED_REFUSAL.UNAVAILABLE,
} as const;

/** What the agent is doing stopped, as above; refused as unavailable where it could not be. */
const stoppedForRewind = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Agent,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return;
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(agent.userId, agent.id));
  // Note that an agent on no harness ended for good, so nothing of it runs to stop.
  const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);
  if (runtime === undefined) return;
  if (!(yield* runnerHalted(agent, runtime, sessionId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
});

/**
 * The agent taken back to just before the developer's line named, as
 * above. Refused where the caller may not write to the agent, where no
 * such line stands, or where the line sits inside a turn's work.
 */
export const rewoundAgent = /* @__PURE__ */ Effect.fn("web/rewoundAgent")(function* (
  account: string,
  agent: Agent,
  messageId: string,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices> {
  // An agent on its starter's own GitHub token takes words from its starter alone, and so is rewound by them alone.
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // A cut of what no runner heard stops nothing, nor does one that would be refused.
  const unheard = yield* hostedStoreOrUnavailable(rewindUnheard(target, messageId));
  if (Result.isSuccess(unheard)) return;
  if (unheard.failure !== UNHEARD_REFUSAL.HEARD) {
    return yield* Effect.fail(REFUSAL_OF_REWIND[unheard.failure]);
  }
  yield* stoppedForRewind(agent);
  const cut = yield* hostedStoreOrUnavailable(rewindConversation(target, messageId));
  if (Result.isFailure(cut)) return yield* Effect.fail(REFUSAL_OF_REWIND[cut.failure]);
  // Note that a message sent between the stop and the cut may have started the agent again on
  // what the cut dropped, so whatever runs now is stopped too, and the next message starts clean.
  yield* stoppedForRewind(agent).pipe(
    Effect.catch((refusal) =>
      Effect.logWarning(`a rewound agent was not stopped again: ${refusal.error}`),
    ),
  );
});
