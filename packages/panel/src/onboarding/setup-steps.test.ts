// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PRODUCT_SURFACE_EVENT } from "@repo/features/analytics";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SetupSteps } from "./setup-steps.js";

/**
 * Setup's Welcome as the developer walks back to it: a team's workspace
 * made and then left for Just me lists the account's own workspace again,
 * so GitHub is not installed on the team's. And its survey, counted once
 * for each set of answers setup goes on with. Synthetic throughout.
 */

const ACCOUNT = "account-dana";

const OWN: Workspace = {
  id: "workspace-own",
  name: "Dana",
  slug: "personal-dana",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  personal: true,
};

const PAPERSTAR: Workspace = {
  id: "workspace-paperstar",
  name: "Paperstar",
  slug: "paperstar",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeActPort({});
  fakeAppPlatform(QUIET_PANEL);
});

/** The button in `container` whose words start with `words`. */
function buttonStarting(container: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      each.textContent?.startsWith(words),
    ) ?? assert.fail(`no ${words} on ${container.textContent}`)
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

test("Just me after a team's workspace was made lists the account's own workspace again", () => {
  // Setup stands at Welcome, for the team, whose workspace was made before Back, as the account keeps it.
  const place = JSON.stringify({ audience: "team", at: 0, team: PAPERSTAR.id });
  writeAppState(stateWith({}, { settings: appSettingsWire(settingsView({ setupPlace: place })) }));
  const chosen: string[] = [];
  const base = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(SetupSteps, {
          tasks: {
            ...base,
            newTask: { ...base.newTask, workspaces: [OWN, PAPERSTAR] },
            onChooseWorkspace: (workspaceId) => chosen.push(workspaceId),
          },
          accountId: ACCOUNT,
          onFinish: () => undefined,
        }),
      ),
    ),
  );

  act(() => buttonStarting(container, "Just me").click());

  assert.deepEqual(chosen, [OWN.id]);
});

test("the survey counts its answers once as setup goes on, an unanswered question as skipped", () => {
  // Setup stands at the survey, for the account alone, as the account keeps it.
  const place = JSON.stringify({ audience: "me", at: 1 });
  writeAppState(stateWith({}, { settings: appSettingsWire(settingsView({ setupPlace: place })) }));
  const counted: unknown[] = [];
  fakeAppPlatform({
    ...QUIET_PANEL,
    recordSurfaceEvent: (name, properties) => counted.push({ name, properties }),
  });
  const base = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      withQueryClient(
        createElement(SetupSteps, {
          tasks: { ...base, newTask: { ...base.newTask, workspaces: [OWN] } },
          accountId: ACCOUNT,
          onFinish: () => undefined,
        }),
      ),
    ),
  );

  act(() => buttonStarting(container, "Hacker News").click());
  act(() => buttonStarting(container, "Founder or CTO").click());
  // Note that the account's place comes back from no write here, so Continue leaves setup at the survey to be pressed again.
  act(() => buttonStarting(container, "Continue").click());
  act(() => buttonStarting(container, "Continue").click());

  assert.deepEqual(counted, [
    {
      name: PRODUCT_SURFACE_EVENT.ONBOARDING_SURVEY,
      properties: { referral_source: "hacker_news", role: "founder", signup_intent: "skipped" },
    },
  ]);
});
