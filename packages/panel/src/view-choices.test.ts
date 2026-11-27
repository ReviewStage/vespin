// @vitest-environment jsdom

import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { DEFAULT_MANAGER_SORT, MANAGER_SORT } from "@repo/features/workspace-managers-model";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { fakeActPort, fakeActPortCalls, refusedOnPort } from "./testing/app-bridge.js";
import { settleQueries, withQueryClient } from "./testing/copy-feedback.js";
import { keepViewChoices } from "./testing/view-choices.js";
import { type AccountChoice, useAccountChoice } from "./view-choices.js";

/**
 * view-choices.test.ts -- a choice made on the account is drawn in the
 * frame it is pressed, as a choice kept on the window was, so what a press
 * changes beside it (a list's rows, where the keyboard lands) changes with
 * it; and a write the account refused gives way to the account's choice.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The workspace whose Managers sort a test chooses. */
const WORKSPACE_ID = "workspace-acme";

/** Draws the Managers sort as a surface reads it, and answers what it last drew. */
function drawSort(): () => AccountChoice<typeof VIEW_CHOICE_KEY.MANAGER_SORT> {
  let latest: AccountChoice<typeof VIEW_CHOICE_KEY.MANAGER_SORT> | undefined;

  function Surface(): null {
    latest = useAccountChoice(
      VIEW_CHOICE_KEY.MANAGER_SORT,
      WORKSPACE_ID,
      DEFAULT_MANAGER_SORT,
      false,
      [undefined, () => undefined],
    );

    return null;
  }

  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(withQueryClient(createElement(Surface))));

  return () => {
    if (latest === undefined) throw new Error("the surface has not drawn");

    return latest;
  };
}

test("a choice made on the account is drawn in the frame it is pressed, and stands once kept", async () => {
  const written = keepViewChoices();
  const sort = drawSort();
  await settleQueries();

  act(() => sort().choose(MANAGER_SORT.NAME));
  expect(sort().value).toBe(MANAGER_SORT.NAME);
  await settleQueries();
  expect(written.map(({ value }) => value)).toEqual([MANAGER_SORT.NAME]);
  expect(sort().value).toBe(MANAGER_SORT.NAME);
});

test("a choice the account refused gives way to the account's", async () => {
  keepViewChoices();
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.VIEW_CHOICE_WRITE]: () => Promise.reject(refusedOnPort("Not kept.")),
  });
  const sort = drawSort();
  await settleQueries();

  act(() => sort().choose(MANAGER_SORT.NAME));
  expect(sort().value).toBe(MANAGER_SORT.NAME);
  await settleQueries();
  expect(sort().value).toBe(DEFAULT_MANAGER_SORT);
});
