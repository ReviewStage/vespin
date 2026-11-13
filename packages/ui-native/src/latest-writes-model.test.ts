import { describe, expect, it } from "vitest";
import { NO_WRITES, writeSent, writeSettled } from "./latest-writes-model.js";

describe("writeSettled", () => {
  it("keeps one row's refusal when another row's write lands after it", () => {
    const ada = writeSent<string>(NO_WRITES, "ada");
    const grace = writeSent(ada.book, "grace");
    const adaRefused = writeSettled(grace.book, "ada", ada.write, "Ada can't be an admin.");
    const graceLanded = writeSettled(adaRefused, "grace", grace.write, undefined);

    expect([...graceLanded.refusals]).toEqual([["ada", "Ada can't be an admin."]]);
  });

  it("says no refusal for a row whose earlier write is refused after a later one began", () => {
    const first = writeSent<string>(NO_WRITES, "default");
    const second = writeSent(first.book, "default");
    const landed = writeSettled(second.book, "default", second.write, undefined);
    const earlierRefused = writeSettled(landed, "default", first.write, "That model is off.");

    expect([...earlierRefused.refusals]).toEqual([]);
  });
});
