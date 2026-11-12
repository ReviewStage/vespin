/**
 * checkout-restore.ts -- a coding agent's sandbox checkout put back to the snapshot its runner took before a turn, for a rewind that restores the files.
 *
 * The runner records the checkout before each turn under a ref of the
 * checkout's own (`@repo/agent-runner`'s `checkout-snapshot.ts`), and the
 * turn's row keeps the commit, `HEAD` then, and the branch then. As a rewind
 * that restores the files is made (`rewind.ts`), once the agent's runner is
 * ended, the service reaches the agent's sandbox by its session's name
 * (`../agent-sandbox-open.ts`), wakes it where it stopped, as the Terminal
 * tab's resume does (`AgentSandbox`'s `resume`), so one with its own drive
 * is made again from the image on that drive, since a stop kept nothing
 * else of it, while one from before drives resumes from its snapshot; and
 * runs the one restore script both machines run
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
  CHECKOUT_DIFF_EXIT,
  CHECKOUT_DIFF_SCRIPT,
  type CheckoutDiffRange,
  checkoutDiffEnv,
} from "@repo/features/checkout-diff";
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
  type SandboxService,
  SandboxUnavailable,
  UP_STATUSES,
} from "@repo/sandbox";
import { Duration, Effect, Option } from "effect";
import { agentSandboxName, agentSandboxOf } from "../agent-sandbox-open.js";
import {
  CHECKOUT_DIFF_OUTCOME,
  type CheckoutDiffOutcome,
  RESTORE_OUTCOME,
  type RestoreOutcome,
} from "../machine/agent-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { touchAgentSandbox } from "../sandbox-use.js";
import { AgentSandbox } from "../terminal/agent-sandbox.js";

export const CHECKOUT_RESTORE = {
  /** The most a rewind waits on the restore, the sandbox woken included. */
  TIMEOUT: Duration.seconds(60),
  /** How many characters of a failed restore's stderr are logged, from its end. */
  STDERR_TAIL: 600,
} as const;

