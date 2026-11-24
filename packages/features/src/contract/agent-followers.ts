/**
 * agent-followers.ts -- the members following a Manager: the account reads them, follows it or stops, switches whether it may use the account's machines, or adds or removes another member as a follower.
 *
 * Every path names the agent by its id (`{id}`), which the handler reads as
 * an id, so one that is no UUID names no agent and answers as none. Each
 * answers the Manager's followers as they then stand, and the transaction a
 * write committed in (`agentFollowersAnswerSchema`). An agent the account
 * does not reach, or one on a task, whose task holds its followers, answers
 * as none; an unfollow or a removal of the Manager's owner, or a switch of
 * their own, is refused as not permitted, since they always follow it with
 * their machines on; an add of someone who is no member of its workspace
 * answers as none. No procedure here switches another member's machines.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  agentFollowerAddRequestSchema,
  agentFollowerMachinesRequestSchema,
  agentFollowersAnswerSchema,
} from "../agent-followers-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

/** A body is one id or one switch, so one past this is neither. */
const FOLLOWER_BODY_BYTES = 1_024;

const FOLLOWERS = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/followers` as const;
const FOLLOWING = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/following` as const;

/** The agent a path names, as text: the handler reads it as a UUID. */
const agentParams = EffectSchema.Struct({ id: EffectSchema.String });

/** The agent and the follower a path names, as text: the handler reads the agent as a UUID. */
const followerParams = EffectSchema.Struct({
  id: EffectSchema.String,
  userId: EffectSchema.String,
});

const answer = EffectSchema.flip(agentFollowersAnswerSchema);

export const agentFollowersContract = {
  /** The Manager's followers, its owner first. */
  list: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: FOLLOWERS }))
    .input(agentParams)
    .output(answer),
  /** The account follows the Manager, its machines off; one following already keeps its row as it stands. */
  follow: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: FOLLOWING }))
    .input(agentParams)
    .output(answer),
  /** The account stops following the Manager; refused for its owner. */
  unfollow: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: FOLLOWING }))
    .input(agentParams)
    .output(answer),
  /** The account's own switch: whether the Manager may use its machines; it must follow the Manager, and its owner is refused. */
  setMachines: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(FOLLOWER_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: `${FOLLOWING}/machines`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(agentParams, agentFollowerMachinesRequestSchema))
    .output(answer),
  /** Another member of the Manager's workspace added as a follower, their machines off; one following already keeps their row. */
  add: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(FOLLOWER_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: FOLLOWERS, inputStructure: "detailed" }))
    .input(exactBodyInput(agentParams, agentFollowerAddRequestSchema))
    .output(answer),
  /** Another follower taken away, their machines with them; one not following stays so, and the owner is refused. */
  remove: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: `${FOLLOWERS}/{userId}` }))
    .input(followerParams)
    .output(answer),
};
