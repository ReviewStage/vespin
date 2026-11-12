/**
 * task-change.ts -- a change to a task, as every door changes one: confirmed before anything is written, written, then followed through.
 *
 * The app's change (`plans.update`) and an agent's or a member's
 * `update_task` go through the same three steps, so one rule holds for
 * each; each door reads its own input and answers in its own words.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { listAgents } from "@repo/database/models/agent-store";
import {
  checkTreeRepository,
  readTaskHeader,
  type TaskChanged,
  type TaskChanges,
  updateTaskCommitted,
} from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { isTaskSettled, type TaskUpdateRequest } from "@repo/features/task-wire";
import type { Sandbox } from "@repo/sandbox";
import { Data, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { archivedWithTaskLetGo, doneTaskArchive } from "../agents/agent-change.js";
import { everyStoppedForGood, everyStopsForGood } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { SandboxDeleteReach } from "../agents/session-sandboxes.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_FINISHER } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { archiveAskedStatus } from "./archive-settle.js";

/** Who stops the agents an archive stops: the service with every coder tool, as the window's Stop does. */
const STOPPER = storeWriter({ tools: CODER_TOOL_SET });

/** A change as a door asks for it: the app's own, bar the place a released desktop still names, which goes nowhere. */
export type TaskChangeRequest = Omit<TaskUpdateRequest, "runsOn">;

/** A move the workspace's GitHub refused under the task's lock, carried out of the store's change as the refusal. */
class MoveRefused extends Data.TaggedError("MoveRefused")<{ readonly refusal: HostedRefusal }> {}

/** The move's guard: the workspace's GitHub reaches the repository the task names under its lock, so a move never strands one. */
const movedRepositoryReached =
  (workspaceId: string, member: string) =>
  (
    repository: string | null,
  ): Effect.Effect<void, MoveRefused, GitHubApp | HttpClient.HttpClient | DatabaseServices> =>
    repository === null
      ? Effect.void
      : workspaceRepository(workspaceId, repository, member).pipe(
          Effect.asVoid,
          Effect.mapError((refusal) => new MoveRefused({ refusal })),
        );

/** A change confirmed: what the store writes, the guard a move holds under the task's lock, and the agents a confirmed Done or Canceled stopped. */
export interface TaskChangeConfirmed {
  readonly changes: TaskChanges;
  readonly moveGuard: ReturnType<typeof movedRepositoryReached> | undefined;
  readonly stopped: ReadonlySet<string>;
}

/**
 * Every agent of the task but `caller` stopped for good, its ids answered;
 * refused as not ready, every agent standing, where one cannot be stopped
 * yet, since every agent is read before any is stopped and a refusal
 * cancels no one's work.
 */
const everyAgentStopped = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  caller: string | undefined,
) {
  const listed = yield* hostedStoreOrUnavailable(listAgents(userId, taskId));
  const agents = listed.filter((agent) => agent.id !== caller);

  if (!(yield* everyStopsForGood(agents))) {
    return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  }

  yield* everyStoppedForGood(STOPPER, userId, agents);

  return new Set(agents.map((agent) => agent.id));
});

/**
 * The change `userId` asked of the task, confirmed before the row is
 * touched, so a refused one leaves the rest unchanged too: a move is the
 * owner's alone, into a workspace they are a member of; a repository is
 * reached in the workspace the task ends up in, a teammate's on the App
 * alone, since a task on a token is its owner's, and held to the task's
 * tree; a new assignee is a member. Both are held again under the row's lock.
 * An archive an older caller asks for stops every agent of the task but
 * `caller`, the calling agent, which never stops itself, then settles the
 * task, or puts it back to work for an unarchive (`archive-settle.ts`), as
 * a move to Done or Canceled with `stopAgents` does before its write
 * archives them; an agent no Stop can name yet refuses either as not ready,
 * every agent standing.
 */
export const taskChangeAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  asked: TaskChangeRequest,
  caller?: string,
): Effect.fn.Return<
  TaskChangeConfirmed,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices | Sandbox
