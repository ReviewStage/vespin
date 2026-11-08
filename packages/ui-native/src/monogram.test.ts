import { describe, expect, it } from "vitest";
import { monogramOf } from "./monogram.js";

describe("monogramOf", () => {
  it.each([
    ["Dean Stratakos", "DS"],
    ["  ada   lovelace  ", "AL"],
    ["Ada", "A"],
    ["Mary Ann Evans", "ME"],
    ["Émile Zola", "ÉZ"],
    ["🚀", "?"],
    ["", "?"],
  ])("draws %j as %j", (name, monogram) => {
    expect(monogramOf(name)).toBe(monogram);
  });
});
