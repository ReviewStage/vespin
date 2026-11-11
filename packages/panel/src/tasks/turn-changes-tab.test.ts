// @vitest-environment jsdom

/**
 * turn-changes-tab.test.ts -- a turn's Changes tab reads the turn's files on the agent's machine and hands the diff bundle every file as one list, stands on the file a press asked for, and says by name why there are none: the snapshot gone, or the agent's Mac away, with Retry.
 */

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, type AgentTurnChangesAnswerView } from "@repo/features/agent-view";
import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  LOCAL_AGENT_REFUSAL,
} from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import type { DiffListProps, DiffViewModule } from "../diff-view/contract.js";
import type { FileTreeModule } from "../file-tree/contract.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeAppBridge,
} from "../testing/app-bridge.js";
import { handSettings } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { TurnChangesTab } from "./agent-changes-tab.js";

const AGENT = "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c";
const LINE = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER_LINE = "2c1d4c7a-9a55-4e3b-8f1d-2a107b0f5f3e";

const TILE: AgentChangedFile = {
  path: "src/tile.css",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 1,
  omitted: null,
  patch: "@@ -1,2 +1,3 @@\n .tile {}\n-  color: red;\n+  color: blue;\n+  margin: 0;",
};

/** How the service answers the turn's changes this test. */
let answer: AgentTurnChangesAnswerView = { files: [TILE], truncated: false };
/** How many times the changes were asked. */
let asked = 0;

/** What the stand-in diff bundle was handed, mount first, each draw after it. */
let drawn: DiffListProps[] = [];
/** The files the list was told to stand on, in order. */
let revealed: string[] = [];
let root: Root | undefined;

const diffStandIn: DiffViewModule = {
  mount: () => ({ update: () => undefined, unmount: () => undefined }),
  mountFile: () => ({
    update: () => undefined,
    revealLines: () => undefined,
    pickedLines: () => undefined,
    unmount: () => undefined,
  }),
  mountList: (_host, props) => {
    drawn.push(props);
    return {
      update: (next) => drawn.push(next),
      reveal: (path) => revealed.push(path),
      revealLine: () => undefined,
      revealLines: () => undefined,
      unmount: () => undefined,
    };
  },
};

const treeStandIn: FileTreeModule = {
  mount: () => {
    const nothing = () => undefined;
    return {
      reveal: nothing,
      search: nothing,
      only: nothing,
      within: nothing,
      relist: nothing,
      mark: nothing,
      unmount: nothing,
    };
  },
  fileIcon: () => ({ symbol: "", type: "" }),
};

let bundles: SideBundles;

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({
      diffView: () => Promise.resolve(diffStandIn),
      fileTree: () => Promise.resolve(treeStandIn),
    }),
  );
});

beforeEach(() => {
  drawn = [];
  revealed = [];
  asked = 0;
  answer = { files: [TILE], truncated: false };
  fakeAppBridge({});
  handSettings();
  fakeActs({
    act: (request: AnyAct) => {
      if (request.kind === ACT_KIND.AGENTS_TURN_CHANGES) asked += 1;
      const outcome: FakeActAnswer = {
        status: FAKE_ANSWER.DONE,
        value: request.kind === ACT_KIND.AGENTS_TURN_CHANGES ? answer : undefined,
      };
      return Promise.resolve(outcome);
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Draws the turn's tab, its read landed, and answers the words it shows. */
async function drawnTab(
  fileReveal?: { path: string; ask: number },
  messageId = LINE,
): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root?.render(
      withQueryClient(
        onSideBundles(
          bundles,
          createElement(TurnChangesTab, {
            agentId: AGENT,
            messageId,
            shown: true,
            tree: { open: false, onToggle: () => undefined },
            fileReveal,
          }),
        ),
      ),
    ),
  );
  await vi.waitFor(() => assert.equal(asked, 1));
  // The answer lands through a query, so the view is read once its spinner has gone.
  await vi.waitFor(() =>
    assert.notEqual(container.textContent?.includes("Reading the turn's changes"), true),
  );
  await flush();
  return container;
}

test("the turn's files are handed to the diff list, each with its patch, and the file a press asked for is stood on", async () => {
  await drawnTab({ path: TILE.path, ask: 1 });

  const list = drawn.at(-1) ?? assert.fail("the files are drawn");
  assert.deepEqual(
    list.files.map((file) => [file.path, file.patch.includes("+  color: blue;")]),
    [["src/tile.css", true]],
  );
  assert.deepEqual(revealed, ["src/tile.css"]);
});

test("a turn whose snapshot is gone says its changes are no longer available, and one on a Mac away says so by the Mac's name with Retry", async () => {
  answer = { failure: AGENT_CALL_FAILURE.CHECKOUT_SNAPSHOT_MISSING };
  const gone = await drawnTab();
  assert.ok(
    gone.textContent?.includes("These changes are no longer available."),
    gone.textContent ?? "",
  );
  assert.equal(drawn.length, 0, "no list is drawn for a turn with nothing to show");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  answer = {
    failure: AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED,
    localAgentRefusal: LOCAL_AGENT_REFUSAL.MAC_AWAY,
    refusedDevice: { name: "Studio" },
  };
  // Another turn's tab, since the first's answer stands in the query's cache.
  asked = 0;
  const away = await drawnTab(undefined, OTHER_LINE);
  assert.ok(away.textContent?.includes("Studio is offline"), away.textContent ?? "");
  const retry = [...away.querySelectorAll("button")].find((each) =>
    each.textContent?.includes("Retry"),
  );
  assert.ok(retry, "the read can be asked again");
  answer = { files: [TILE], truncated: false };
  await act(async () => retry.click());
  await vi.waitFor(() => assert.equal(asked, 2));
  // The files land through the query, a few ticks after the Mac answers.
  await vi.waitFor(() =>
    assert.equal(drawn.at(-1)?.files.length, 1, "the files stand once the Mac answers"),
  );
});
