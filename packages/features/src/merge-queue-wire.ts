import { literalsReadingUnknown } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * merge-queue-wire.ts -- every pull request GitHub's merge queues hold across the repositories a workspace's tasks work in, as the Merge queue page reads them.
 *
 * A member asks for one workspace (`GET /api/workspaces/merge-queue`); the
 * answer lists each repository whose default branch is merged through a
 * merge queue, with GitHub's own page of that queue and the pull requests it
 * holds in the order GitHub will merge them. A pull request an agent of one
 * of the workspace's tasks opened names that task. A repository with no
 * queue, or one the workspace's GitHub installation does not reach, is left
 * out, so an empty list is a workspace with nothing queued. The read stands
 * behind the account's Merge queue experiment, and is refused as not
 * permitted while it is off. GitHub refusing a queue to the App's token is
 * refused as an upstream error, never answered as no queue.
 */

export const MERGE_QUEUE_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const MERGE_QUEUE_BOUNDS = {
  /** The most repositories one read asks GitHub about: those the workspace's tasks changed most recently. */
  MAX_REPOSITORIES: 30,
  /** The most entries read of one queue, from its front. */
  MAX_ENTRIES: 50,
} as const;

/**
 * Where a pull request stands in its queue, as GitHub's
 * `MergeQueueEntryState` says it
 * (https://docs.github.com/en/graphql/reference/enums#mergequeueentrystate).
 */
export const MERGE_QUEUE_ENTRY_STATE = {
  /** Waiting its turn: GitHub has not yet built its merge group. */
  QUEUED: "queued",
  /** Its merge group's required checks are running. */
  AWAITING_CHECKS: "awaiting-checks",
  /** Its checks passed, and it merges once those ahead of it do. */
  MERGEABLE: "mergeable",
  /** It cannot be merged, and leaves the queue. */
  UNMERGEABLE: "unmergeable",
  /** The queue is locked, so nothing in it moves. */
  LOCKED: "locked",
} as const;

export type MergeQueueEntryState =
  (typeof MERGE_QUEUE_ENTRY_STATE)[keyof typeof MERGE_QUEUE_ENTRY_STATE];

/** The read's query: the workspace, by its id. */
export const mergeQueueRequestSchema = EffectSchema.Struct({
  [MERGE_QUEUE_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export type MergeQueueRequest = typeof mergeQueueRequestSchema.Type;

/** The task an entry's pull request belongs to: the task of an agent that opened it. */
const mergeQueueTaskSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** Its number in the workspace, which its key is drawn from. */
  number: countedNumber,
  name: EffectSchema.String,
});

/** Who opened the pull request, as GitHub names them; none for a deleted account. */
const mergeQueueAuthorSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  avatarUrl: EffectSchema.String,
});

/** One pull request in a queue. */
export const mergeQueueEntrySchema = EffectSchema.Struct({
  /** Where it stands, counted from one at the front. */
  position: countedNumber,
  /** A state a later GitHub adds reads as queued. */
  state: literalsReadingUnknown(
    Object.values(MERGE_QUEUE_ENTRY_STATE),
    MERGE_QUEUE_ENTRY_STATE.QUEUED,
  ),
  /** When it joined the queue, in milliseconds since the epoch. */
  enqueuedAt: countedNumber,
  pullRequest: EffectSchema.Struct({
    number: countedNumber,
    title: EffectSchema.String,
    url: EffectSchema.String,
    author: EffectSchema.NullOr(mergeQueueAuthorSchema),
  }),
  task: EffectSchema.NullOr(mergeQueueTaskSchema),
});

export type MergeQueueEntry = typeof mergeQueueEntrySchema.Type;

/** One repository's queue: the repository as GitHub spells it, GitHub's own page of the queue, and its entries, front first. */
export const mergeQueueRepositorySchema = EffectSchema.Struct({
  repository: githubRepositoryFullNameSchema,
  url: EffectSchema.String,
  entries: EffectSchema.Array(mergeQueueEntrySchema),
});

export type MergeQueueRepository = typeof mergeQueueRepositorySchema.Type;

/** The workspace's queues (GET), one per repository that has one, in the order its tasks changed them most recently. */
export const mergeQueueAnswerSchema = EffectSchema.Struct({
  repositories: EffectSchema.Array(mergeQueueRepositorySchema),
});

export type MergeQueueAnswer = typeof mergeQueueAnswerSchema.Type;
