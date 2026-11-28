import { it as effectIt } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { LIVE_MODE, liveRead, liveRows, liveRowsInSlices, ORDER } from "./live-read.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

const READ = liveRead({
  name: "rows",
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACES,
  params: {},
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    things: liveRows({
      row: Schema.Struct({ id: Schema.String, count: Schema.Number }),
      key: "id",
      order: [["id", ORDER.ASC]],
    }),
  },
});

describe("liveRead", () => {
  it("keeps the rows that read and leaves out one that does not, and writes rows as they are", () => {
    const first = { id: "a", count: 1 };
    const last = { id: "c", count: 3 };

    const read = Schema.decodeUnknownSync(READ.rows)({
      things: [first, { id: "b", count: "three" }, last],
    });

    expect(read).toEqual({ things: [first, last] });
    expect(Schema.encodeSync(READ.rows)(read)).toEqual({ things: [first, last] });
  });
});

describe("liveRowsInSlices", () => {
  effectIt.effect(
    "decodes a large answer as its rows do, leaving out a row that does not read, while other work runs between its slices",
    () =>
      Effect.gen(function* () {
        // Note that the answer holds several slices' rows, as a busy account's whole Inbox does.
        const things = Array.from({ length: 2_500 }, (_, at) => ({ id: `t${at}`, count: at }));

        const carried = {
          things: [...things.slice(0, 1_200), { id: "bad", count: "x" }, ...things.slice(1_200)],
        };

        const order: string[] = [];

        const decoding = yield* Effect.forkChild(
          Effect.tap(liveRowsInSlices(READ.parts).decodeInSlices(carried), () =>
            Effect.sync(() => order.push("decoded")),
          ),
        );

        yield* Effect.forkChild(Effect.sync(() => order.push("other")));
        const decoded = yield* Fiber.join(decoding);

        expect(decoded).toEqual({ things });
        expect(order).toEqual(["other", "decoded"]);
      }),
  );
});