> {
  const header = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));

  if (Option.isNone(header)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { ownerId, status: standing } = header.value;
  const organizationId = asked.workspaceId;

  if (organizationId !== undefined) {
    if (ownerId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, organizationId));

    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }

  const workspaceId = organizationId ?? header.value.workspaceId;

  const reached =
    asked.repository === undefined
      ? undefined
      : asked.repository === null
        ? { repository: null, githubAccess: GITHUB_ACCESS.APP }
        : yield* Effect.map(
            workspaceRepository(
              workspaceId,
              asked.repository,
              ownerId === userId ? userId : undefined,
            ),
            (each) => ({ repository: each.repository.fullName, githubAccess: each.access }),
          );

  const { assigneeId } = asked;

  // Note that the assignee the task already names passes, since a member who left stays assigned until someone changes it.
  if (assigneeId !== undefined && assigneeId !== null && assigneeId !== header.value.assigneeId) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(assigneeId, workspaceId));

    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  // Note that the name GitHub resolved is asked, not the one typed, so a renamed repository's old name is the one held.
  if (reached !== undefined) {
    yield* checkTreeRepository(userId, taskId, reached.repository).pipe(
      Effect.catchTag(
        "TaskTreeRepositoryLocked",
        () => Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED),
        (failure) => hostedStoreOrUnavailable(Effect.fail(failure)),
      ),
    );
  }

  if (asked.archived === true) yield* everyAgentStopped(userId, taskId, caller);

  // Note that a settle asked again of a task already there stops nothing, because a turn begun since was never confirmed.
  const stopped: ReadonlySet<string> =
    isTaskSettled(asked.status) && asked.status !== standing && asked.stopAgents === true
      ? yield* everyAgentStopped(userId, taskId, caller)
      : new Set();

  // Note that the archive stamp is never written, because a task is archived no longer.
  const status =
    asked.status !== undefined || asked.archived === undefined
      ? asked.status
      : yield* hostedStoreOrUnavailable(
          archiveAskedStatus(userId, taskId, standing, asked.archived),
        );

  return {
    changes: {
      ...(asked.name === undefined ? undefined : { name: asked.name }),
      ...(organizationId === undefined ? undefined : { organizationId }),
      ...reached,
      ...(asked.pinned === undefined ? undefined : { pinned: asked.pinned }),
      ...(asked.pinPosition === undefined ? undefined : { pinPosition: asked.pinPosition }),
      ...(asked.readMark === undefined ? undefined : { readMark: asked.readMark }),
      ...(status === undefined ? undefined : { status }),
      ...(asked.priority === undefined ? undefined : { priority: asked.priority }),
      ...(assigneeId === undefined ? undefined : { assigneeId }),
    },
    moveGuard:
      organizationId === undefined ? undefined : movedRepositoryReached(organizationId, userId),
    stopped,
  };
});

/**
 * The change confirmed, written (`updateTaskCommitted`), a move to Done or
 * Canceled archiving the task's idle agents, and those its confirm stopped,
 * by `archivedBy` (`doneTaskArchive`);
 * none where the member reaches the task no more. Its refusals under the row's lock are answered
 * by name, as `taskChangeAsked` answers them.
 */
export const taskChangeWritten = (
  userId: string,
  taskId: string,
  { changes, moveGuard, stopped }: TaskChangeConfirmed,
  archivedBy: StoredArchive,
) =>
  updateTaskCommitted(
    userId,
    taskId,
    changes,
    moveGuard,
    doneTaskArchive(archivedBy, stopped),
  ).pipe(
    Effect.catchTags(
      {
        MoveRefused: (refused) => Effect.fail(refused.refusal),
        TaskAssigneeNotMember: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
        TaskTreeRepositoryLocked: () => Effect.fail(HOSTED_REFUSAL.CHILD_REPOSITORY_LOCKED),
      },
      (failure) => hostedStoreOrUnavailable(Effect.fail(failure)),
    ),
  );

/** The change followed through once it commits: the agents its move to Done archived let go of as an archive by hand does, and a move to Done or Canceled counted. */
export const taskChangeSettled = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxDeleteReach,
  userId: string,
  { task, archived, statusMoved }: TaskChanged,
) {
  yield* archivedWithTaskLetGo(reach, archived);

  if (statusMoved && isTaskSettled(task.status)) {
    yield* recordServerEvent(
      SERVER_EVENT.TASK_FINISH,
      { userId, workspaceId: task.workspaceId },
      { status: task.status, by: SERVER_TASK_FINISHER.MEMBER },
    );
  }
});
