// @vitest-environment jsdom

import assert from "node:assert/strict";
import type {
  AllowedCommandsWriteAnswerView,
  AllowedCommandWriteParams,
} from "@repo/features/agent-view";
import type { AllowedCommand } from "@repo/features/allowed-command-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState, signedInAs, stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState, writeHandedAppState } from "../testing/copy-feedback.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { AlwaysAllowedSection } from "./always-allowed-section.js";

/**
 * always-allowed-section.test.ts -- Settings › Agents' Always allowed: Add
 * sends a typed command's first words, a trailing `*` dropped, and refuses
 * shell syntax under the field without sending it; and Remove takes a
 * command off at once, its toast's Undo adding it again. Synthetic ids.
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

const ACCOUNT_ID = "user-dana";

const ACCOUNT = signedInAs({ id: ACCOUNT_ID, email: "dana@app.test", name: "Dana" }).account;

const GIT_STATUS: AllowedCommand = {
  id: "3c1f6a2e-8b4d-4e7a-9c5b-1d2e3f4a5b6c",
  prefix: ["git", "status"],
  agentId: null,
  addedAt: Date.parse("2026-11-01T10:00:00Z"),
};

/** The document with `commands` held for the account, as the host lays a read's or a write's answer. */
function documentHolding(commands: readonly AllowedCommand[]) {
  return stateWith({}, { account: ACCOUNT, [LIVE_READ.ALLOWED_COMMANDS]: held(commands) });
}

/** The commands as the host holds them for the account. */
function held(commands: readonly AllowedCommand[]) {
  return { [ACCOUNT_ID]: { rows: { commands } } };
}

/** Lets the window's document and a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/**
 * Answers the section's writes as the service and the host do: the list
 * after each, laid on the document. Answers every write it was sent.
 */
function serveWrites(start: readonly AllowedCommand[]): AllowedCommandWriteParams[] {
  let commands = start;
  const sent: AllowedCommandWriteParams[] = [];
  fakeActPort({
    [ACT_KIND.ALLOWED_COMMANDS_WRITE]: (write) => {
      sent.push(write);
      commands =
        "add" in write
          ? [
              ...commands,
              { ...GIT_STATUS, id: crypto.randomUUID(), prefix: write.add, addedAt: Date.now() },
            ]
          : commands.filter((each) => each.prefix.join(" ") !== write.remove.join(" "));
      writeAppState(documentHolding(commands));
      const answer: AllowedCommandsWriteAnswerView = { commands };
      return Promise.resolve(answer);
    },
  });
  return sent;
}

/** Draws the section with the window's toasts beside it. */
async function mount(commands: readonly AllowedCommand[]): Promise<void> {
  handState({}, { account: ACCOUNT, [LIVE_READ.ALLOWED_COMMANDS]: held(commands) });
  await writeHandedAppState();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(
          Fragment,
          null,
          createElement(AlwaysAllowedSection),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  await settle();
}

/** Types `words` into the field and presses Enter. */
async function typeAndEnter(words: string): Promise<void> {
  const field =
    document.querySelector<HTMLInputElement>('input[aria-label="Add a command"]') ??
    assert.fail("no field");
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

/** The commands the section lists, as they read. */
function listed(): string[] {
  return [...document.querySelectorAll('.menu-row [data-font="mono"]')].map(
    (each) => each.textContent ?? "",
  );
}

test("Add sends a typed command's first words, its trailing * dropped, and refuses shell syntax unsent", async () => {
  const sent = serveWrites([]);
  await mount([]);

  await typeAndEnter("pnpm lint | tee out");
  assert.deepEqual(sent, [], "shell syntax is not sent");
  assert.match(document.body.textContent ?? "", /no quotes, pipes, globs, or other shell syntax/u);

  await typeAndEnter("  pnpm   lint *");
  assert.deepEqual(sent, [{ add: ["pnpm", "lint"] }]);
  assert.deepEqual(listed(), ["pnpm lint *"]);
});

test("Remove takes a command off at once, and its toast's Undo adds it again", async () => {
  const sent = serveWrites([GIT_STATUS]);
  await mount([GIT_STATUS]);
  const ellipsis =
    document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("no ⋯");
  act(() => ellipsis.click());
  const remove =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Remove",
    ) ?? assert.fail("no Remove");
  act(() => remove.click());
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing is asked");
  assert.deepEqual(listed(), []);
  assert.equal(newestToastSays()?.includes("Removed git status *"), true);

  // Note that the Undo runs through the undo stack, after every run before it, so it lands a turn later.
  await act(async () => newestToastAction()?.click());
  await settle();

  assert.deepEqual(sent, [{ remove: ["git", "status"] }, { add: ["git", "status"] }]);
  assert.deepEqual(listed(), ["git status *"]);
});

test("a removal that never reaches the host leaves the command standing and says so", async () => {
  fakeActPort({
    [ACT_KIND.ALLOWED_COMMANDS_WRITE]: () => Promise.reject(new Error("the port closed")),
  });
  await mount([GIT_STATUS]);
  const ellipsis =
    document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("no ⋯");
  act(() => ellipsis.click());
  const remove =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Remove",
    ) ?? assert.fail("no Remove");
  act(() => remove.click());
  await settle();

  assert.deepEqual(listed(), ["git status *"]);
  assert.equal(newestToastSays()?.includes("Couldn't change your always-allowed commands"), true);
});
