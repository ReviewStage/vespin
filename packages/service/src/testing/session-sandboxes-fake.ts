/**
 * session-sandboxes-fake.ts -- a session's sandboxes as a suite scripts them, for the suites that archive an agent and read what was asked of its sandbox.
 *
 * The double is a layer on `SessionSandboxes`: every delete and every
 * archive script's run is written down in the order asked and answered as
 * the suite scripts it.
 */

import type { SandboxError, SandboxUnavailable } from "@repo/sandbox";
import { Effect, Layer, Queue } from "effect";
import type { ArchiveScript, ArchiveScriptRan } from "../agents/archive-script.js";
import type { SandboxDeleteReach } from "../agents/session-sandboxes.js";
import { SessionSandboxes } from "../agents/session-sandboxes.js";

/** What was asked of a session's sandboxes: an archive script's run, or the delete. */
export const SESSION_SANDBOXES_ASK = { ARCHIVE: "archive", DELETE: "delete" } as const;

type SessionSandboxesAsk = (typeof SESSION_SANDBOXES_ASK)[keyof typeof SESSION_SANDBOXES_ASK];

/** One ask of the sandboxes, with the session it named and the script an archive ran. */
export interface SessionSandboxesAsked {
  readonly ask: SessionSandboxesAsk;
  readonly sessionId: string;
  readonly script?: string;
}

/** The deletes asked of the sandboxes, each session named in the order the deletes were asked, every ask in order beside them, and the layer that answers them. */
export function scriptedSessionSandboxes(
  answer: (sessionId: string) => Effect.Effect<number, SandboxUnavailable> = () =>
    Effect.succeed(1),
  archived: (
    sessionId: string,
    archive: ArchiveScript,
  ) => Effect.Effect<ArchiveScriptRan | undefined, SandboxError> = () => Effect.succeed(undefined),
) {
  return Effect.gen(function* () {
    const deletes = yield* Queue.unbounded<string>();
    const asked = yield* Queue.unbounded<SessionSandboxesAsked>();

    const layer = Layer.succeed(SessionSandboxes, {
      deleteFor: (sessionId) =>
        Queue.offer(asked, { ask: SESSION_SANDBOXES_ASK.DELETE, sessionId }).pipe(
          Effect.andThen(Queue.offer(deletes, sessionId)),
          Effect.andThen(answer(sessionId)),
        ),
      archiveFor: (sessionId, archive) =>
        Queue.offer(asked, {
          ask: SESSION_SANDBOXES_ASK.ARCHIVE,
          sessionId,
          script: archive.script,
        }).pipe(Effect.andThen(archived(sessionId, archive))),
    });

    return { layer, deletes, asked };
  });
}

/** What keeps the function awake for an archive's delete in a test, which has no request to outlive: the delete forked detached. */
export const keepAwakeDetached: SandboxDeleteReach["keepAwake"] = (work) =>
  Effect.asVoid(Effect.forkDetach(work));
