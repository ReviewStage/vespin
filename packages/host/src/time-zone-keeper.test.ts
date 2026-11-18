import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import { keepTimeZone } from "./time-zone-keeper.js";

/**
 * time-zone-keeper.test.ts -- the device's zone named to the service: once at launch, again only once the zone or the account moves or a write was not kept, and never while signed out.
 */

it.effect(
  "names the zone at launch, again only once it or the account moves or a write was not kept, and nothing while signed out",
  () =>
    Effect.gen(function* () {
      let zone = "America/New_York";
      let account: string | undefined = "member-1";
      let keeps = true;
      const sent: Array<{ readonly account: string | undefined; readonly zone: string }> = [];
      const raised = yield* PubSub.unbounded<void>();

      yield* Effect.forkScoped(
        keepTimeZone({
          zone: () => zone,
          account: () => account,
          write: (named) =>
            Effect.sync(() => {
              sent.push({ account, zone: named });

              return keeps;
            }),
          focused: Effect.map(PubSub.subscribe(raised), Stream.fromSubscription),
        }),
      );

      yield* TestClock.adjust("1 second");
      yield* PubSub.publish(raised, undefined);
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(sent, [{ account: "member-1", zone: "America/New_York" }]);

      zone = "Europe/Lisbon";
      keeps = false;
      yield* PubSub.publish(raised, undefined);
      yield* TestClock.adjust("1 second");
      keeps = true;
      yield* TestClock.adjust("5 minutes");
      account = "member-2";
      yield* TestClock.adjust("5 minutes");
      account = undefined;
      yield* TestClock.adjust("5 minutes");

      assert.deepEqual(sent, [
        { account: "member-1", zone: "America/New_York" },
        { account: "member-1", zone: "Europe/Lisbon" },
        { account: "member-1", zone: "Europe/Lisbon" },
        { account: "member-2", zone: "Europe/Lisbon" },
      ]);
    }),
);
