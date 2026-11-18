// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { WorkspaceSandboxSetupAnswer } from "@repo/features/workspace-sandbox-setup-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { settingsView } from "@repo/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handState, signedInAs } from "../testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import { CloudSetupSections } from "./cloud-setup-sections.js";

/**
 * cloud-setup-sections.test.ts -- Settings › Cloud environment's scripts: a
 * saved setup script emptied in its editor is deleted, its Save standing as
 * Delete script and asking first, rather than refusing to save; and a run
 * action's change is drawn while its save is out. Synthetic names.
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

const REPOSITORY = "acme/api";

const SAVED: WorkspaceSandboxSetupAnswer = {
  install: null,
  setups: [{ repository: REPOSITORY, script: "pnpm install", updatedAt: 1 }],
  archives: [],
};

const NONE: WorkspaceSandboxSetupAnswer = { install: null, setups: [], archives: [] };

/** The setup with one run action of the repository's, not its default. */
const WITH_ACTION: WorkspaceSandboxSetupAnswer = {
  ...NONE,
  runActions: [
    {
      repository: REPOSITORY,
      actions: [{ id: "action-dev", label: "Dev", command: "pnpm dev" }],
      updatedAt: 1,
    },
  ],
};

/** Lets a read's or a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The button among `within`'s that reads `words`, or is labeled so. */
function button(within: ParentNode, words: string): HTMLButtonElement {
  return (
    [...within.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === words || each.getAttribute("aria-label") === words,
    ) ?? assert.fail(`no ${words}`)
  );
}

/** Draws the sections for Dana, an owner of the workspace, its Run actions shown. */
async function drawSections(): Promise<void> {
  handState(
    {},
    { account: signedInAs({ id: "user-dana", email: "dana@app.test", name: "Dana" }).account },
  );
  await writeHandedAppState();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);

  const view = {
    settings: settingsView(),
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
    workspace: WORKSPACE,
  };

  act(() =>
    root.render(withQueryClient(createElement(CloudSetupSections, { workspace: WORKSPACE, view }))),
  );
  await settle();
}

/** Whether a Default badge stands anywhere on the page. */
function defaultDrawn(): boolean {
  return [...document.querySelectorAll("span")].some((each) => each.textContent === "Default");
}

test("a saved setup script emptied is deleted from its row's Delete script, after asking", async () => {
  const sent: unknown[] = [];

  fakeActPort({
    [ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]: () => Promise.resolve(SAVED),
    [ACT_KIND.WORKSPACE_REPOSITORY_SETUP_PUT]: (put) => {
      sent.push(put);

      return Promise.resolve(NONE);
    },
  });

  handState(
    {},
    { account: signedInAs({ id: "user-dana", email: "dana@app.test", name: "Dana" }).account },
  );
  await writeHandedAppState();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(createElement(CloudSetupSections, { workspace: WORKSPACE, view: undefined })),
    ),
  );
  await settle();

  const editor =
    document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${REPOSITORY}"]`) ??
    assert.fail("no editor");

  // Note that whitespace alone is as empty as nothing, since nothing in it runs.
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      editor,
      " \n",
    );
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button(document, "Delete script").click());
  await settle();
  assert.deepEqual(sent, [], "nothing is deleted before the question is answered");

  const question = document.querySelector('[role="alertdialog"]') ?? assert.fail("no question");
  act(() => button(question, "Delete script").click());
  await settle();

  assert.deepEqual(sent, [{ workspaceId: WORKSPACE.id, repository: REPOSITORY, script: "" }]);
  assert.equal(document.querySelector(`textarea[aria-label="${REPOSITORY}"]`), null);
});

test("a run action made the default is drawn as it while its save is out", async () => {
  const held: ((answer: WorkspaceSandboxSetupAnswer) => void)[] = [];

  fakeActPort({
    [ACT_KIND.WORKSPACE_SANDBOX_SETUP_READ]: () => Promise.resolve(WITH_ACTION),
    [ACT_KIND.WORKSPACE_RUN_ACTIONS_PUT]: () =>
      new Promise<WorkspaceSandboxSetupAnswer>((answer) => held.push(answer)),
  });

  await drawSections();
  assert.equal(defaultDrawn(), false);

  act(() => button(document, "Dev actions").click());
  await settle();

  const item =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Make default",
    ) ?? assert.fail("no Make default");

  act(() => item.click());
  await settle();
  assert.equal(held.length, 1, "the save is out");
  assert.equal(defaultDrawn(), true);
});
