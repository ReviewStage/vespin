import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import type { ChaptersGenerator } from "@repo/features/pull-request-chapters-live";
import type { PullRequestChaptersAnswer } from "@repo/features/pull-request-chapters-wire";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppRepositoryPullRequestHeld } from "./app-state.js";
import { heldRepositoryChapters } from "./chapters-follow.js";
import { RepositoryPullRequestKey } from "./pull-request-parts.js";
import { polledLive } from "./testing/polled-live.js";

/**
 * chapters-follow.test.ts -- a pull request's held chapters take whether the
 * reader can generate them, and on what, from every answer: a key the reader
 * saves or swaps while the chapters are held draws at the next answer, though the chapters it
 * carries stand as they did, which no answer of rows alone would tell; and
 * they are read for the pull request held, and stand under its workspace,
 * repository, and number.
 * Synthetic ids, commits, and words.
 */

/** The pull request held, by its workspace, repository, and number. */
const KEY = new RepositoryPullRequestKey({
  workspaceId: "workspace-personal",
  repository: "acme/relay",
  number: 7,
});

/** The newest claim as the statement selects it, made and ready. */
const READY_ROW = {
  status: "ready",
  headSha: "c0ffee1",
  baseSha: "ba5e000",
  failureKind: null,
  model: "claude-haiku-5-5",
  chapters: [],
  startedAt: 1_762_214_400_000,
} as const;

/** Every step a follow has to take, taken, then its next poll asked, which waits half a second after the last answered (`live-follow.ts`). */
const nextPoll = Effect.andThen(
  Effect.repeat(Effect.yieldNow, { times: 100 }),
  Effect.andThen(
    TestClock.adjust(Duration.millis(500)),
    Effect.repeat(Effect.yieldNow, { times: 100 }),
  ),
);

it.effect(
  "a key saved or swapped while the chapters are held draws Generate on it though the chapters stand",
  () =>
    Effect.gen(function* () {
      const live = polledLive(["chapters"] as const);
      live.set({ chapters: [READY_ROW] });
      let generator: ChaptersGenerator = { generatable: false };
      const told: AppRepositoryPullRequestHeld<PullRequestChaptersAnswer>[] = [];
      const sealed: RepositoryPullRequestKey[] = [];

      const chapters = yield* heldRepositoryChapters({
        seal: (key, poll, _userId, after) => {
          sealed.push(key);

          return Effect.map(poll ? live.poll(after) : Effect.succeed(live.first()), (answer) => ({
            ...answer,
            ...generator,
          }));
        },
        accountId: () => "user-reader",
        gate: () => true,
        tell: (held) => told.push(held),
      });

      const held = yield* Effect.forkScoped(
        Effect.scoped(Effect.andThen(chapters.hold(KEY), Effect.never)),
      );

      const pullRequest = () =>
        told.at(-1)?.["workspace-personal"]?.["acme/relay"]?.["7"]?.rows?.pullRequest;

      const drawn = () => pullRequest()?.runsOn?.provider;

      yield* nextPoll;
      assert.deepEqual(sealed[0], KEY);
      assert.equal(pullRequest()?.number, KEY.number, "the chapters stand under the pull request");
      assert.equal(drawn(), undefined, "the reader holds no key yet");

      generator = {
        generatable: true,
        runsOn: { provider: MODEL_PROVIDER.OPENAI, model: "gpt-6-luna" },
      };
      live.set({});
      yield* nextPoll;
      assert.equal(drawn(), MODEL_PROVIDER.OPENAI, "the key saved is drawn at the next answer");

      generator = {
        generatable: true,
        runsOn: { provider: MODEL_PROVIDER.ANTHROPIC, model: "claude-haiku-5-5" },
      };
      live.set({});
      yield* nextPoll;
      assert.equal(
        drawn(),
        MODEL_PROVIDER.ANTHROPIC,
        "a key swapped is drawn though Generate stood",
      );

      generator = {
        ...generator,
        runsOnChoices: [
          { provider: MODEL_PROVIDER.ANTHROPIC, model: "claude-haiku-5-5" },
          { provider: MODEL_PROVIDER.OPENAI, model: "gpt-6-luna" },
        ],
      };
      live.set({});
      yield* nextPoll;
      assert.equal(
        pullRequest()?.runsOnChoices?.length,
        2,
        "a second key saved offers the pick though Generate runs on what it did",
      );
      yield* Fiber.interrupt(held);
    }),
);
