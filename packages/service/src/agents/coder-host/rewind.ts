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
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { Sandbox } from "@repo/sandbox";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { RESTORE_OUTCOME, restoreCheckout } from "./checkout-restore.js";
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
 * runner took before the turn the line opened (`checkout-restore.ts`),
 * read first so a point with no snapshot is refused before anything stops,
 * and a restore that fails refuses the whole rewind, so the conversation is
 * never cut with the files half done. A Mac agent's files are not put back
 * yet: its host runs no restore, so the window offers it none.
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

/** The snapshot a rewind that restores the files puts the checkout back to: refused where none stands for the line, or the agent runs on a Mac. */
const restorePointOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Agent,
  target: ConversationTarget,
  messageId: string,
): Effect.fn.Return<TurnCheckoutSnapshot, HostedRefusal, DatabaseServices> {
  if (agent.machine === AGENT_MACHINE.DEVICE)
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const snapshot = yield* hostedStoreOrUnavailable(readRewindSnapshot(target, messageId));
  if (Option.isNone(snapshot)) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  return snapshot.value;
});

/** The checkout put back to the snapshot, in the agent's sandbox: refused where the snapshot is no longer there, or unavailable where the restore failed. */
const restoredForRewind = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Agent,
  target: ConversationTarget,
  snapshot: TurnCheckoutSnapshot,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | Sandbox> {
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));
  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  const outcome = yield* restoreCheckout({ userId: agent.userId, sessionId, snapshot });
  if (outcome === RESTORE_OUTCOME.MISSING) {
    return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
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
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | Sandbox> {
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
  const snapshot = restoreFiles ? yield* restorePointOf(agent, target, messageId) : undefined;
  yield* stoppedForRewind(agent);
  // The files go back before the cut, so a restore that fails leaves the conversation whole.
  if (snapshot !== undefined) yield* restoredForRewind(agent, target, snapshot);
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
