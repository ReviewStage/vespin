import { expect, it } from "vitest";
import { tileSymbol } from "./workspace-tile-model.js";

it("draws a name's letter on SF Symbols' square, and the plain square where it squares no such character", () => {
  expect([
    tileSymbol("acme"),
    tileSymbol(" 7 Labs"),
    tileSymbol("Émile"),
    tileSymbol("🚀 Ops"),
  ]).toEqual(["a.square.fill", "7.square.fill", "square.fill", "square.fill"]);
});
