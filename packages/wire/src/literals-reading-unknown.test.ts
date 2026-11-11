import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { literalsReadingUnknown } from "./literals-reading-unknown.js";

const STATUS = { OPEN: "open", CLOSED: "closed" } as const;

describe("literalsReadingUnknown", () => {
  it("reads a known word as itself and an unknown word as the member given, and writes a word as it is", () => {
    const schema = literalsReadingUnknown(Object.values(STATUS), STATUS.CLOSED);
    const read = Schema.decodeUnknownSync(schema);
    expect(read(STATUS.OPEN)).toBe(STATUS.OPEN);
    expect(read("archived")).toBe(STATUS.CLOSED);
    expect(() => read(3)).toThrow();
    expect(Schema.encodeSync(schema)(STATUS.OPEN)).toBe(STATUS.OPEN);
  });
});
