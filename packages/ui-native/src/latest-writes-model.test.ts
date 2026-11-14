import { describe, expect, it } from "vitest";
import {
  NO_WRITES,
  newestValue,
  takesRowBack,
  writeSent,
  writeSettled,
} from "./latest-writes-model.js";

describe("writeSettled", () => {
  it("keeps one row's refusal when another row's write lands after it", () => {
    const ada = writeSent<string, string>(NO_WRITES, "ada", "admin");
    const grace = writeSent(ada.book, "grace", "admin");
    const adaRefused = writeSettled(grace.book, "ada", ada.write, "Ada can't be an admin.");
    const graceLanded = writeSettled(adaRefused, "grace", grace.write, undefined);

    expect([...graceLanded.refusals]).toEqual([["ada", "Ada can't be an admin."]]);
  });

  it("says no refusal for a row whose earlier write is refused after a later one began", () => {
    const first = writeSent<string, string>(NO_WRITES, "default", "opus");
    const second = writeSent(first.book, "default", "sonnet");
    const landed = writeSettled(second.book, "default", second.write, undefined);
    const earlierRefused = writeSettled(landed, "default", first.write, "That model is off.");

    expect([...earlierRefused.refusals]).toEqual([]);
  });
});

describe("newestValue", () => {
  it("compares a pick back to the drawn value with the write still out, until it is answered", () => {
    const sentB = writeSent<string, string>(NO_WRITES, "follow-up", "steer");

    expect(newestValue(sentB.book, "follow-up", "queue")).toBe("steer");

    const sentA = writeSent(sentB.book, "follow-up", "queue");
    const bLanded = writeSettled(sentA.book, "follow-up", sentB.write, undefined);

    expect(newestValue(bLanded, "follow-up", "steer")).toBe("queue");

    const aLanded = writeSettled(bLanded, "follow-up", sentA.write, undefined);

    expect(newestValue(aLanded, "follow-up", "queue")).toBe("queue");
  });
});

describe("takesRowBack", () => {
  it("takes a row back for its newest write refused, never for one a later write on the row passed", () => {
    const opus = writeSent<string, string>(NO_WRITES, "default", "opus");
    const sonnet = writeSent(opus.book, "default", "sonnet");

    expect(takesRowBack(sonnet.book, "default", opus.write, "That model is off.")).toBe(false);
    expect(takesRowBack(sonnet.book, "default", sonnet.write, "That model is off.")).toBe(true);
    expect(takesRowBack(sonnet.book, "default", sonnet.write, undefined)).toBe(false);
  });
});
