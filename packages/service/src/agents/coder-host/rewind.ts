import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import { cancelAgentWakeup } from "@repo/database/models/agent-wakeups";
import {
  REWIND_REFUSAL,
  readRewindable,
  readRewindSnapshot,
  rewindConversation,
} from "@repo/database/models/conversation-rewind";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { TurnCheckoutSnapshot } from "@repo/database/models/turn-state";
import type { ConversationTarget } from "@repo/database/models/writer";
import { LOCAL_AGENT_REFUSAL } from "@repo/features/agent-wire";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HOST_REMOVED_REFUSAL,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  localAgentRefused,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { LaunchRefused, RESTORE_OUTCOME } from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { harnessOf } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";

/**
 * rewind.ts -- a coding agent taken back to just before one of the developer's lines, as though that line and everything after it were never said.
 *
 * Whatever the agent is doing stops first, so nothing it still writes lands
 * after the cut: a native agent's runner is ended, keeping its sandbox and
 * the harness's own session, which the next message's launch cuts before
 * the same line and resumes (`conversation-rewind.ts`'s `nativeRewind`);
 * one on no harness ended for good, so nothing of it runs. Then the
 * conversation is cut in one transaction, and whatever a message sent
 * meanwhile started is stopped again. A cut that would be refused is read
 * first, so it stops nothing. The agent's checkout is left as it stands
 * unless the rewind asks for the files back too: then, once the runner is
 * ended and before the cut, the checkout is put back to the snapshot its
 * runner took before the turn the line opened, by the machine the agent
 * runs on (`../machine/agent-machine.ts`'s `restoreCheckout`: a sandbox's
 * woken and run in, a Mac's host handed a restore line), read first so a
 * point with no snapshot is refused before anything stops, and a restore
 * that fails refuses the whole rewind, so the conversation is never cut
 * with the files half done.
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
  // A wakeup the agent booked belongs to the work the rewind drops.
  yield* hostedStoreOrUnavailable(cancelAgentWakeup(agent.id));
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

/** The snapshot a rewind that restores the files puts the checkout back to: refused where none stands for the line. */
const restorePointOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  messageId: string,
): Effect.fn.Return<TurnCheckoutSnapshot, HostedRefusal, DatabaseServices> {
  const snapshot = yield* hostedStoreOrUnavailable(readRewindSnapshot(target, messageId));
  if (Option.isNone(snapshot)) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  return snapshot.value;
});

/** How a restore the machine refused is refused to the rewind's caller: a Mac away or removed by name, anything else as unavailable. */
function refusedRestore(failure: unknown): HostedRefusal {
  if (failure instanceof LaunchRefused && failure.deviceRemoved === true)
    return HOST_REMOVED_REFUSAL;
  if (failure instanceof LaunchRefused && failure.deviceAway === true) {
    return localAgentRefused(LOCAL_AGENT_REFUSAL.MAC_AWAY);
  }
  return HOSTED_REFUSAL.UNAVAILABLE;
}

/** The checkout put back to the snapshot on the agent's machine: refused where the snapshot is no longer there, or the machine restores none, and unavailable where the restore failed. */
const restoredForRewind = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  snapshot: TurnCheckoutSnapshot,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient | Sandbox> {
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  const machines = yield* deploymentLifecycle;
  const outcome = yield* machines
    .restoreCheckout(sessionId, snapshot)
    .pipe(Effect.mapError(refusedRestore));
  if (outcome === RESTORE_OUTCOME.MISSING) {
    return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  }
  // A Mac whose host predates the line records no snapshot either, so the window offers it none; the request alone reaches here.
  if (outcome === RESTORE_OUTCOME.UNSUPPORTED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  if (outcome === RESTORE_OUTCOME.FAILED) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
});

/**
 * The agent taken back to just before the developer's line named, as
 * above, its files put back too where `restoreFiles` asks. Refused where
 * the caller may not write to the agent, where no such line stands, where
 * the line sits inside a turn's work, or where the files are asked back
 * and no snapshot of them stands.
 */
export const rewoundAgent = /* @__PURE__ */ Effect.fn("web/rewoundAgent")(function* (
  account: string,
  agent: Agent,
  messageId: string,
  restoreFiles = false,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | HttpClient.HttpClient | Sandbox> {
  // An agent on its starter's own GitHub token takes words from its starter alone, and so is rewound by them alone.
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const target = { userId: agent.userId, conversationId: agent.conversationId };
  // A cut that would be refused stops nothing.
  const rewindable = yield* hostedStoreOrUnavailable(readRewindable(target, messageId));
  if (Result.isFailure(rewindable)) {
    return yield* Effect.fail(REFUSAL_OF_REWIND[rewindable.failure]);
  }
  const snapshot = restoreFiles ? yield* restorePointOf(target, messageId) : undefined;
  yield* stoppedForRewind(agent);
  // The files go back before the cut, so a restore that fails leaves the conversation whole.
  if (snapshot !== undefined) yield* restoredForRewind(target, snapshot);
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
