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
 * hold costs one write a minute. A write that fails is logged and let be: it
 * never fails a turn or an open, and the next touch writes it again.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
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
      Effect.logWarning(`a sandbox's last use was not recorded: ${failure._tag}`),
    ),
  );

/** The agent's sandbox, just opened, recorded LIVE and used now. */
export const recordedSandboxOpen = (
  agentId: string,
  sandboxName: string,
): Effect.Effect<void, never, DatabaseServices> =>
  loggedIfFailed(
    Effect.flatMap(useNow(sandboxName), (use) => recordAgentSandboxOpen(agentId, use)),
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
