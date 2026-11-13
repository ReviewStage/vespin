/**
 * task-followers-procedures.ts -- the members following a task, as the hosted API answers them: follow, unfollow, the account's own machines switch, and another member added or removed.
 *
 * Each is a thin door over `task-following.ts`, which every door of
 * following shares: the path names the task by its id, read as a UUID so one
 * that is none answers as no task, and each answers the task's followers as
 * they then stand and the transaction the write committed in. No procedure
 * here switches another member's machines.
 */

import { pathUuid, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  addTaskFollowerAsked,
  followTaskAsked,
  removeTaskFollowerAsked,
  setFollowerMachinesAsked,
  unfollowTaskAsked,
} from "./task-following.js";

export interface TaskFollowersProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The followers resource, every procedure to a signed-in caller. */
export function taskFollowersProcedures(seams: TaskFollowersProcedureSeams) {
  const followers = hosted.taskFollowers.use(accountMiddleware(seams.resolveUserId));

  return {
    follow: followers.follow.effect(function* ({ input, context }) {
      return yield* followTaskAsked(context.userId, yield* pathUuid(input.id));
    }),
    unfollow: followers.unfollow.effect(function* ({ input, context }) {
      return yield* unfollowTaskAsked(context.userId, yield* pathUuid(input.id));
    }),
    setMachines: followers.setMachines.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);

      return yield* setFollowerMachinesAsked(context.userId, taskId, input.body.machines);
    }),
    add: followers.add.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);

      return yield* addTaskFollowerAsked(context.userId, taskId, input.body.userId);
    }),
    remove: followers.remove.effect(function* ({ input, context }) {
      return yield* removeTaskFollowerAsked(
        context.userId,
        yield* pathUuid(input.id),
        input.userId,
      );
    }),
  };
}
