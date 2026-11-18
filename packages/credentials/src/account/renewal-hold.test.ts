import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { renewalHeldBy } from "./renewal-hold.js";

it.effect("a renewal cut off midway still gives back the background time it held", () =>
  Effect.gen(function* () {
    const held = new Set<number>();
    let next = 0;

    const whileFinishing = renewalHeldBy({
      begin: () => {
        next += 1;
        held.add(next);

        return next;
      },
      end: (hold) => {
        held.delete(hold);
      },
    });

    const started = yield* Deferred.make<number>();

    const renewal = yield* Effect.forkChild(
      whileFinishing(
        Effect.andThen(
          Effect.suspend(() => Deferred.succeed(started, held.size)),
          Effect.never,
        ),
      ),
    );

    assert.equal(yield* Deferred.await(started), 1);
    yield* Fiber.interrupt(renewal);
    assert.equal(held.size, 0);
  }),
);
