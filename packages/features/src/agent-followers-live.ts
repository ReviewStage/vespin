/**
 * agent-followers-live.ts -- the members following a Manager, followed over the service's held poll: the read declared, and its rows.
 *
 * Two statements answer it: the Manager's owner, who always follows it with
 * their machines on and holds no follower row, as one row while they are a
 * member of its workspace; and every other follower still a member of it,
 * with their switch, the earliest to follow first, each instant in epoch
 * milliseconds. A reader lists the owner first. The service answers
 * `not-found` for an agent the account does not reach, or one on a task,
 * whose task holds its followers; asked with `?poll=true`, the rows inline
 * at the poll address.
 */

import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import { LIVE_MODE, LIVE_PARAM, liveRead, liveRows, ORDER } from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/** The Manager's owner, by their account's id, and when they started it. */
const OWNER = liveRows({
  row: EffectSchema.Struct({ userId: EffectSchema.String, startedAt: countedNumber }),
  key: "userId",
  order: [["userId", ORDER.ASC]],
});

/** Each other follower, by their account's id, with whether the Manager may use their machines, the earliest to follow first. */
const FOLLOWERS = liveRows({
  row: EffectSchema.Struct({
    userId: EffectSchema.String,
    machines: EffectSchema.Boolean,
    followedAt: countedNumber,
  }),
  key: "userId",
  order: [
    ["followedAt", ORDER.ASC],
    ["userId", ORDER.ASC],
  ],
});

/** One Manager's followers, by the agent its query names under `?id=`: its owner and every other follower, two statements. */
export const AGENT_FOLLOWERS_READ = liveRead({
  name: "agentFollowers",
  path: HOSTED_SERVICE_PATH.LIVE_AGENT_FOLLOWERS,
  params: { id: LIVE_PARAM.ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { owner: OWNER, followers: FOLLOWERS },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});
