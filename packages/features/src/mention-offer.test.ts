// mention-offer.test.ts -- a picked mention goes as the link the wire carries, and an `@` word is read where the words end.

import { describe, expect, it } from "vitest";
import { atWordEnding, withMentionLinks } from "./mention-offer.js";

describe("withMentionLinks", () => {
  it("writes each picked @name still standing as its markdown link, and leaves the rest as typed", () => {
    const sent = withMentionLinks("Ask @Dean Stratakos and @Ada, then email dean@example.com.", [
      { name: "Dean Stratakos", target: "https://vespin.dev/stage/person/u1" },
      { name: "Dean", target: "https://vespin.dev/stage/person/u2" },
    ]);

    expect(sent).toBe(
      "Ask [@Dean Stratakos](https://vespin.dev/stage/person/u1) and @Ada, then email dean@example.com.",
    );
  });
});

describe("atWordEnding", () => {
  it("reads the @ word the words end with, and none mid-word", () => {
    expect(atWordEnding("Ping @de")).toEqual({ start: 5, query: "de" });
    expect(atWordEnding("mail dean@ex")).toBeUndefined();
  });
});
