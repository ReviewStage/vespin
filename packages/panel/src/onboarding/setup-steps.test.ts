// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PRODUCT_SURFACE_EVENT } from "@repo/features/analytics";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_ACT_KIND } from "@repo/host/contract";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SetupSteps } from "./setup-steps.js";

/**
 * Setup's Welcome as the developer walks back to it: a team's workspace
 * made and then left for Just me lists the account's own workspace again,
 * so GitHub is not installed on the team's. And its survey, kept on the
 * account and counted once for each set of answers setup goes on with.
 * Synthetic throughout.
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

/** Types `words` into `input` as a reader does, through the prototype's setter, which React reads a change by. */
function typeInto(input: HTMLInputElement | null, words: string): void {
  assert.ok(input, "the field is drawn");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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

test("the survey keeps its answers on the account, again after a refusal, and counts them once, Other's words kept and never counted", async () => {
  // Setup stands at the survey, for the account alone, as the account keeps it.
  const place = JSON.stringify({ audience: "me", at: 1 });
  writeAppState(stateWith({}, { settings: appSettingsWire(settingsView({ setupPlace: place })) }));
  const kept: unknown[] = [];
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: ({ field, value }) => {
      if (field === "onboardingSurvey") {
        kept.push(JSON.parse(String(value)));
        // The account refuses the first keep, as a write lost to an outage is.
        if (kept.length === 1) return Promise.reject(refusedOnPort("Not saved."));
      }
      const settings = appSettingsWire(settingsView({ setupPlace: place }));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED, settings });
    },
  });
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

  act(() => buttonStarting(container, "Other").click());
  typeInto(container.querySelector<HTMLInputElement>('input[aria-label$="Other"]'), "  A meetup ");
  act(() => buttonStarting(container, "Founder or CTO").click());
  // Note that the account's place comes back from no write here, so Continue leaves setup at the survey to be pressed again.
  const answers = { referral: "other", referralOther: "A meetup", role: "founder" };
  act(() => buttonStarting(container, "Continue").click());
  // Note that the write reaches the act port a tick after the press, and its refusal a tick after that, as a mutation's do.
  await vi.waitFor(() => assert.deepEqual(kept, [answers]));
  await act(() => Promise.resolve());
  act(() => buttonStarting(container, "Continue").click());
  await vi.waitFor(() => assert.deepEqual(kept, [answers, answers]));
  await act(() => Promise.resolve());
  act(() => buttonStarting(container, "Continue").click());
  await act(() => Promise.resolve());

  assert.deepEqual(kept, [answers, answers], "answers kept are not kept again");
  assert.deepEqual(counted, [
    {
      name: PRODUCT_SURFACE_EVENT.ONBOARDING_SURVEY,
      properties: { referral_source: "other", role: "founder", signup_intent: "skipped" },
    },
  ]);
});
