/**
 * turn-changes.ts -- the files one of a coding agent's turns changed, as git tells them apart on the agent's own machine, for the files row under the turn's words.
 *
 * The runner records the checkout before each turn (`@repo/agent-runner`'s
 * `checkout-snapshot.ts`), so the files a turn changed are the diff from its
 * snapshot to the next turn's, or to the checkout as it stands for the last
 * turn recorded (`@repo/database`'s `readTurnCheckoutRange`). The diff is
 * run where the checkout is, by the one script both machines run
 * (`@repo/features/checkout-diff`), through the agent's machine
 * (`../machine/agent-machines.ts`), and read into the files the Changes view
 * draws. Nothing is stored: the files are read afresh on each ask. The read
 * stands behind the workspace's experiment, as the row that asks it does,
 * and is refused where no snapshot of the turn stands any more, as after
 * the sandbox that held it was released, where the agent runs on a Mac that
 * is away or removed, and where the Mac's host takes no such ask.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { readTurnCheckoutRange } from "@repo/database/models/conversation-rewind";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { AgentTurnChangesAnswer } from "@repo/features/agent-wire";
import { checkoutDiffFiles } from "@repo/features/checkout-diff";
import type { Sandbox } from "@repo/sandbox";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { CHECKOUT_DIFF_OUTCOME } from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { experimentOnIn } from "../workspace-experiment-on.js";
import { refusedByMachine } from "./rewind.js";

/**
 * The files the turn the developer's line named opened changed, as above.
 * Refused as malformed while the agent's workspace has the experiment off,
 * since no window asks it then; refused by name where no snapshot of the
 * turn stands, on the row or on the machine; refused as a line to an away
 * or removed Mac is; and unavailable where the machine diffs none, or the
 * diff failed.
 */
export const turnChangesOf = /* @__PURE__ */ Effect.fn("web/turnChangesOf")(function* (
  agent: Agent,
  messageId: string,
): Effect.fn.Return<
  AgentTurnChangesAnswer,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | Sandbox
> {
  if (!(yield* experimentOnIn(agent.organizationId, EXPERIMENT.REWIND_FILES))) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const range = yield* hostedStoreOrUnavailable(readTurnCheckoutRange(target, messageId));

  if (Option.isNone(range)) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));

  if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  const machines = yield* deploymentLifecycle;

  const diffed = yield* machines
    .diffCheckout(sessionId, range.value)
    .pipe(Effect.mapError(refusedByMachine));

  if (diffed.outcome === CHECKOUT_DIFF_OUTCOME.MISSING) {
    return yield* Effect.fail(HOSTED_REFUSAL.CHECKOUT_SNAPSHOT_MISSING);
  }

  if (diffed.outcome !== CHECKOUT_DIFF_OUTCOME.DIFFED) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }

  return checkoutDiffFiles(diffed.diff);
});
