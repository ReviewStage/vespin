// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { ComputerUsePermissionRows } from "./computer-use-section.js";

/**
 * computer-use-section.test.ts -- This Mac's computer use says which of
 * macOS's two grants stand, offers Allow, which asks macOS, for the one that
 * does not, and says why where that ask never reached macOS.
 */

let sent: AnyAct[] = [];
const roots: Root[] = [];

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

beforeEach(() => {
  sent = [];
  fakeActs({
    act: (request) => {
      sent.push(request);

      if (request.kind === ACT_KIND.COMPUTER_USE_STATUS) {
        return Promise.resolve(
          done({
            permissions: { screenRecording: true, accessibility: false },
            apps: [],
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
  act(() => root.render(withQueryClient(createElement(ComputerUsePermissionRows))));
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

test("an Allow… that did not reach macOS says why under the grant it was for", async () => {
  const answering = fakeActsAnswer();
  fakeActs({
    act: (request) =>
      request.kind === ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS
        ? Promise.resolve({
            status: FAKE_ANSWER.REFUSED,
            reason: "The helper could not be started.",
          })
        : answering(request),
  });
  const page = await mount();

  await vi.waitFor(() => assert.ok(page.textContent?.includes("Allow…")));
  act(() => button("Allow…").click());

  await vi.waitFor(() => assert.ok(page.textContent?.includes("The helper could not be started.")));
});
