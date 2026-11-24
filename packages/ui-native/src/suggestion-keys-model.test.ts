// suggestion-keys-model.test.ts -- the arrows step through the floating list's rows and wrap round its ends, the first arrow choosing an end.

import { describe, expect, it } from "vitest";
import { LIST_KEY, movedChoice } from "./suggestion-keys-model.js";

describe("movedChoice", () => {
  it("chooses the first row on ↓ and the last on ↑ with none chosen, and wraps round the ends", () => {
    expect(movedChoice(3, undefined, LIST_KEY.DOWN)).toBe(0);
    expect(movedChoice(3, undefined, LIST_KEY.UP)).toBe(2);
    expect(movedChoice(3, 2, LIST_KEY.DOWN)).toBe(0);
    expect(movedChoice(3, 0, LIST_KEY.UP)).toBe(2);
    expect(movedChoice(3, 1, LIST_KEY.DOWN)).toBe(2);
  });

  it("chooses nothing in a list of no rows", () => {
    expect(movedChoice(0, undefined, LIST_KEY.DOWN)).toBeUndefined();
  });
});
