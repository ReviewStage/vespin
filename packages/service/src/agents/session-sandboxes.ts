/**
 * session-sandboxes.ts -- a session's sandboxes stopped.
 *
 * Whatever shows a session's sandbox in use touches it (`@repo/sandbox`'s
 * `touch`); what is here stops it, and never resumes one stopped.
 *
 * An agent's session has one persistent sandbox (`agent-sandbox-open.ts`),
 * tagged with the session's id; a stopped sandbox keeps its checkout in
 * a snapshot until it lapses (`@repo/sandbox`'s retention), seven
 * days after last use, which is all that removes the sandbox of a session we
 * let go of for good, a deleted task's or a deleted account's. A retire's
 * reset deletes the sandboxes it finds as it discards them. An agent's
 * archive stops its sandbox rather than deleting it, in
 * the background (`stoppedInBackground`), so an unarchive still resumes from
 * the snapshot; a local agent's archive queues its device a discard line
 * there too (`device-discard.ts`). Nothing here reads a sandbox's files or a word of any account:
 * what is asked of the sandboxes is a tag and a name, and what is logged of
 * a failure is the sandbox's own words.
 */

import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import {
  isSandboxError,
  Sandbox,
  type SandboxError,
  type SandboxService,
  SandboxUnavailable,
  UP_STATUSES,
} from "@repo/sandbox";
import { Context, Duration, Effect, Layer, Option } from "effect";
import { afterResponse } from "../http/after-response.js";
import { SESSION_TAG } from "./agent-sandbox-open.js";
import { discardedOrLogged } from "./device-discard.js";

const ARCHIVE_STOP = {
  /**
   * The most one agent's stop runs, its list and its stop: long
   * enough for both calls on a slow answer, short enough that a hung one
   * does not hold the function's instance for the rest of its life.
   */
  TIMEOUT: Duration.seconds(15),
  /** How many agents of an archived task are stopped at once. */
  CONCURRENCY: 5,
} as const;

export interface SessionSandboxesService {
  /**
   * Stops every running sandbox tagged with the session, keeping its
   * filesystem for a later resume; answers how many were stopped.
   */
  readonly stopFor: (sessionId: string) => Effect.Effect<number, SandboxError>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** A session's sandboxes stopped, over `Sandbox`. */
function sessionSandboxesOver(api: SandboxService): SessionSandboxesService {
  return {
    stopFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(SESSION_TAG, sessionId);
        let stopped = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.running;
          // A sandbox already stopped has nothing to stop.
          if (!UP_STATUSES.has(sandbox.status)) continue;
          // One up with no run named cannot be stopped from here, and is no sandbox stopped either.
          if (running === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
          yield* api.stop({ name: sandbox.name, running });
          stopped += 1;
        }
        return stopped;
      }),
  };
}

/** The service over the runtime's `Sandbox`. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes, never, Sandbox> = Layer.effect(
  SessionSandboxes,
  Effect.map(Sandbox, sessionSandboxesOver),
);

/** What an archive of an agent asks of the deployment beside it: the service that stops its sandbox, over the runtime's `Sandbox` in production and a script's in a test, and what keeps the function awake for the stop. */
export interface SandboxStopReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes, never, Sandbox>;
  /**
   * Runs the work on past the archive's answer and answers at once. Vercel
   * may freeze a function once it has answered unless the work is handed to
   * `waitUntil`, so production hands it there (`orpc-route.ts`); a test
   * forks it detached (`testing/session-sandboxes-fake.ts`).
   */
  readonly keepAwake: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

/** The reach of a caller handed none, such as an agent's tool: the runtime's sandboxes, the stops kept past the answer where the runtime keeps work (`afterResponse`, the web's `waitUntil`), run in place where it keeps none. */
export const deploymentSandboxStops: SandboxStopReach = {
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake: (work) => afterResponse("an archived agent's sandbox stop", work),
};

/** A failure as the log says it: a sandbox's own words, and the kind alone for any other, since a store failure's message may name a statement. */
function describeStopFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return isSandboxError(failure) ? failure.message : failure._tag;
}

/**
 * One archived agent's sandbox stopped, if it is still archived. Note that
 * the archive is read again just before the stop, because an agent
 * unarchived and messaged since has resumed the sandbox this would stop, and
 * its turn must keep it; what is left of the race is the moment between this
 * read and the stop.
 */
const stoppedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  sessionId: string,
) {
  const current = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(current) || current.value.archivedAt === null) return;
  yield* (yield* SessionSandboxes).stopFor(sessionId);
});

/**
 * The sandboxes of the agents just archived stopped, never deleted, so an
 * unarchive resumes from the snapshot as a stopped sandbox does. Each
 * agent's session is read here, one keyed read that fails to nothing worse
 * than a log line, and the stops are handed to the reach to keep
 * the function awake for, so this returns without waiting on them and the
 * archive never fails on it. A stop that fails or runs past its bound is
 * logged and left: the runner's own end stops a sandbox a turn ran
 * (`coder-host/runner-sessions.ts`'s `runnerEnded`), so what is left
 * running here is one a terminal held. A local agent among them is let go
 * of on its device beside
 * the stops, its runner stopped and its folder removed (`device-discard.ts`).
 */
export const stoppedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxStopReach,
  agents: ReadonlyArray<Pick<Agent, "id" | "userId" | "conversationId">>,
) {
  const read = yield* Effect.forEach(agents, (agent) =>
    recordedRuntimeSession(agent).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `an archived agent's sandbox was not found to stop: ${describeStopFailure(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  // An agent that never opened a sandbox has no session, and none to stop.
  const stops = agents.flatMap((agent, at) => {
    const sessionId = read[at];
    return sessionId === undefined ? [] : [{ agent, sessionId }];
  });
  const stopOne = ({ agent, sessionId }: (typeof stops)[number]) =>
    stoppedWhileArchived(agent, sessionId).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_STOP.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's sandbox was not stopped: ${describeStopFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(stops, stopOne, { concurrency: ARCHIVE_STOP.CONCURRENCY, discard: true }),
        Effect.forEach(agents, discardedOrLogged, {
          concurrency: ARCHIVE_STOP.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});
