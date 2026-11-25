/**
 * agent-followers-wire.ts -- the members following a Manager, an agent on no task, as the hosted API answers them and a write asks: who follows, whether each lends their machines, and the add and switch a write sends.
 *
 * A Manager's followers stand in for a task's (`task-wire.ts`): its owner,
 * the member who started it, always follows it with their machines on and
 * is never unfollowed; any other member of its workspace follows it by hand
 * or by messaging it, and `machines` says whether the Manager and its
 * workers may use that member's machines, a switch only they flip.
 */

import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";
import { taskAssigneeIdSchema, taskTxidSchema } from "./task-wire.js";

/** One member following a Manager: their account's id, whether they are its owner, and whether it may use their machines. */
const agentFollowerSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  owner: EffectSchema.Boolean,
  machines: EffectSchema.Boolean,
});

export type AgentFollowerWire = typeof agentFollowerSchema.Type;

/** Another member of the Manager's workspace added as a follower (POST), by their account's id. */
export const agentFollowerAddRequestSchema = EffectSchema.Struct({
  userId: taskAssigneeIdSchema,
});

/** The account's own switch (PUT): whether the Manager may use its machines. */
export const agentFollowerMachinesRequestSchema = EffectSchema.Struct({
  machines: EffectSchema.Boolean,
});

/**
 * A Manager's followers as a read, a follow, an unfollow, an add, or a
 * switch leaves them, its owner first and the rest the earliest to follow
 * first, and the transaction a write committed in; none where nothing
 * changed.
 */
export const agentFollowersAnswerSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  followers: EffectSchema.Array(agentFollowerSchema),
  txid: EffectSchema.optionalKey(taskTxidSchema),
});

export type AgentFollowersAnswer = typeof agentFollowersAnswerSchema.Type;
