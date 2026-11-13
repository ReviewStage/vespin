/**
 * task-followers.ts -- the members following a task: the account follows it or stops, switches whether its agents may use the account's machines, or adds or removes another member as a follower.
 *
 * Every path names the task by its id (`{id}`), which the handler reads as
 * an id, so one that is no UUID names no task and answers as none. Each
 * write answers the task's followers as they then stand, and the
 * transaction it committed in (`taskFollowersAnswerSchema`). A task the
 * account does not reach, or whose workspace has Following off, answers as
 * none; an unfollow or a removal of the task's assignee is refused as not
 * permitted, since the assignee follows the task while assigned; an add of
 * someone who is no member of the task's workspace answers as none. No
 * procedure here switches another member's machines.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  taskFollowerAddRequestSchema,
  taskFollowerMachinesRequestSchema,
  taskFollowersAnswerSchema,
} from "../task-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

/** A body is one id or one switch, so one past this is neither. */
const FOLLOWER_BODY_BYTES = 1_024;

const FOLLOWERS = `${HOSTED_SERVICE_PATH.TASKS}/{id}/followers` as const;
const FOLLOWING = `${HOSTED_SERVICE_PATH.TASKS}/{id}/following` as const;

/** The task a path names, as text: the handler reads it as a UUID. */
const taskParams = EffectSchema.Struct({ id: EffectSchema.String });

/** The task and the follower a path names, as text: the handler reads the task as a UUID. */
const followerParams = EffectSchema.Struct({
  id: EffectSchema.String,
  userId: EffectSchema.String,
});

const answer = EffectSchema.flip(taskFollowersAnswerSchema);

export const taskFollowersContract = {
  /** The account follows the task, its machines off; one following already keeps its row as it stands. */
  follow: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: FOLLOWING }))
    .input(taskParams)
    .output(answer),
  /** The account stops following the task; refused for its assignee. */
  unfollow: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: FOLLOWING }))
    .input(taskParams)
    .output(answer),
  /** The account's own switch: whether the task's agents may use its machines; it must follow the task. */
  setMachines: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(FOLLOWER_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: `${FOLLOWING}/machines`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(taskParams, taskFollowerMachinesRequestSchema))
    .output(answer),
  /** Another member of the task's workspace added as a follower, their machines off; one following already keeps their row. */
  add: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(FOLLOWER_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: FOLLOWERS, inputStructure: "detailed" }))
    .input(exactBodyInput(taskParams, taskFollowerAddRequestSchema))
    .output(answer),
  /** Another follower taken away, their machines with them; one not following stays so, and the assignee is refused. */
  remove: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: `${FOLLOWERS}/{userId}` }))
    .input(followerParams)
    .output(answer),
};
