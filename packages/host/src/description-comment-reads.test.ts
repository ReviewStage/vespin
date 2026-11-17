import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
} from "@repo/features/description-comment-wire";
import { COMMENT_SUBJECT } from "@repo/features/tasks-view";
import { entityPool } from "@repo/sync";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppDescriptionComments } from "./app-state.js";
import { CommentSubjectKey, descriptionCommentReads } from "./description-comment-reads.js";
import { descriptionCommentWrites } from "./description-comment-writes.js";
import { polledLive } from "./testing/polled-live.js";

/**
 * A description's comment threads as the host holds them: a thread a
 * member starts stands drawn from the moment it is asked until the read
 * draws it, never dropping out between the write's draw and the read's.
 * Synthetic threads.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const STARTED = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
const STANDING = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const TEXT = "## Goal\n\nAn admin invites a teammate by email.";

/** Every step the follow and the pool have to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 40 },
);

/** A thread as the service's read carries it, on the description's words. */
function threadRow(id: string, createdAt: number) {
  return {
    id,
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: "invites a teammate",
    anchorFrom: 17,
    anchorTo: 35,
    section: "Goal",
    pageId: null,
    pageVersion: null,
    pageElement: null,
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

/** The ids of the description's threads a slice told holds, in order. */
function threadIds(held: AppDescriptionComments): readonly string[] {
  return (held[COMMENT_SUBJECT.DESCRIPTION][TASK]?.rows ?? []).map((thread) => thread.id);
}

it.effect(
  "a thread started on the description stands in every draw from its start until the read draws it, as the service confirms its write",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pool = yield* entityPool();
        const live = polledLive<"threads" | "entries" | "files">(["threads", "entries", "files"]);
        const told: AppDescriptionComments[] = [];

        live.set({ threads: [threadRow(STANDING, 1)], entries: [], files: [] }, ["41"]);

        const reads = yield* descriptionCommentReads({
          pool,
          seal: (_follow, _userId, poll, after) =>
            poll ? live.poll(after) : Effect.succeed(live.first()),
          accountId: () => "u-ada",
          gate: () => true,
          tell: (held) => void told.push(held),
        });

        const writes = descriptionCommentWrites({
          start: (_taskId, start) =>
            Effect.succeed({
              thread: {
                id: start.id ?? STARTED,
                scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
                quote: "invites a teammate",
                anchor: { from: 17, to: 35 },
                section: "Goal",
                status: DESCRIPTION_COMMENT_STATUS.OPEN,
                entries: [],
                createdAt: 2,
                updatedAt: 2,
                revision: 1,
              },
              txid: "42",
            }),
          act: () => Effect.never,
          member: () => ({ userId: "u-ada", name: "Ada Lovelace" }),
          now: () => 2,
        });

        yield* reads.hold(new CommentSubjectKey({ taskId: TASK, pageId: undefined }));
        yield* settled;
        assert.deepEqual(told.map(threadIds).at(-1), [STANDING]);

        const write = yield* Effect.forkChild(
          pool.write(writes.started, {
            taskId: TASK,
            start: {
              id: STARTED,
              clientKey: STARTED,
              scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
              quote: "invites a teammate",
              anchor: { from: 17, to: 35 },
              text: TEXT,
              words: "Which email?",
            },
          }),
        );

        yield* settled;

        // The service commits the thread, and its read wakes carrying the write's transaction.
        live.set(
          { threads: [threadRow(STANDING, 1), threadRow(STARTED, 2)], entries: [], files: [] },
          ["42"],
        );
        yield* TestClock.adjust(Duration.seconds(1));
        yield* settled;

        const drawn = told.map(threadIds);
        const since = drawn.slice(drawn.findIndex((ids) => ids.includes(STARTED)));
        assert.ok(since.length > 1, "the thread was drawn started, then read");
        assert.ok(
          since.every((ids) => ids.includes(STARTED)),
          `the thread stood in every draw since it was started: ${JSON.stringify(drawn)}`,
        );
        yield* Fiber.interrupt(write);
      }),
    ),
);
