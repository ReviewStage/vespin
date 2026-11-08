/**
 * session-sandboxes.ts -- a session's sandboxes deleted when its agent is archived, or its workspace deleted with its base drives.
 *
 * Whatever shows a session's sandbox in use touches it (`@repo/sandbox`'s
 * `touch`); what is here deletes it, and never resumes one stopped.
 *
 * An agent's session has one persistent sandbox (`agent-sandbox-open.ts`),
 * tagged with the session's id, and a new agent's sandbox owns a drive its
 * checkout stands on (`base-drive.ts`). A retire's reset deletes the
 * sandboxes it finds as it discards them, a deleted task's, agent's, or
 * account's. An agent's archive deletes its sandboxes too, in the background
 * (`deletedInBackground`), through `Sandbox`'s one `delete`, which deletes
 * the drive a sandbox owns with it, for every agent, one from before drives
 * as well, so an unarchive opens a sandbox afresh, its checkout made from
 * its repository's base drive and its pushed branch, as a sandbox whose
 * snapshot lapsed is; a local agent's archive queues its device a discard
 * line there too (`device-discard.ts`). A deleted workspace's agents'
 * sandboxes are deleted the same way (`deletedWithWorkspace`), from the
 * sessions its delete read while they stood, and so are its repositories'
 * base drives (`base-drive.ts`'s `deletedBaseDrive`), which no agent owns; a
 * local agent's device is told nothing there, since its discard line is
 * queued under the agent's rows, which the delete has taken. Nothing here
 * reads a sandbox's files
 * or a word of any account: what is asked of the sandboxes is a tag and a
 * name, and what is logged of a failure is the sandbox's own words.
 */

import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { isSandboxError, Sandbox, type SandboxError, type SandboxService } from "@repo/sandbox";
import { Context, Duration, Effect, Layer, Option } from "effect";
import { afterResponse } from "../http/after-response.js";
import { SESSION_TAG } from "./agent-sandbox-open.js";
import { deletedBaseDrive } from "./base-drive.js";
import { discardedOrLogged } from "./device-discard.js";

const ARCHIVE_DELETE = {
  /**
   * The most one agent's delete runs, its list and its delete, which stops
   * a run that holds the sandbox's drive before deleting both: long enough
   * for those calls on a slow answer, short enough that a hung one does not
   * hold the function's instance for the rest of its life. A deleted
   * workspace's base drive's delete, its fill's sandbox read, stopped and
   * deleted before the drive, is the same few calls and runs under the same.
   */
  TIMEOUT: Duration.seconds(15),
  /** How many agents of an archived task, or sandboxes and base drives of a deleted workspace, are deleted at once. */
  CONCURRENCY: 5,
} as const;

export interface SessionSandboxesService {
  /**
   * Deletes every sandbox tagged with the session, with the drive each
   * owns (`Sandbox`'s `delete`); answers how many were deleted.
   */
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxError>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** A session's sandboxes deleted, over `Sandbox`. */
function sessionSandboxesOver(api: SandboxService): SessionSandboxesService {
  return {
    deleteFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(SESSION_TAG, sessionId);
        for (const sandbox of sandboxes) yield* api.delete(sandbox.name);
        return sandboxes.length;
      }),
  };
}

/** The service over the runtime's `Sandbox`. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes, never, Sandbox> = Layer.effect(
  SessionSandboxes,
  Effect.map(Sandbox, sessionSandboxesOver),
);

/** What an archive of an agent asks of the deployment beside it: the service that deletes its sandbox, over the runtime's `Sandbox` in production and a script's in a test, and what keeps the function awake for the delete. */
export interface SandboxDeleteReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes, never, Sandbox>;
  /**
   * Runs the work on past the archive's answer and answers at once. Vercel
   * may freeze a function once it has answered unless the work is handed to
   * `waitUntil`, so production hands it there (`orpc-route.ts`); a test
   * forks it detached (`testing/session-sandboxes-fake.ts`).
   */
  readonly keepAwake: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

/** The reach of a caller handed none, such as an agent's tool: the runtime's sandboxes, the deletes kept past the answer where the runtime keeps work (`afterResponse`, the web's `waitUntil`), run in place where it keeps none. */
export const deploymentSandboxDeletes: SandboxDeleteReach = {
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake: (work) => afterResponse("an archived agent's sandbox delete", work),
};

/** A failure as the log says it: a sandbox's own words, and the kind alone for any other, since a store failure's message may name a statement. */
function describeDeleteFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return isSandboxError(failure) ? failure.message : failure._tag;
}

/**
 * One archived agent's sandboxes deleted, if it is still archived. Note
 * that the archive is read again just before the delete, because an agent
 * unarchived and messaged since has resumed the sandbox this would delete,
 * and its turn must keep it; what is left of the race is the moment between
 * this read and the delete.
 */
const deletedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  sessionId: string,
) {
  const current = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(current) || current.value.archivedAt === null) return;
  yield* (yield* SessionSandboxes).deleteFor(sessionId);
});

/**
 * The sandboxes of the agents just archived deleted, with the drives they
 * own, so an unarchive opens a sandbox afresh. Each agent's session is read
 * here, one keyed read that fails to nothing worse than a log line, and the
 * deletes are handed to the reach to keep the function awake for, so this
 * returns without waiting on them and the archive never fails on it. A
 * delete that fails or runs past its bound is logged and left, its sandbox
 * stopping on its own once idle and its drive kept until a later delete of
 * the name. A local agent among them is let go of on its device beside the
 * deletes, its runner stopped and its folder removed (`device-discard.ts`).
 */
export const deletedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  agents: ReadonlyArray<Pick<Agent, "id" | "userId" | "conversationId">>,
) {
  const read = yield* Effect.forEach(agents, (agent) =>
    recordedRuntimeSession(agent).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `an archived agent's sandbox was not found to delete: ${describeDeleteFailure(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  // An agent that never opened a sandbox has no session, and none to delete.
  const deletes = agents.flatMap((agent, at) => {
    const sessionId = read[at];
    return sessionId === undefined ? [] : [{ agent, sessionId }];
  });
  const deleteOne = ({ agent, sessionId }: (typeof deletes)[number]) =>
    deletedWhileArchived(agent, sessionId).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_DELETE.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's sandbox was not deleted: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(deletes, deleteOne, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
        Effect.forEach(agents, discardedOrLogged, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});

/**
 * The sandboxes of a deleted workspace's agents deleted, with the drives
 * they own, as an archive's are, by the sessions the workspace's delete read
 * while its agents stood, and the base drives of its repositories by the
 * names it read, each with the fill's sandbox under its name. Unlike
 * `deletedInBackground`, nothing is read again first, since the agents are
 * gone and none can resume its sandbox or fill a base drive. The deletes are
 * handed to the reach to keep the function awake for, so this returns
 * without waiting on them; one that fails or runs past its bound is logged
 * and left, its sandbox stopping on its own once idle and its drive kept.
 */
export const deletedWithWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  sessionIds: readonly string[],
  baseDrives: readonly string[],
) {
  const deleteSession = (sessionId: string) =>
    SessionSandboxes.use((sandboxes) => sandboxes.deleteFor(sessionId)).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_DELETE.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `a deleted workspace's agent's sandbox was not deleted: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  const deleteBase = (name: string) =>
    deletedBaseDrive(name).pipe(
      Effect.timeout(ARCHIVE_DELETE.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `a deleted workspace's base drive was not deleted: ${describeDeleteFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(sessionIds, deleteSession, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
        Effect.forEach(baseDrives, deleteBase, {
          concurrency: ARCHIVE_DELETE.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});
