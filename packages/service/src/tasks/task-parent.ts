/**
 * task-parent.ts -- the parent a new task is made under, confirmed: reached by its maker in the same workspace, and the repository its child takes.
 *
 * A task may be made as the child of another, to any depth, by a member's
 * create (`tasks-procedures.ts`) and by an agent's `create_task`
 * (`agents/task-tools.ts`), both through this one check. The parent is read
 * as its maker reaches it (`readTaskHeader`), so a task another account
 * cannot open, one of a workspace it is not in, and one that names nothing
 * all read alike as unreached, and one of another workspace than the child's
 * is unreached too. A child works in its parent's repository, and a create
 * that names another repository is refused rather than overruled, so nothing is made somewhere
 * its maker did not ask; the refusals are the store's own, which a parent
 * set after creation (`setTaskParent`) answers too. It also hands back the
 * assignee a create that names none gives its child: the parent's assignee
 * where the maker is that assignee, or where every child the parent already
 * has is theirs too, and otherwise no one, as it is none where that member
 * has left the workspace.
 * Nesting has no bound.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  readChildAssignees,
  readTaskHeader,
  TaskParentRepositoryDiffers,
  TaskParentUnreached,
  type TaskStoreFailure,
} from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { sameRepository } from "@repo/features/github-repositories-wire";
import { Effect, Option } from "effect";

/** The parent a child is made under, and what the child takes from it. */
export interface TaskParent {
  readonly id: string;
  readonly repository: string | null;
  /** The assignee a child that names none takes from its parent; null for none. */
  readonly assigneeId: string | null;
}

/**
 * The assignee a child of `parentTaskId` made by `userId` takes when it names
 * none: the parent's, where the maker holds the parent or every child already
 * under it is the parent assignee's, and otherwise no one, so a child added to
 * a parent whose work is spread across members is not handed to whoever
 * holds the parent.
 */
const inheritedAssignee = Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  parentTaskId: string,
  assigneeId: string | null,
): Effect.fn.Return<string | null, TaskStoreFailure, DatabaseServices> {
  if (assigneeId === null) return null;
  const held =
    assigneeId === userId ||
    (yield* readChildAssignees(parentTaskId)).every((each) => each === assigneeId);
  // Note that a member who has left is dropped rather than refused, since the store would refuse the child for them.
  return held && (yield* isWorkspaceMember(assigneeId, workspaceId)) ? assigneeId : null;
});

/**
 * The parent a child is made under in `workspaceId`, as `userId` reaches it,
 * with the repository the child takes; `repositoryAsked` is the
 * one the create named, left out where it named none.
 */
export const taskParentOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  parentTaskId: string,
  repositoryAsked: string | null | undefined,
): Effect.fn.Return<
  TaskParent,
  TaskParentUnreached | TaskParentRepositoryDiffers | TaskStoreFailure,
  DatabaseServices
> {
  const header = yield* readTaskHeader(userId, parentTaskId);
  if (Option.isNone(header) || header.value.workspaceId !== workspaceId) {
    return yield* new TaskParentUnreached();
  }
  const { repository } = header.value;
  if (repositoryAsked !== undefined && !sameRepository(repositoryAsked, repository)) {
    return yield* new TaskParentRepositoryDiffers({ repository });
  }
  return {
    id: parentTaskId,
    repository,
    assigneeId: yield* inheritedAssignee(
      userId,
      workspaceId,
      parentTaskId,
      header.value.assigneeId,
    ),
  };
});
