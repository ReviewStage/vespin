// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { GitHubConnection } from "@repo/features/github-connection-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE } from "@repo/host/app-state";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { GitHubConnectControl } from "./github-connect.js";
import { loadTasksFixture } from "./tasks/tasks-fixture-loader.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";
import { handState, stateWith } from "./testing/app-state.js";
import { withQueryClient, writeHandedAppState } from "./testing/copy-feedback.js";
import { newestToastSays } from "./testing/toast.js";
import { ToastHost } from "./toast.js";
import { useAccountGitHub } from "./use-account-github.js";

/**
 * use-account-github.test.ts -- Settings' GitHub row reads the connection on
 * the task list the window lists from, a fixture run's synthetic one in a
 * fixture run; its Connect and Disconnect ask main, a refusal saying why in
 * a toast, and a fixture run asks main nothing.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const REFUSAL = "Could not disconnect GitHub on this system.";

/** Every GitHub act main was asked, in order. */
let asked: string[] = [];
let control: GitHubConnectControl | undefined;
let root: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  fakeActPort({
    [ACT_KIND.GITHUB_CONNECT]: () => {
      asked.push(ACT_KIND.GITHUB_CONNECT);

      return Promise.resolve(undefined);
    },
    [ACT_KIND.GITHUB_DISCONNECT]: () => {
      asked.push(ACT_KIND.GITHUB_DISCONNECT);

      return Promise.reject(refusedOnPort(REFUSAL));
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  control = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

function Probe(): null {
  control = useAccountGitHub();

  return null;
}

/** Draws the hook beside the window's toast over main's document, its task list's GitHub as given. */
async function mount(github: GitHubConnection, fixtureMode = false): Promise<GitHubConnectControl> {
  const run = stateWith({}, {}).run;
  handState(
    {},
    {
      tasks: { ...IDLE_TASKS_VIEW, github },
      run: { ...run, fixtureMode, profile: RUN_PROFILE.IDLE },
    },
  );
  await writeHandedAppState();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => {
    root?.render(
      withQueryClient(
        createElement(Fragment, null, createElement(Probe), createElement(ToastHost)),
      ),
    );
  });
  await settle();

  return control ?? assert.fail("the hook stands");
}

test("the row is main's connection, Connect and Disconnect ask main, and a refused Disconnect says why", async () => {
  const github = await mount({ connected: true, login: "ada" });

  const answers = await act(() => Promise.all([github.connect(), github.disconnect()]));

  assert.deepEqual(github.connection, { connected: true, login: "ada" });
  assert.deepEqual(answers, [true, false]);
  assert.deepEqual(asked, [ACT_KIND.GITHUB_CONNECT, ACT_KIND.GITHUB_DISCONNECT]);
  assert.equal(newestToastSays(), REFUSAL);
});

test("a fixture run shows the fixture's connection and asks main nothing", async () => {
  await loadTasksFixture();
  const github = await mount({ connected: false, login: null }, true);

  const answers = await act(() => Promise.all([github.connect(), github.disconnect()]));

  assert.deepEqual(github.connection, { connected: true, login: null });
  assert.deepEqual(answers, [false, false]);
  assert.deepEqual(asked, []);
});
