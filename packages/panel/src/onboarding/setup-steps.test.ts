// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_ACT_KIND, WORKSPACE_ACT_KIND } from "@repo/host/contract";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { stateWith } from "../testing/app-state.js";
import { withQueryClient, writeAppState } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SetupSteps } from "./setup-steps.js";

/**
 * Setup's Welcome as the developer walks back to it: a team's workspace
 * made and then left for Just me lists the account's own workspace again,
 * so GitHub is not installed on the team's, and keeps it until setup
 * finishes as Just me, which deletes it while nobody else joined it, as the
 * service checks, and asks first where someone did, offering to keep it.
 * And its survey, kept on the
 * account once for each set of answers setup goes on with. Synthetic
 * throughout.
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

/** The fake act port answering a workspace's delete, each payload pushed to `deleted`, and keeping setup's place as `place`. */
function answeringDeletes(place: string, deleted: unknown[]): void {
  fakeActPort({
    [WORKSPACE_ACT_KIND.WORKSPACE_DELETE]: (payload) => {
      deleted.push(payload);
      return Promise.resolve();
    },
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: () => {
      const settings = appSettingsWire(settingsView({ setupPlace: place }));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED, settings });
    },
  });
}

/** Setup drawn for the account, with its own workspace and Paperstar listed, each workspace chosen pushed to `chosen` and each finish counted in `finished`. */
function setupDrawn(
  chosen: string[] = [],
  finished: { count: number } = { count: 0 },
): HTMLElement {
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
          onFinish: () => {
            finished.count += 1;
          },
        }),
      ),
    ),
  );
  return container;
}

/** Setup standing at its last step for the account alone, after Paperstar was made and left, which Grace Hopper joined. */
function finishingWithGraceJoined(deleted: unknown[]): { count: number } {
  const place = JSON.stringify({ audience: "me", at: 4, team: PAPERSTAR.id });
  const members = {
    [PAPERSTAR.id]: {
      rows: {
        members: [
          { userId: ACCOUNT, name: "Dana", email: "dana@app.test", role: WORKSPACE_ROLE.OWNER },
          {
            userId: "account-grace",
            name: "Grace Hopper",
            email: "grace@app.test",
            role: WORKSPACE_ROLE.MEMBER,
          },
        ],
      },
    },
  };
  writeAppState(
    stateWith(
      {},
      {
        settings: appSettingsWire(settingsView({ setupPlace: place })),
        [LIVE_READ.WORKSPACE_MEMBERS]: members,
      },
    ),
  );
  answeringDeletes(place, deleted);
  const finished = { count: 0 };
  setupDrawn([], finished);
  return finished;
}

test("Just me after a team's workspace was made lists the account's own workspace again and keeps the team's", async () => {
  // Setup stands at Welcome, for the team, whose workspace was made before Back, as the account keeps it.
  const place = JSON.stringify({ audience: "team", at: 0, team: PAPERSTAR.id });
  writeAppState(stateWith({}, { settings: appSettingsWire(settingsView({ setupPlace: place })) }));
  const deleted: unknown[] = [];
  answeringDeletes(place, deleted);
  const chosen: string[] = [];
  const container = setupDrawn(chosen);

  act(() => buttonStarting(container, "Just me").click());
  await act(() => Promise.resolve());

  assert.deepEqual(chosen, [OWN.id]);
  // Note that the team's workspace stands until setup finishes as Just me, so With my team chosen again finds it as made.
  assert.deepEqual(deleted, []);
});

test("setup finished as Just me deletes the team's workspace it made while nobody joined it", async () => {
  // Setup stands at its last step, for the account alone, after a team's workspace was made and left.
  const place = JSON.stringify({ audience: "me", at: 4, team: PAPERSTAR.id });
  writeAppState(stateWith({}, { settings: appSettingsWire(settingsView({ setupPlace: place })) }));
  const deleted: unknown[] = [];
  answeringDeletes(place, deleted);
  const container = setupDrawn();

  act(() => buttonStarting(container, "Finish").click());

  // The service refuses the delete once anyone else is a member, so a workspace someone joined stays.
  await vi.waitFor(() => assert.deepEqual(deleted, [{ workspaceId: PAPERSTAR.id, ifAlone: true }]));
});

test("Finish as Just me asks before deleting a team's workspace someone joined, and Delete and finish deletes it for them too", async () => {
  const deleted: unknown[] = [];
  const finished = finishingWithGraceJoined(deleted);
  // Note that the members arrive a tick after setup draws, as a live read's first answer does.
  await act(() => Promise.resolve());

  act(() => buttonStarting(document.body, "Finish").click());
  await vi.waitFor(() => assert.match(document.body.textContent ?? "", /Grace Hopper joined it\./));
  assert.deepEqual(deleted, [], "nothing is deleted before the answer");
  act(() => buttonStarting(document.body, "Delete and finish").click());

  await vi.waitFor(() => assert.equal(finished.count, 1));
  assert.deepEqual(deleted, [{ workspaceId: PAPERSTAR.id }]);
});

test("Keep it and finish finishes setup and leaves the team's workspace someone joined", async () => {
  const deleted: unknown[] = [];
  const finished = finishingWithGraceJoined(deleted);
  await act(() => Promise.resolve());

  act(() => buttonStarting(document.body, "Finish").click());
  await vi.waitFor(() => buttonStarting(document.body, "Keep it and finish"));
  act(() => buttonStarting(document.body, "Keep it and finish").click());
  await act(() => Promise.resolve());

  assert.equal(finished.count, 1);
  assert.deepEqual(deleted, []);
});

test("the survey keeps its answers on the account, Other's words among them, and again after a refusal", async () => {
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
  act(() => buttonStarting(container, "Founder").click());
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
});
