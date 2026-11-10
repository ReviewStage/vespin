// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import { APP_SETTING_SCHEMA, type AppSettingField } from "@repo/settings";
import { settingsView } from "@repo/settings/testing";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { ComputerUseSection } from "./computer-use-section.js";

/**
 * computer-use-section.test.ts -- This Mac's computer use says which of
 * macOS's two grants stand, offers Allow, which asks macOS, for the one that
 * does not, and lists the apps allowed without asking by the names the Mac
 * gave them, each taken off by its Remove.
 *
 * Synthetic apps throughout.
 */

const SIMULATOR = "com.apple.iphonesimulator";
const FIGMA = "com.figma.Desktop";

let sent: AnyAct[] = [];
let written: { field: AppSettingField; value: unknown }[] = [];
const roots: Root[] = [];

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

beforeEach(() => {
  sent = [];
  written = [];
  fakeActs({
    act: (request) => {
      sent.push(request);
      if (request.kind === ACT_KIND.COMPUTER_USE_STATUS) {
        return Promise.resolve(
          done({
            permissions: { screenRecording: true, accessibility: false },
            apps: [
              { bundleId: SIMULATOR, name: "Simulator" },
              { bundleId: FIGMA, name: "Figma" },
            ],
          }),
        );
      }
      if (request.kind === ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS) {
        return Promise.resolve(done({ screenRecording: true, accessibility: true }));
      }
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** The button whose accessible name is `name`, wherever it stands. */
function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find(
      (each) => each.textContent === name || each.getAttribute("aria-label") === name,
    ) ?? assert.fail(`no ${name} button`)
  );
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const settings = {
    ...settingsView(),
    computerUseApps: JSON.stringify([SIMULATOR, FIGMA]),
  };
  const writes = {
    setting: (field: AppSettingField, value: unknown): Promise<ActionResult> => {
      written.push({ field, value });
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    reset: () => Promise.reject(new Error("not reset in these tests")),
  };
  act(() =>
    root.render(
      withQueryClient(
        createElement(ComputerUseSection, {
          view: { settings, accountDrawn: true, capabilities: DESKTOP_CAPABILITIES },
          writes,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

test("a grant that stands says so, the one that does not offers Allow, which asks macOS for it", async () => {
  const page = await mount();
  await vi.waitFor(() => assert.ok(page.textContent?.includes("Allowed")));
  assert.ok(page.textContent?.includes("Not allowed yet, so agents cannot click or type in apps"));

  act(() => button("Allow…").click());

  await vi.waitFor(() =>
    assert.ok(sent.some((request) => request.kind === ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS)),
  );
});

test("the apps allowed without asking stand by the Mac's names for them, and Remove takes one off", async () => {
  const page = await mount();
  await vi.waitFor(() => assert.ok(page.textContent?.includes("Simulator")));
  assert.ok(page.textContent?.includes("Figma"));

  act(() => button("Remove Simulator").click());

  await vi.waitFor(() => assert.equal(written.length, 1));
  assert.deepEqual(written, [
    { field: APP_SETTING_SCHEMA.computerUseApps.field, value: JSON.stringify([FIGMA]) },
  ]);
});
