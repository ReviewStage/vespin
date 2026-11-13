/**
 * sandbox-use.ts -- an agent's sandbox's use recorded in our store as it is opened and touched, since its provider does not say when it was last used.
 *
 * A launch's open (`machine/sandbox-machine.ts`, through
 * `agent-sandbox-open.ts`) records the sandbox LIVE for its agent, and every
 * touch of an agent's sandbox in use goes through `touchAgentSandbox`, which
 * touches it (`@repo/sandbox`'s `touchSandbox`) and moves its last use on
 * (`@repo/database`'s `models/agent-sandboxes.ts`). The Terminal, the
 * agent's browser, and a preview only resume a sandbox a launch opened, and
 * their touches record that use. Each write is skipped where the row was
 * written in the last `SANDBOX_USE.WRITE_EVERY`, so a sandbox many callers
 * hold costs one write a minute. A launch records its boot beside it, begun,
 * done, or failed, and a discard the sandbox's deletion, so the task list
 * reads it booting, running, or off. What a member holds open in it is
 * recorded here too (`@repo/database`'s `models/agent-sandbox-holds.ts`): a
 * Terminal tab's shell as it starts and ends, the shells a list reads, and a
 * heartbeat while its ports are forwarded or its Browser view is open. A
 * write that fails is logged and let be: it never fails a turn, an open, or
 * a member's call, and the next touch, list, or beat writes it again.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  keepAgentSandboxTerminals,
  recordAgentSandboxHeld,
  recordAgentSandboxTerminalEnded,
  recordAgentSandboxTerminalOpened,
} from "@repo/database/models/agent-sandbox-holds";
import {
  recordAgentSandboxBooted,
  recordAgentSandboxBootFailed,
  recordAgentSandboxBooting,
  recordAgentSandboxDiscarded,
  recordAgentSandboxOpen,
  recordAgentSandboxUse,
} from "@repo/database/models/agent-sandboxes";
import { Sandbox, type SandboxError, touchSandbox } from "@repo/sandbox";
import { Clock, Duration, Effect } from "effect";

const SANDBOX_USE = {
  /** The most often a sandbox's last use is written: a minute, as often as whatever holds it touches it. */
  WRITE_EVERY: Duration.minutes(1),
} as const;

/** The use at now, its row left where written since the cutoff. */
const useNow = (sandboxName: string) =>
  Effect.map(Clock.currentTimeMillis, (now) => ({
    sandboxName,
    at: new Date(now),
    writtenBefore: new Date(now - Duration.toMillis(SANDBOX_USE.WRITE_EVERY)),
  }));

/** A write that failed, logged and let be. */
const loggedIfFailed = (
  write: Effect.Effect<void, StoreFailure, DatabaseServices>,
): Effect.Effect<void, never, DatabaseServices> =>
  write.pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`a sandbox's use was not recorded: ${failure._tag}`),
    ),
  );

/** The agent's sandbox, just opened, recorded LIVE and used now; one the open created on a `fresh` checkout, on any drive but the agent's own as it stood, has the snapshots its agent's turns hold forgotten, since they stood on a disk that is gone. */
export const recordedSandboxOpen = (
  agentId: string,
  sandboxName: string,
  fresh = false,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(useNow(sandboxName), (use) => recordAgentSandboxOpen(agentId, use, fresh)),
  );

/** The sandbox's last use moved to now, where an open recorded it. */
const recordedSandboxUse = (sandboxName: string): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(Effect.flatMap(useNow(sandboxName), recordAgentSandboxUse));

/** An agent's sandbox in use touched, and its use recorded once the sandbox confirms it; a touch it did not confirm fails, for a caller that tries it again (`touchedWhileUsed`). */
export const touchedAgentSandbox = (
  sandboxName: string,
): Effect.Effect<void, SandboxError, Sandbox | DatabaseServices> =>
  Effect.andThen(
    Effect.flatMap(Sandbox, (sandbox) => sandbox.touch(sandboxName)),
    recordedSandboxUse(sandboxName),
  );

/** An agent's sandbox in use touched, and its use recorded; a touch the sandbox did not confirm is logged by `touchSandbox`. */
export const touchAgentSandbox = (
  sandboxName: string,
): Effect.Effect<void, never, Sandbox | DatabaseServices> =>
  Effect.andThen(touchSandbox(sandboxName), recordedSandboxUse(sandboxName));

/** A boot of the agent's sandbox begun now, recorded so the task list reads it booting. */
export const recordedSandboxBooting = (
  agentId: string,
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      recordAgentSandboxBooting(agentId, sandboxName, new Date(now)),
    ),
  );

/** The sandbox's boot done now, its runner handed its first lines. */
export const recordedSandboxBooted = (
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      recordAgentSandboxBooted(sandboxName, new Date(now)),
    ),
  );

/** The sandbox's boot ended without its runner, as an open or launch that failed. */
export const recordedSandboxBootFailed = (
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(recordAgentSandboxBootFailed(sandboxName));

/** The sandbox deleted by its session's discard. */
export const recordedSandboxDiscarded = (
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(recordAgentSandboxDiscarded(sandboxName));

/** A member's heartbeat on the sandbox now: its ports forwarded to their Mac, or its Browser view open. */
export const recordedSandboxHeld = (
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      recordAgentSandboxHeld(sandboxName, new Date(now)),
    ),
  );

/** A Terminal tab's shell started in the sandbox now, which holds it until the shell ends. */
export const recordedTerminalOpened = (
  sandboxName: string,
  terminalId: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      recordAgentSandboxTerminalOpened(sandboxName, terminalId, new Date(now)),
    ),
  );

/** A Terminal tab's shell ended, its hold let go. */
export const recordedTerminalEnded = (
  sandboxName: string,
  terminalId: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(recordAgentSandboxTerminalEnded(sandboxName, terminalId));

/** The sandbox's shells as a list read them, every other tab's hold let go. */
export const keptSandboxTerminals = (
  sandboxName: string,
  terminalIds: ReadonlyArray<string>,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(keepAgentSandboxTerminals(sandboxName, terminalIds));
