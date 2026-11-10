import { describe, expect, it } from "vitest";
import { cliRemindAt } from "./cli-remind.js";

/** Tuesday, Nov 10, 2026, 10:00 AM in Los Angeles. */
const NOW = Date.parse("2026-11-10T10:00-08:00");
const ZONE = "America/Los_Angeles";

describe("cliRemindAt", () => {
  it("brings a day alone back at 9 AM in the reader's zone, and a time at that time", () => {
    expect(cliRemindAt("tomorrow", NOW, ZONE)).toEqual({
      at: Date.parse("2026-11-11T09:00-08:00"),
    });
    expect(cliRemindAt("2026-11-12T15:30-05:00", NOW, ZONE)).toEqual({
      at: Date.parse("2026-11-12T15:30-05:00"),
    });
  });

  it("refuses a range, a moment already past, and words naming no date", () => {
    for (const words of ["fri to mon", "yesterday", "whenever"]) {
      expect(cliRemindAt(words, NOW, ZONE)).toHaveProperty("refusal");
    }
  });
});
