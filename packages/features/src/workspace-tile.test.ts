import { expect, it } from "vitest";
import {
  identityHue,
  identityLetter,
  waitingInOthers,
  workspaceSharedWords,
  workspaceSwitcherLine,
} from "./workspace-tile.js";

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

it("counts what waits in each other workspace, never the chosen one, and marks the switcher only where another holds a thread", () => {
  const totals = new Map([
    ["acme", 4],
    ["home", 1],
  ]);

  const totalOf = (id: string) => totals.get(id) ?? 0;

  expect(waitingInOthers(["acme", "home", "lab"], "acme", totalOf)).toEqual({
    counts: [0, 1, 0],
    elsewhere: true,
  });
  expect(waitingInOthers(["acme", "lab"], "acme", totalOf)).toEqual({
    counts: [0, 0],
    elsewhere: false,
  });
  expect([
    workspaceSwitcherLine("5 members", 3),
    workspaceSwitcherLine("5 members", 0),
    workspaceSwitcherLine(undefined, 2),
    workspaceSwitcherLine(undefined, 0),
  ]).toEqual(["5 members · 3 waiting", "5 members", "2 waiting", undefined]);
});
