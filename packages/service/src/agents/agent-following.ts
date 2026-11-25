/**
 * agent-following.ts -- the members following a Manager, an agent on no task: a member reads them, follows it or stops, switches whether it may use their machines, or adds or removes another member; and a member's message makes them follow.
 *
 * Every door of a Manager's following stands over this one module: the
 * hosted `agentFollowers` procedures and the member words path
 * (`followAsMessaged`, `task-following.ts`). An agent the account does not
 * reach, or one on a task, whose task holds its followers, is refused as no
 * agent; its owner, who always follows it with their machines on, is
 * refused an unfollow or a switch as not permitted.
 *
 * A member follows by hand with their machines off, and by messaging the
 * Manager with them on where they did not follow it yet; a follower keeps
 * their switch otherwise, which only they flip. Anything an agent, an
 * automation, GitHub, or a webhook sends makes no one follow.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type AgentFollower,
  type AgentFollowerIsOwner,
  type AgentFollowersWritten,
  followAgent,
  listAgentFollowers,
  setAgentFollowerMachines,
  unfollowAgent,
} from "@repo/database/models/agent-follower-store";
import type { AgentFollowersAnswer, AgentFollowerWire } from "@repo/features/agent-followers-wire";
import { Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";

/** What a member's follower read or write answers, refused as the procedures answer it. */
type FollowingEffect = Effect.Effect<AgentFollowersAnswer, HostedRefusal, DatabaseServices>;

/** One follower as the wire carries them. */
function followerWireOf(follower: AgentFollower): AgentFollowerWire {
  return { userId: follower.userId, owner: follower.owner, machines: follower.machines };
}

/** The followers a write left, as the procedures answer them; none written is answered as no agent. */
function answerOf(
  agentId: string,
  written: Option.Option<AgentFollowersWritten>,
): Effect.Effect<AgentFollowersAnswer, HostedRefusal> {
  if (Option.isNone(written)) return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { followers, txid } = written.value;
  const answer = { agentId, followers: followers.map(followerWireOf) };

  return Effect.succeed(txid === undefined ? answer : { ...answer, txid });
}

/** A write the owner is refused, answered as not permitted; any other as it stands. */
function ownerRefused(
  agentId: string,
  write: Effect.Effect<
    Option.Option<AgentFollowersWritten>,
    StoreFailure | AgentFollowerIsOwner,
    DatabaseServices
  >,
): FollowingEffect {
  return Effect.gen(function* () {
    const written = yield* hostedStoreOrUnavailable(
      write.pipe(
        Effect.map((done) => Result.succeed(done)),
        Effect.catchTag("AgentFollowerIsOwner", (refused) => Effect.succeed(Result.fail(refused))),
      ),
    );

    if (Result.isFailure(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);

    return yield* answerOf(agentId, written.success);
  });
}

/** The Manager's followers, its owner first, as the account reads them; refused as no agent where it does not reach one on no task. */
export function listAgentFollowersAsked(userId: string, agentId: string): FollowingEffect {
  return Effect.flatMap(
    hostedStoreOrUnavailable(listAgentFollowers(userId, agentId)),
    (followers) =>
      answerOf(
        agentId,
        Option.map(followers, (listed) => ({ followers: listed })),
      ),
  );
}

/** The account follows the Manager by hand, its machines off; one following already keeps its row. */
export function followAgentAsked(userId: string, agentId: string): FollowingEffect {
  return addAgentFollowerAsked(userId, agentId, userId);
}

/** Another member of the Manager's workspace added as a follower, their machines off; one following already keeps their row, and one who is no member answers as no agent. */
export function addAgentFollowerAsked(
  userId: string,
  agentId: string,
  followerId: string,
): FollowingEffect {
  return Effect.flatMap(
    hostedStoreOrUnavailable(followAgent(userId, { agentId, followerId, machines: false })),
    (written) => answerOf(agentId, written),
  );
}

/** The account stops following the Manager; its owner is refused as not permitted. */
export function unfollowAgentAsked(userId: string, agentId: string): FollowingEffect {
  return removeAgentFollowerAsked(userId, agentId, userId);
}

/** A follower of the Manager taken away, the account itself or another member; its owner is refused as not permitted. */
export function removeAgentFollowerAsked(
  userId: string,
  agentId: string,
  followerId: string,
): FollowingEffect {
  return ownerRefused(agentId, unfollowAgent(userId, agentId, followerId));
}

/** The account's own switch: whether the Manager may use its machines; one not following it answers as no agent, and its owner is refused as not permitted. */
export function setAgentFollowerMachinesAsked(
  userId: string,
  agentId: string,
  machines: boolean,
): FollowingEffect {
  return ownerRefused(agentId, setAgentFollowerMachines(userId, agentId, machines));
}

/**
 * A member's own words to a Manager make them follow it, with their machines
 * on, where they did not follow it yet; a follower's row stands as it is,
 * and its owner, who always follows, is written none. It never fails the
 * message it follows: a write the store could not make is logged for the
 * operator and the message goes on.
 */
export function followAgentAsMessaged(
  userId: string,
  agentId: string,
): Effect.Effect<void, never, DatabaseServices> {
  return followAgent(userId, { agentId, followerId: userId, machines: true }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => Option.none()),
    Effect.asVoid,
  );
}
