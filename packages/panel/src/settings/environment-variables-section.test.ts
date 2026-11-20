// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { EnvironmentVariablesSection } from "./environment-variables-section.js";

/**
 * environment-variables-section.test.ts -- Settings › Cloud environment's
 * Add variables opens with the caret in its first Name, so a name is typed
 * at once. Synthetic names.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const WORKSPACE = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };

/** Lets a read's or a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

test("Add variables opens with focus in its first Name", async () => {
  fakeActPort({
    [ACT_KIND.WORKSPACE_ENVIRONMENT_LIST]: () => Promise.resolve({ variables: [] }),
  });

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(EnvironmentVariablesSection, { workspace: WORKSPACE, readerId: "user-dana" }),
      ),
    ),
  );
  await settle();

  const add =
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === "Add variables",
    ) ?? assert.fail("no Add variables");

  act(() => add.click());
  await settle();

  const name =
    document.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder="NAME"]') ??
    assert.fail("no Name");

  assert.equal(document.activeElement === name, true);
});
