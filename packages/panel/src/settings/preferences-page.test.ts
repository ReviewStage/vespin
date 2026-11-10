// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { LINK_OPEN } from "@repo/features/link-open";
import type { Workspace } from "@repo/features/workspace-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppWorkspaceIntegrations } from "@repo/host/app-state";
import { SETTINGS_ACT_KIND } from "@repo/host/contract";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { NOTIFICATIONS_STATUS } from "@repo/settings/settings-controls";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import { UPDATE_STATUS } from "@repo/settings/update";
import { appSettingsView } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, quietHold } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handHostReads } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel.js";

/**
 * Settings › Preferences as the panel draws it: where the account's app
 * links open, a pop-up naming the browser until the account chooses, whose
 * choice is written as the setting, and nothing of it while signed out,
 * since the choice is the account's; and the reader's Slack notifications,
 * which stand only once a workspace of theirs has the Slack bot connected.
 */

const ignore = () => undefined;

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dev@example.com",
  name: "Dev",
  provider: "github",
};

/** The settings a store sends that never held a link choice, drawn as the window draws them. */
function neverChosen() {
  const { stored, ...rest } = appSettingsWire(settingsView());
  const { linkOpen: _never, ...held } = stored;
  return appSettingsView({ ...rest, stored: held });
}

/** Settings on the Preferences page for the account given, every press but a setting's write ignored. */
function settingsOn(account: AccountSnapshot): SettingsPanelProps {
  return {
    account,
    onSignOut: () => Promise.resolve(),
    view: SETTINGS_VIEW.PREFERENCES,
    onViewChange: ignore,
    microphone: {
      status: MICROPHONE_STATUS.GRANTED,
      onRequest: ignore,
      onOpenSettings: ignore,
    },
    notifications: {
      status: NOTIFICATIONS_STATUS.UNKNOWN,
      packaged: true,
      onOpenSettings: ignore,
    },
    capabilities: DESKTOP_CAPABILITIES,
    updates: {
      update: {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: false,
      },
      build: { packaged: true },
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onMoveToApplications: ignore,
      onOpenLatest: ignore,
    },
    settings: neverChosen(),
  };
}

const roots: Root[] = [];

/** Each setting written through the bridge, as its act carried it. */
let written: unknown[] = [];

/** The reader's two workspaces, the first their own. */
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Dev",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** Each workspace's integrations as the host lays them once held: Slack connected in those named, and offered but not connected elsewhere. */
function integrationsWith(connected: readonly string[]): AppWorkspaceIntegrations {
  return Object.fromEntries(
    [PERSONAL, ACME].map(({ id }) => [
      id,
      {
        rows: {
          sentry: { configured: false, installations: [] },
          slack: {
            configured: true,
            ...(connected.includes(id) ? { team: { id: "T0001", name: "Acme Slack" } } : undefined),
            channelRepositories: {},
          },
        },
      },
    ]),
  );
}

/** Draws Settings on the Preferences page, over the reader's workspaces, and answers the container. */
function draw(account: AccountSnapshot): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const workspace = {
    workspaces: [PERSONAL, ACME],
    workspaceId: PERSONAL.id,
    onLeft: ignore,
    listFailed: false,
    onRetryList: ignore,
  };
  act(() =>
    root.render(
      withQueryClient(createElement(SettingsPanel, { ...settingsOn(account), workspace })),
    ),
  );
  return container;
}

/** The workspaces whose Slack bot the host reads connected, laid as each is held. */
let slackConnected: readonly string[] = [];

/** How the host's reads are laid on the window again. */
let reads: ReturnType<typeof handHostReads>;

beforeEach(() => {
  written = [];
  slackConnected = [];
  fakeActPort({
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: (payload) => {
      written.push(payload);
      const settings = appSettingsWire(settingsView({ linkOpen: LINK_OPEN.MAC_APP }));
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED, settings });
    },
    // Note that the host lays what it read once the hold is taken, never inside it.
    [ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW]: () => {
      void Promise.resolve().then(() =>
        reads.deliverIntegrations(integrationsWith(slackConnected)),
      );
      return quietHold();
    },
    [ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS]: (payload) => {
      written.push(payload);
      return Promise.resolve({ configured: true, notifications: payload.notifications });
    },
  });
  reads = handHostReads({
    preferences: {
      rows: {
        agent: undefined,
        chaptersModel: CHAPTERS_MODEL.HAIKU,
        slackNotifications: true,
        sounds: { list: [], choices: { finish: undefined, ask: undefined } },
      },
    },
  });
});

afterEach(() => {
  for (const each of roots.splice(0)) act(() => each.unmount());
  document.body.innerHTML = "";
});

test("Preferences asks where Vespin links open, the browser until chosen, and a choice writes the setting", async () => {
  const page = draw(SIGNED_IN);
  const choice =
    page.querySelector<HTMLButtonElement>('button[aria-label="Open Vespin links in: Browser"]') ??
    assert.fail("the row is drawn, naming the browser");

  act(() => choice.click());
  const app =
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent === "Vespin for Mac",
    ) ?? assert.fail("the menu offers Vespin for Mac");
  act(() => app.click());
  await act(async () => undefined);

  assert.deepEqual(written, [{ field: "linkOpen", value: LINK_OPEN.MAC_APP }]);
});

test("signed out, Preferences asks nothing about links", () => {
  const page = draw({ status: ACCOUNT_STATUS.SIGNED_OUT });
  assert.equal(page.querySelector('button[aria-label^="Open Vespin links in"]'), null);
});

test("Slack notifications stand under Notifications only once a workspace has the Slack bot connected, and turning them off names that workspace", async () => {
  const unconnected = draw(SIGNED_IN);
  await act(async () => undefined);
  assert.equal(unconnected.textContent?.includes("Slack notifications"), false);
  for (const each of roots.splice(0)) act(() => each.unmount());

  slackConnected = [ACME.id];
  const page = draw(SIGNED_IN);
  const slack = await vi.waitFor(
    () =>
      page.querySelector<HTMLElement>('[role="switch"][aria-label="Slack notifications"]') ??
      assert.fail("the switch is drawn"),
  );
  act(() => slack.click());
  await act(async () => undefined);

  assert.deepEqual(written, [{ workspaceId: ACME.id, notifications: false }]);
});
