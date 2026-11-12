import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration, Effect } from "effect";
import { Reporter } from "../effect/seams.js";
import { forgetRunnerGroups, keptRunnerGroups } from "../local-agent-state.js";

/**
 * host-runners-left.ts -- the agent runners a daemon killed outright left running, ended as the next daemon starts, before it lets go of any agent's turn.
 *
 * Each runner leads a process group of its own (`compose-local-agents.ts`),
 * so a service manager's kill of the daemon misses it, and a runner whose
 * stdin closed still finishes its turn. The follower keeps each running
 * runner's group in the machine's state (`keepRunnerGroup`) until its group
 * has been ended, so whatever records stand as a daemon starts name groups
 * a daemon before it left. Each group still alive is asked to end (SIGTERM),
 * and killed once `KILL_GRACE` has passed, and then every record is cleared,
 * so the follower lets go of the turns those runners held with none of them
 * still writing in the agent's folder, and a carry-on never starts a second
 * harness beside one still at work.
 *
 * A group id is reused once the machine restarts, so a record kept before
 * the machine last booted is never signaled, since every process it named
 * ended with that boot; nor is a group this process could not signal, which
 * is another user's.
 */

/** How long a group left running has to end after SIGTERM before it is sent SIGKILL, as long as the follower gives a runner it stops (`compose-local-agents.ts`). */
const KILL_GRACE = Duration.seconds(3);

/** Whether the process group given stood and took the signal; 0 only asks whether any process of it lives and is ours to signal. */
function signaled(group: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-group, signal);

    return true;
  } catch {
    return false;
  }
}

/**
 * Every runner's process group a daemon before this one left alive ended,
 * the machine having booted at `bootedAt`, in milliseconds since the epoch,
 * and every runner's record cleared.
 */
export const hostRunnersLeftStopped = Effect.fnUntraced(function* (
  stateRoot: string,
  bootedAt: number,
) {
  const { report } = yield* Reporter;
  const kept = yield* keptRunnerGroups(stateRoot);

  // Note that a record from before the boot names a group id the machine may since have handed to anything.
  const alive = kept
    .filter((record) => record.startedAt >= bootedAt && record.group !== process.pid)
    .map((record) => record.group)
    .filter((group) => signaled(group, 0));

  if (alive.length > 0) {
    report(
      `${PRODUCT_NAME} host: ending ${alive.length} agent runner${alive.length === 1 ? "" : "s"} a daemon before this one left running.`,
    );

    for (const group of alive) signaled(group, "SIGTERM");
    yield* Effect.sleep(KILL_GRACE);

    for (const group of alive) {
      if (signaled(group, 0)) signaled(group, "SIGKILL");
    }
  }

  yield* forgetRunnerGroups(stateRoot);
});
