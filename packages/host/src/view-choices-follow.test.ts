import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { ViewChoiceLiveRow } from "@repo/features/view-choice-live";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { MANAGER_SORT } from "@repo/features/workspace-managers-model";
import { entityPool } from "@repo/sync";
import { Effect, Fiber } from "effect";
import type { AppViewChoices } from "./app-state.js";
import { polledLive } from "./testing/polled-live.js";
import { heldViewChoices, viewChoiceWritten } from "./view-choices-follow.js";

/**
 * view-choices-follow.test.ts -- a view choice kept is drawn over the
 * account's held choices the moment it is asked, before the service
 * answers: over the choice standing in its place, and as a choice of its
 * own where none stood there. Synthetic ids throughout.
 */

const ACCOUNT = "u-ada";
const STANDING = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const MADE = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const KEY = VIEW_CHOICE_KEY.MANAGER_SORT;

/** Every step the follow and the pool have to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 40 },
);

/** The workspaces and values the account's choices hold, as the slice last told them. */
const valuesOf = (told: readonly AppViewChoices[]) =>
  (told.at(-1)?.[ACCOUNT]?.rows ?? []).map(({ workspaceId, value }) => ({ workspaceId, value }));

it.effect("a choice kept is drawn at once, over the one standing in its place or as its own", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* entityPool();
      const live = polledLive<"choices">(["choices"]);
      const told: AppViewChoices[] = [];

      const standing: ViewChoiceLiveRow = {
        id: STANDING,
        key: KEY,
        workspaceId: "w-one",
        value: MANAGER_SORT.NAME,
      };

      live.set({ choices: [standing] }, ["41"]);

      const choices = yield* heldViewChoices({
        seal: (_userId, poll, after) => (poll ? live.poll(after) : Effect.succeed(live.first())),
        accountId: () => ACCOUNT,
        gate: () => true,
        pool,
        tell: (held) => void told.push(held),
      });

      yield* Effect.forkChild(choices.hold(ACCOUNT));
      yield* settled;
      assert.deepEqual(valuesOf(told), [{ workspaceId: "w-one", value: MANAGER_SORT.NAME }]);

      // The service never answers, so what is drawn is the writes' alone.
      const written = viewChoiceWritten(() => Effect.never);

      const over = yield* Effect.forkChild(
        pool.write(written, {
          id: STANDING,
          key: KEY,
          workspaceId: "w-one",
          value: MANAGER_SORT.CREATED,
        }),
      );

      const made = yield* Effect.forkChild(
        pool.write(written, {
          id: MADE,
          key: KEY,
          workspaceId: "w-two",
          value: MANAGER_SORT.RECENT_ACTIVITY,
        }),
      );

      yield* settled;
      assert.deepEqual(valuesOf(told), [
        { workspaceId: "w-one", value: MANAGER_SORT.CREATED },
        { workspaceId: "w-two", value: MANAGER_SORT.RECENT_ACTIVITY },
      ]);
      yield* Fiber.interrupt(over);
      yield* Fiber.interrupt(made);
    }),
  ),
);
