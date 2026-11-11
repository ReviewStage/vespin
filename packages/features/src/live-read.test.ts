import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { LIVE_MODE, liveRead, liveRows, ORDER } from "./live-read.js";
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
