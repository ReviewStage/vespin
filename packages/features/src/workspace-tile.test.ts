import { expect, it } from "vitest";
import { identityHue, identityLetter, workspaceSharedWords } from "./workspace-tile.js";

it("reads an identity's hue off its id alone, so a rename keeps it, and its letter is the first character a reader sees", () => {
  expect(identityHue("user-dana")).toBe(identityHue("user-dana"));
  expect(identityHue("user-dana")).toBeGreaterThanOrEqual(1);
  expect(identityHue("user-dana")).toBeLessThanOrEqual(6);
  expect(identityHue("user-dana")).not.toBe(identityHue("user-sam"));
  expect([identityLetter("  dana"), identityLetter("👩🏽‍💻 Ops"), identityLetter("")]).toEqual([
    "D",
    "👩🏽‍💻",
    "",
  ]);
});

it("says a personal workspace alone is personal, and counts the members of any other", () => {
  expect([
    workspaceSharedWords(1, true),
    workspaceSharedWords(1, false),
    workspaceSharedWords(5, true),
    workspaceSharedWords(undefined, true),
  ]).toEqual(["Personal workspace", "1 member", "5 members", undefined]);
});
