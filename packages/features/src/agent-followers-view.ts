/**
 * agent-followers-view.ts -- a Manager's followers as a window asks the host for them and hears them back, and what Manager Settings › People says of them.
 *
 * A Manager's followers stand in for a task's (`task-followers-model.ts`):
 * its owner always follows it with their machines on, and any other member
 * of its workspace follows by hand, by being added, or by messaging it, each
 * flipping only their own switch. The window asks the host to read them, to
 * follow or stop, to flip the reader's own switch, or to add or remove
 * another member; each answers the followers as they then stand, the owner
 * first, or why they are unchanged. The words are the task popover's, with
 * the Manager in the task's place.
 */

import { Schema as EffectSchema } from "effect";
import type { AgentFollowerWire } from "./agent-followers-wire.js";
import { agentFollowersContract } from "./contract/agent-followers.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { FOLLOWING_WORDS } from "./task-followers-model.js";
import { taskAssigneeIdSchema } from "./task-wire.js";

/** A read, a follow, or an unfollow of a Manager by the account, as the window asks it: the Manager. */
export const agentFollowersParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
});

/** The account's own switch on a Manager it follows, as the window asks it: the Manager, and whether it may use the account's machines. */
export const agentFollowerMachinesParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  machines: EffectSchema.Boolean,
});

/** Another member added to or removed from a Manager's followers, as the window asks it: the Manager, and the member by their account's id. */
export const agentFollowerParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  userId: taskAssigneeIdSchema,
});

/** Why a Manager's followers were not read or changed: the service did not answer, the Manager is out of reach, or its owner was asked to stop following. */
export const AGENT_FOLLOWER_FAILURE = failureSetOf(agentFollowersContract);

export type AgentFollowerFailure =
  (typeof AGENT_FOLLOWER_FAILURE)[keyof typeof AGENT_FOLLOWER_FAILURE];

/**
 * A read, a follow, an unfollow, a switch, an add, or a removal, as the
 * window hears it: the Manager's followers as they then stand, its owner
 * first, or why they are unchanged. Note that it is the unfollow's answer,
 * whose refusals are every other procedure's and its own.
 */
export const agentFollowersAnswerViewSchema = answerView(agentFollowersContract.unfollow);

export type AgentFollowersAnswerView = typeof agentFollowersAnswerViewSchema.Type;

/** What Manager Settings › People says beyond the task popover's own words (`FOLLOWING_WORDS`). */
export const MANAGER_PEOPLE_WORDS = {
  /** The section's head, and the caption under it. */
  HEAD: "Followers",
  CAPTION: "This Manager and its agents may use the machines of anyone here who lets them.",
  /** The press that adds someone, and its menu's search. */
  ADD: "Add person",
  SEARCH: "Find a person",
  /** The owner's row's mark and card role. */
  OWNER: "Owner",
  /** A follower's row act. */
  REMOVE: "Remove",
  /** What the owner's own switch says in its place. */
  OWNER_MACHINES: "Always on for the Manager's owner",
  /** Said while the followers are read, and where they could not be. */
  READING: "Reading followers",
  UNREAD: "Followers could not be read.",
} as const;

/** A Manager's follower's role as their row's mark and card say it: Owner, or Following. */
export function managerFollowerRole(follower: AgentFollowerWire): string {
  return follower.owner ? MANAGER_PEOPLE_WORDS.OWNER : FOLLOWING_WORDS.FOLLOWER;
}

/**
 * What a follower's row says the Manager may do on their machines, by
 * `whose`, already possessive ("your", "Manuel Ruiz’s"), as the task
 * popover's card says it of a task's agents.
 */
export function managerFollowerMachinesSentence(
  follower: AgentFollowerWire,
  whose: string,
): string {
  return follower.machines
    ? `This Manager may use ${whose} machines for terminal commands and computer use.`
    : `This Manager may not use ${whose} machines for terminal commands or computer use.`;
}

/** What a refused follower write says: the owner always follows, the Manager is out of reach, or the service did not answer. */
export function managerFollowerRefusedNote(failure: AgentFollowerFailure): string {
  switch (failure) {
    case AGENT_FOLLOWER_FAILURE.NOT_PERMITTED:
      return "The owner always follows their Manager, with their machines on.";
    case AGENT_FOLLOWER_FAILURE.NOT_FOUND:
      return "This Manager can't be followed. It may be gone.";
    default:
      return "Followers could not be changed. Try again.";
  }
}
