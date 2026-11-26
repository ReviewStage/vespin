// offline-read-model.test.ts -- a read that failed while the phone is offline says the place comes back with the connection, not its own failure.

import { INBOX_NOT_READ } from "@repo/features/inbox-list-model";
import { describe, expect, it } from "vitest";
import { GLYPH } from "./glyph.js";
import { emptyStateWords } from "./offline-read-model.js";

describe("an empty state whose read failed", () => {
  it("says the place is there once back online, with no Try again, while the phone does not reach the service", () => {
    const failed = { title: INBOX_NOT_READ, symbol: GLYPH.FAILED };

    expect(emptyStateWords(failed, true, false)).toEqual({
      title: "Available when you're back online.",
      symbol: GLYPH.OFFLINE,
      description: undefined,
      acts: false,
      quiet: true,
    });
    expect(emptyStateWords(failed, true, true).title).toBe(INBOX_NOT_READ);
  });
});
