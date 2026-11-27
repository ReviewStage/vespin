import { expect, test } from "vitest";
import { foldsToWrite } from "./view-choice-folds.js";

/**
 * view-choice-folds.test.ts -- a fold pressed before the account's folds are
 * read waits for them, and is then laid over them, so no other fold the
 * account keeps is written away.
 */

test("a task opened before the account's opened tasks are read writes nothing, then joins them once read", () => {
  const opened = [{ id: "c", on: true }];

  expect(foldsToWrite({ answered: false, saved: [] }, opened)).toBeUndefined();
  expect(foldsToWrite({ answered: true, saved: ["a", "b"] }, opened)).toEqual(["a", "b", "c"]);
});

test("presses made in turn are laid in turn, the one last pressed standing", () => {
  const presses = [
    { id: "a", on: false },
    { id: "c", on: true },
    { id: "c", on: false },
    { id: "b", on: true },
  ];

  expect(foldsToWrite({ answered: true, saved: ["a", "b"] }, presses)).toEqual(["b"]);
});
