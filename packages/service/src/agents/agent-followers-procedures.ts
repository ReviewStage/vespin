/**
 * agent-followers-procedures.ts -- the members following a Manager, as the hosted API answers them: the list, follow, unfollow, the account's own machines switch, and another member added or removed.
 *
 * Each is a thin door over `agent-following.ts`, which every door of a
 * Manager's following shares: the path names the agent by its id, read as a
 * UUID so one that is none answers as no agent, and each answers the
 * Manager's followers as they then stand and the transaction a write
 * committed in. No procedure here switches another member's machines.
 */

import { pathUuid, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  addAgentFollowerAsked,
  followAgentAsked,
  listAgentFollowersAsked,
  removeAgentFollowerAsked,
  setAgentFollowerMachinesAsked,
  unfollowAgentAsked,
} from "./agent-following.js";

export interface AgentFollowersProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The Manager followers resource, every procedure to a signed-in caller. */
export function agentFollowersProcedures(seams: AgentFollowersProcedureSeams) {
  const followers = hosted.agentFollowers.use(accountMiddleware(seams.resolveUserId));

  return {
    list: followers.list.effect(function* ({ input, context }) {
      return yield* listAgentFollowersAsked(context.userId, yield* pathUuid(input.id));
    }),
    follow: followers.follow.effect(function* ({ input, context }) {
      return yield* followAgentAsked(context.userId, yield* pathUuid(input.id));
    }),
    unfollow: followers.unfollow.effect(function* ({ input, context }) {
      return yield* unfollowAgentAsked(context.userId, yield* pathUuid(input.id));
    }),
    setMachines: followers.setMachines.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.params.id);

      return yield* setAgentFollowerMachinesAsked(context.userId, agentId, input.body.machines);
    }),
    add: followers.add.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.params.id);

      return yield* addAgentFollowerAsked(context.userId, agentId, input.body.userId);
    }),
    remove: followers.remove.effect(function* ({ input, context }) {
      return yield* removeAgentFollowerAsked(
        context.userId,
        yield* pathUuid(input.id),
        input.userId,
      );
    }),
  };
}
