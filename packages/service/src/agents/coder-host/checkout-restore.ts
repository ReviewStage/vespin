/**
 * checkout-restore.ts -- a coding agent's sandbox checkout put back to the snapshot its runner took before a turn, for a rewind that restores the files.
 *
 * The runner records the checkout before each turn under a ref of the
 * checkout's own (`@repo/agent-runner`'s `checkout-snapshot.ts`), and the
 * turn's row keeps the commit, `HEAD` then, and the branch then. As a rewind
 * that restores the files is made (`rewind.ts`), once the agent's runner is
 * ended, the service reaches the agent's sandbox by its session's name
 * (`../agent-sandbox-open.ts`), wakes it where it stopped, as the Terminal
 * tab's resume does, and runs the one restore script both machines run
 * (`@repo/features/checkout-restore`) in the checkout, with the snapshot
 * in its variables: the working tree and the checked-out branch go back,
 * and no commit is moved. Nothing leaves the sandbox: no push, no
 * credential, so none is set at its firewall. The restore is a use of the
 * sandbox, touched and recorded as one (`../sandbox-use.ts`), so the
 * unused-sandbox release counts it; a sandbox this step woke stops
 * `SANDBOX_IDLE` after its last touch (`@repo/sandbox`), as every idle
 * sandbox does. The whole step is bounded. What it came to is an outcome the
 * rewind names to its caller: restored, the snapshot missing, as where the
 * sandbox that held it is released or its stopped copy is gone, or a
 * failure, whose stderr's tail is logged with credential-shaped runs
 * redacted. The panel offers no restore for a turn whose sandbox the ledger
 * records gone (`@repo/database`'s `models/agent-sandboxes.ts` forgets the
 * turn's snapshot as it is), so a miss here is the rare race with it.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { TurnCheckoutSnapshot } from "@repo/database/models/turn-state";
import {
  CHECKOUT_RESTORE_EXIT,
  CHECKOUT_RESTORE_SCRIPT,
  checkoutRestoreEnv,
} from "@repo/features/checkout-restore";
import { redactCredentials } from "@repo/features/credential-redaction";
import {
  type ListedSandbox,
  resumedRunning,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxRunning,
  UP_STATUSES,
} from "@repo/sandbox";
import { Duration, Effect, Option } from "effect";
import { agentSandboxName, agentSandboxOf } from "../agent-sandbox-open.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { touchAgentSandbox } from "../sandbox-use.js";

export const CHECKOUT_RESTORE = {
  /** The most a rewind waits on the restore, the sandbox woken included. */
  TIMEOUT: Duration.seconds(60),
  /** How many characters of a failed restore's stderr are logged, from its end. */
  STDERR_TAIL: 600,
} as const;

/** What a restore came to: the checkout put back, the snapshot not in the checkout any more, or a failure. */
export const RESTORE_OUTCOME = {
  RESTORED: "restored",
  MISSING: "missing",
  FAILED: "failed",
} as const;

export type RestoreOutcome = (typeof RESTORE_OUTCOME)[keyof typeof RESTORE_OUTCOME];

/** What a restore is asked: whose sandbox, by its session, and the snapshot to put the checkout back to. */
export interface RestoreAsk {
  /** The account whose agent it is, under which its sandbox is kept. */
  readonly userId: string;
  /** The session the agent's sandbox is tagged with. */
  readonly sessionId: string;
  readonly snapshot: TurnCheckoutSnapshot;
}

/** The run a running sandbox is up in; none for one not running. */
function runningOf(sandbox: ListedSandbox): SandboxRunning | undefined {
  return sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.running !== undefined
    ? { name: sandbox.name, running: sandbox.running }
    : undefined;
}

/** The end of a failed restore's stderr as a log line takes it: credential-shaped runs redacted, its lines joined, then its last `STDERR_TAIL` characters. */
function stderrTail(stderr: string): string {
  return redactCredentials(stderr)
    .trim()
    .replace(/\s*\n\s*/gu, " / ")
    .slice(-CHECKOUT_RESTORE.STDERR_TAIL);
}

/** The restore in the agent's sandbox, woken where it stopped. */
const restoreIn = (ask: RestoreAsk) =>
  Effect.gen(function* () {
    const sandboxes = yield* Sandbox;
    const sandbox = yield* agentSandboxOf(sandboxes, ask.sessionId);
    if (sandbox === undefined) return RESTORE_OUTCOME.MISSING;
    // MIGRATION: a legacy sandbox (`agentSandboxOf`) is never woken in place; one not up holds no snapshot a restore reaches.
    if (!UP_STATUSES.has(sandbox.status) && sandbox.name !== agentSandboxName(ask.sessionId)) {
      return RESTORE_OUTCOME.MISSING;
    }
    // A stopped sandbox whose snapshot the provider dropped holds no checkout to put back.
    const running =
      runningOf(sandbox) ??
      (yield* resumedRunning(sandbox.name).pipe(
        Effect.catchTag("SnapshotGone", () => Effect.succeed(undefined)),
      ));
    if (running === undefined) return RESTORE_OUTCOME.MISSING;
    yield* touchAgentSandbox(sandbox.name);
    const ran = yield* sandboxes.run(running, {
      command: "sh",
      args: ["-c", CHECKOUT_RESTORE_SCRIPT],
      cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
      env: checkoutRestoreEnv(ask.snapshot),
    });
    if (ran.exitCode === 0) return RESTORE_OUTCOME.RESTORED;
    if (ran.exitCode === CHECKOUT_RESTORE_EXIT.MISSING) return RESTORE_OUTCOME.MISSING;
    yield* Effect.logWarning(
      `the checkout was not restored: the restore exited ${ran.exitCode}: ${stderrTail(ran.stderr)}`,
    );
    return RESTORE_OUTCOME.FAILED;
  });

/**
 * The agent's checkout put back to the snapshot, as above, within the
 * bound; a call that failed or the bound passed is a failure, logged, and
 * never the caller's own.
 */
export const restoreCheckout = /* @__PURE__ */ Effect.fn("web/restoreCheckout")(function* (
  ask: RestoreAsk,
): Effect.fn.Return<RestoreOutcome, never, Sandbox | DatabaseServices> {
  const outcome = yield* restoreIn(ask).pipe(
    Effect.timeoutOption(CHECKOUT_RESTORE.TIMEOUT),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the checkout was not restored: ${String(failure)}`),
        Option.some<RestoreOutcome>(RESTORE_OUTCOME.FAILED),
      ),
    ),
  );
  if (Option.isSome(outcome)) return outcome.value;
  yield* Effect.logWarning("the checkout was not restored in time");
  return RESTORE_OUTCOME.FAILED;
});
