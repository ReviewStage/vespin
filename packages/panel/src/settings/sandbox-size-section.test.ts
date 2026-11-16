// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { WorkspaceSandboxSizeAnswer } from "@repo/features/workspace-sandbox-size-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState, signedInAs } from "../testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import { SandboxSizeSection } from "./sandbox-size-section.js";

/**
 * sandbox-size-section.test.ts -- Settings › Cloud environment's Sandbox: an
 * owner picks any of the sizes, and a member's size takes no pick at all.
 * Synthetic names.
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

/** The size as the service answers it: two vCPUs, where a workspace starts. */
const SIZE: WorkspaceSandboxSizeAnswer = { vcpus: 2 };

/** Lets a read's or a press's acts land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The section over Acme, the reader holding `role` in it, every choice it sends kept in `sent`. */
async function draw(role: WorkspaceRole, sent: unknown[]): Promise<HTMLButtonElement> {
  fakeActPort({
    [ACT_KIND.WORKSPACE_SANDBOX_SIZE_READ]: () => Promise.resolve(SIZE),
    [ACT_KIND.WORKSPACE_SANDBOX_SIZE_PUT]: (put) => {
      sent.push(put);

      return Promise.resolve({ ...SIZE, vcpus: put.vcpus });
    },
  });

  handState(
    {},
    { account: signedInAs({ id: "user-dana", email: "dana@app.test", name: "Dana" }).account },
  );
  await writeHandedAppState();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const workspace = { id: "workspace-acme", name: "Acme", role, github: null };
  act(() => root.render(withQueryClient(createElement(SandboxSizeSection, { workspace }))));
  await settle();

  return (
    document.querySelector<HTMLButtonElement>('button[aria-label^="Size: "]') ??
    assert.fail("no size chip")
  );
}

/** The menu's row that reads `words` first. */
function option(words: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.startsWith(words),
    ) ?? assert.fail(`no ${words}`)
  );
}

test("an owner picks the largest size, and the section draws it once chosen", async () => {
  const sent: unknown[] = [];
  const chip = await draw(WORKSPACE_ROLE.OWNER, sent);
  assert.equal(chip.getAttribute("aria-label"), "Size: 2 vCPUs · 4 GB");

  act(() => chip.click());
  act(() => option("8 vCPUs · 16 GB").click());
  await settle();
  assert.deepEqual(sent, [{ workspaceId: "workspace-acme", vcpus: 8 }]);
  assert.equal(chip.getAttribute("aria-label"), "Size: 8 vCPUs · 16 GB");
});

test("a member sees the size but opens no menu to change it", async () => {
  const sent: unknown[] = [];
  const chip = await draw(WORKSPACE_ROLE.MEMBER, sent);

  act(() => chip.click());
  assert.equal(document.querySelector('[role="option"]'), null);
  assert.equal(chip.getAttribute("aria-disabled"), "true");
});
