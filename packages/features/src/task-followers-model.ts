/**
 * task-followers-model.ts -- a task's followers as every client draws them: the reader first, what the Following chip says, and the words of each follower's row and card, the panel's and the iPhone's alike.
 *
 * A follower is named by their account's id (`@repo/wire`'s
 * `TaskFollowerWire`); the reader's own row leads the list, the rest in the
 * order they followed. The chip says Following while the reader follows the
 * task and Follow while they do not. Each row names the assignee, and a
 * follower whose switch is on lets the task's agents use their machines,
 * for terminal commands and computer use, which their card says in one
 * sentence. Only each client's own drawing is its own.
 */

import type { TaskFollowerWire } from "@repo/wire";
import { FOLLOWER_CALL_FAILURE, type FollowerCallFailure } from "./tasks-view.js";

/** How many faces the Following chip draws before a count of the rest, as every face pile does. */
export const FOLLOWING_FACES = 4;

/** What the Following chip, its rows, their cards, and its foot rows say. */
export const FOLLOWING_WORDS = {
  /** The chip, and what a reader hears it named. */
  CHIP: "Followers",
  /** The chip's words while the reader follows the task. */
  FOLLOWING: "Following",
  /** The chip's words while the reader does not, and the foot row that follows it. */
  FOLLOW: "Follow",
  UNFOLLOW: "Unfollow",
  /** The reader's own row. */
  YOU: "You",
  /** Adding someone else as a follower: the panel's offer to add a person mentioned, the popover's foot row, and the iPhone's member picker. */
  ADD_FOLLOWER: "Add a follower",
  /** Why Add a follower stands dimmed: every member already follows. */
  EVERYONE_FOLLOWS: "Everyone here follows",
  /** What a follower's row is, which names its ⋯ menu. */
  FOLLOWER_THING: "Follower",
  /** Taking another follower away, from their row's ⋯ menu. */
  REMOVE: "Remove follower",
  /** A row's muted mark on the assignee, and their card's role. */
  ASSIGNEE: "Assignee",
  /** A card's role for a follower who is not the assignee. */
  FOLLOWER: "Following",
  /** The reader's own switch. */
  MACHINES: "Let agents here use my machines",
  /** Why the assignee cannot unfollow. */
  ASSIGNEE_STAYS: "You're the assignee",
  /** A machine's state on a card. */
  ONLINE: "Online",
  OFFLINE: "Offline",
} as const;

/** The followers as a client draws them, for one reader. */
export interface FollowersView {
  /** The reader first, where they follow, then the rest in the order they followed. */
  readonly followers: readonly TaskFollowerWire[];
  /** The reader's own follow; none where they do not follow the task. */
  readonly reader: TaskFollowerWire | undefined;
  /** What the chip says. */
  readonly chipWords: string;
}

/** A task's followers for `readerId`: the reader's row first, and the chip's words. */
export function followersView(
  followers: readonly TaskFollowerWire[],
  readerId: string | undefined,
): FollowersView {
  const reader = followers.find((each) => each.userId === readerId);
  const others = followers.filter((each) => each !== reader);

  return {
    followers: reader === undefined ? others : [reader, ...others],
    reader,
    chipWords: reader === undefined ? FOLLOWING_WORDS.FOLLOW : FOLLOWING_WORDS.FOLLOWING,
  };
}

/** A follower's role as their card says it: Assignee, or Following. */
export function followerRoleWords(follower: TaskFollowerWire): string {
  return follower.assignee ? FOLLOWING_WORDS.ASSIGNEE : FOLLOWING_WORDS.FOLLOWER;
}

/**
 * What a follower's card says the task's agents may do on their machines,
 * by `whose`, already possessive ("your", "Manuel Ruiz’s"), as the client
 * names a person.
 */
export function followerMachinesSentence(follower: TaskFollowerWire, whose: string): string {
  return follower.machines
    ? `Agents on this task may use ${whose} machines for terminal commands and computer use.`
    : `Agents on this task may not use ${whose} machines for terminal commands or computer use.`;
}

/**
 * What a refused follower write says, in a notice, since the popover that
 * asked has changed nothing: the assignee may not unfollow or be removed, the task is out
 * of reach or Following is off for its workspace, or the service did not
 * answer.
 */
export function followerRefusedNote(failure: FollowerCallFailure): string {
  switch (failure) {
    case FOLLOWER_CALL_FAILURE.NOT_PERMITTED:
      return "The assignee keeps following their task while assigned.";
    case FOLLOWER_CALL_FAILURE.NOT_FOUND:
      return "This task can't be followed. It may be gone, or Following is off for its workspace.";
    default:
      return "Following could not be changed. Try again.";
  }
}
