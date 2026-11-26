// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SHELL_MARK, ShellMarks, useShellMark, useShellMarks } from "./shell-marks.js";

/**
 * shell-marks.test.ts -- a page drawn in the same commit as its shell, as
 * one coming back from Settings is, has its mark worn on the shell, though
 * React lays the page's effects before it hands the shell its element; and
 * the mark goes as the page does. Synthetic throughout.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A page that holds the task page's mark while it stands. */
function TaskPage(): ReactNode {
  useShellMark(SHELL_MARK.TASK_PAGE);

  return createElement("section");
}

/** A shell wearing its pages' marks, drawn with `children` under it. */
function Shell({ children }: { children?: ReactNode }): ReactNode {
  const marks = useShellMarks();

  return createElement(
    "div",
    { ref: marks.ref, "data-testid": "shell" },
    createElement(ShellMarks, { hold: marks.hold, children }),
  );
}

test("a page drawn with its shell is worn on it, and leaves it as the page goes", () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);

  act(() => root.render(createElement(Shell, null, createElement(TaskPage))));
  const shell = host.querySelector('[data-testid="shell"]');

  assert.ok(shell, "the shell stands");
  assert.equal(shell.hasAttribute(SHELL_MARK.TASK_PAGE), true);

  act(() => root.render(createElement(Shell)));

  assert.equal(shell.hasAttribute(SHELL_MARK.TASK_PAGE), false);
});