/** What a restore is asked: whose sandbox, by its session, and the snapshot to put the checkout back to. */
export interface RestoreAsk {
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

/**
 * The stopped sandbox made again on its own drive as the Terminal wakes it,
 * read again for the run it is up in. Note that one not up yet, as on an
 * image still being prepared, fails the call rather than answering none,
 * because its checkout still stands on the drive, so it is no snapshot missing.
 */
const wokenOnDrive = (sandboxes: SandboxService, sessionId: string, name: string) =>
  Effect.gen(function* () {
    yield* (yield* AgentSandbox).resume(sessionId);
    const woken = yield* sandboxes.get(name);
    const running = woken === undefined ? undefined : runningOf(woken);

    if (running === undefined) {
      return yield* new SandboxUnavailable({ detail: "the agent's sandbox is still starting" });
    }

    return running;
  });

/**
 * One script run in the checkout of the agent's sandbox, woken where it
 * stopped, with the variables given; none where no sandbox holding the
 * checkout stands for the session.
 */
const ranInCheckout = (
  sandboxes: SandboxService,
  sessionId: string,
  script: string,
  env: Readonly<Record<string, string>>,
) =>
  Effect.gen(function* () {
    const sandbox = yield* agentSandboxOf(sandboxes, sessionId);

    if (sandbox === undefined) return undefined;

    // MIGRATION: a legacy sandbox (`agentSandboxOf`) is never woken in place; one not up holds no snapshot a restore reaches.
    if (!UP_STATUSES.has(sandbox.status) && sandbox.name !== agentSandboxName(sessionId)) {
      return undefined;
    }

    // A stopped sandbox with its own drive is made again on it, as the Terminal wakes it; one whose snapshot the provider dropped holds no checkout to put back.
    const running =
      runningOf(sandbox) ??
      ((yield* sandboxes.ownDriveStands(sandbox.name))
        ? yield* wokenOnDrive(sandboxes, sessionId, sandbox.name)
        : yield* resumedRunning(sandbox.name).pipe(
            Effect.catchTag("SnapshotGone", () => Effect.succeed(undefined)),
          ));

    if (running === undefined) return undefined;
    yield* touchAgentSandbox(sandbox.name);

    return yield* sandboxes.run(running, {
      command: "sh",
      args: ["-c", script],
      cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
      env,
    });
  }).pipe(Effect.provideService(Sandbox, sandboxes));

/** The restore in the agent's sandbox, woken where it stopped. */
const restoreIn = (sandboxes: SandboxService, ask: RestoreAsk) =>
  Effect.gen(function* () {
    const ran = yield* ranInCheckout(
      sandboxes,
      ask.sessionId,
      CHECKOUT_RESTORE_SCRIPT,
      checkoutRestoreEnv(ask.snapshot),
    );

    if (ran === undefined) return RESTORE_OUTCOME.MISSING;

    if (ran.exitCode === 0) return RESTORE_OUTCOME.RESTORED;

    if (ran.exitCode === CHECKOUT_RESTORE_EXIT.MISSING) return RESTORE_OUTCOME.MISSING;
    yield* Effect.logWarning(
      `the checkout was not restored: the restore exited ${ran.exitCode}: ${stderrTail(ran.stderr)}`,
    );

    return RESTORE_OUTCOME.FAILED;
  });

/** What a diff is asked: whose sandbox, by its session, and the two sides the diff stands between. */
export interface DiffAsk {
  /** The session the agent's sandbox is tagged with. */
  readonly sessionId: string;
  readonly range: CheckoutDiffRange;
}

/** The diff in the agent's sandbox, woken where it stopped, as the restore runs. */
const diffIn = (sandboxes: SandboxService, ask: DiffAsk) =>
  Effect.gen(function* () {
    const ran = yield* ranInCheckout(
      sandboxes,
      ask.sessionId,
      CHECKOUT_DIFF_SCRIPT,
      checkoutDiffEnv(ask.range),
    );

    const missing: CheckoutDiffOutcome = { outcome: CHECKOUT_DIFF_OUTCOME.MISSING };

    if (ran === undefined) return missing;

    if (ran.exitCode === 0) {
      const diffed: CheckoutDiffOutcome = {
        outcome: CHECKOUT_DIFF_OUTCOME.DIFFED,
        diff: ran.stdout,
      };

      return diffed;
    }

    if (ran.exitCode === CHECKOUT_DIFF_EXIT.MISSING) return missing;
    yield* Effect.logWarning(
      `the checkout was not diffed: the diff exited ${ran.exitCode}: ${stderrTail(ran.stderr)}`,
    );
    const failed: CheckoutDiffOutcome = { outcome: CHECKOUT_DIFF_OUTCOME.FAILED };

    return failed;
  });

/**
 * The diff of the agent's checkout between the two sides, as above, within
 * the restore's bound; a call that failed or the bound passed is a failure,
 * logged, and never the caller's own.
 */
export const diffCheckout = /* @__PURE__ */ Effect.fn("web/diffCheckout")(function* (
  sandboxes: SandboxService,
  ask: DiffAsk,
): Effect.fn.Return<CheckoutDiffOutcome, never, DatabaseServices | AgentSandbox> {
  const outcome = yield* diffIn(sandboxes, ask).pipe(
    Effect.timeoutOption(CHECKOUT_RESTORE.TIMEOUT),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the checkout was not diffed: ${String(failure)}`),
        Option.some<CheckoutDiffOutcome>({ outcome: CHECKOUT_DIFF_OUTCOME.FAILED }),
      ),
    ),
  );

  if (Option.isSome(outcome)) return outcome.value;
  yield* Effect.logWarning("the checkout was not diffed in time");

  return { outcome: CHECKOUT_DIFF_OUTCOME.FAILED };
});

/**
 * The agent's checkout put back to the snapshot, as above, within the
 * bound; a call that failed or the bound passed is a failure, logged, and
 * never the caller's own.
 */
export const restoreCheckout = /* @__PURE__ */ Effect.fn("web/restoreCheckout")(function* (
  sandboxes: SandboxService,
  ask: RestoreAsk,
): Effect.fn.Return<RestoreOutcome, never, DatabaseServices | AgentSandbox> {
  const outcome = yield* restoreIn(sandboxes, ask).pipe(
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
