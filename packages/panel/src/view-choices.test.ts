// @vitest-environment jsdom

import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { DEFAULT_MANAGER_SORT, MANAGER_SORT } from "@repo/features/workspace-managers-model";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { fakeActPort, fakeActPortCalls, refusedOnPort } from "./testing/app-bridge.js";
import { handState, signedInAs } from "./testing/app-state.js";
import { settleQueries, withQueryClient } from "./testing/copy-feedback.js";
import { hearViewChoices, keepViewChoices } from "./testing/view-choices.js";
import { type AccountChoice, useAccountChoice } from "./view-choices.js";

/**
 * view-choices.test.ts -- a choice made on the account is drawn in the
 * frame it is pressed, as a choice kept on the window was, so what a press
 * changes beside it (a list's rows, where the keyboard lands) changes with
 * it; a write the account refused gives way to the account's choice; and
 * a change made before the account's choices are read waits for them.
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

test("a change made before the account's choices are read writes nothing until they are, then is laid over the account's", async () => {
  fakeActPort({});
  handState(
    {},
    { account: signedInAs({ id: "user-ada", email: "ada@example.com", name: "Ada" }).account },
  );

  const early = hearViewChoices();
  const sort = drawSort();
  await settleQueries();

  // A change read off the choice standing, as a fold toggled is: from Recent activity it turns to Name, from anything else to Recent activity.
  const toggled = (standing: string) =>
    standing === MANAGER_SORT.RECENT_ACTIVITY ? MANAGER_SORT.NAME : MANAGER_SORT.RECENT_ACTIVITY;

  act(() => sort().change(toggled));
  await settleQueries();
  expect(early).toEqual([]);

  const written = keepViewChoices([
    {
      id: "0a1b2c3d-0000-4000-8000-0000000000f0",
      key: VIEW_CHOICE_KEY.MANAGER_SORT,
      workspaceId: WORKSPACE_ID,
      value: MANAGER_SORT.RECENT_ACTIVITY,
    },
  ]);

  await settleQueries();
  expect(written.map(({ value }) => value)).toEqual([MANAGER_SORT.NAME]);
  expect(sort().value).toBe(MANAGER_SORT.NAME);
});
