/**
 * session-sandboxes-fake.ts -- a session's sandboxes as a suite scripts them, for the suites that archive or delete an agent and read what was asked of its sandbox.
 *
 * The double is a layer on `SessionSandboxes`: every delete is written down
 * in the order asked and answered as the suite scripts it.
 */

import type { SandboxUnavailable } from "@repo/sandbox";
import { Effect, Layer, Queue } from "effect";
import type { SandboxDeleteReach } from "../agents/session-sandboxes.js";
import { SessionSandboxes } from "../agents/session-sandboxes.js";

/** The deletes asked of the sandboxes, each session named in the order the deletes were asked, and the layer that answers them. */
export function scriptedSessionSandboxes(
  answer: (sessionId: string) => Effect.Effect<number, SandboxUnavailable> = () =>
    Effect.succeed(1),
) {
  return Effect.gen(function* () {
    const deletes = yield* Queue.unbounded<string>();

    const layer = Layer.succeed(SessionSandboxes, {
      deleteFor: (sessionId) =>
        Queue.offer(deletes, sessionId).pipe(Effect.andThen(answer(sessionId))),
    });

    return { layer, deletes };
  });
}

/** What keeps the function awake for an archive's delete in a test, which has no request to outlive: the delete forked detached. */
export const keepAwakeDetached: SandboxDeleteReach["keepAwake"] = (work) =>
  Effect.asVoid(Effect.forkDetach(work));
