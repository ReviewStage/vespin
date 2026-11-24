// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  changesTab,
  fileTab,
  pageTab,
  sameTab,
  type TerminalStripTab,
  terminalTab,
  threadTab,
  transcriptTab,
  turnChangesTab,
} from "@repo/ui/tab-strip-model";
import { Predicate } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { onTerminals, windowTerminals } from "../testing/terminals.js";
import { NO_PULL_REQUESTS_KEPT, withPullRequest } from "./by-pull-request.js";
import { SIDE_PANEL_TABS } from "./task-tab-model.js";
import { TERMINAL_KIND } from "./terminal-session.js";
import {
  drawsChanges,
  drawsTerminal,
  type OpenTask,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel.js";
import { WindowAccountContext } from "./window-account.js";

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const OTHER_TASK = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const BARE_TASK = "6c8e0a2b-4d6f-4b8c-8e2a-3c5d7e9f1a2b";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER_AGENT = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** A pull request, by its repository and number. */
const PULL_REQUEST = { repository: "acme/relay", number: 42 } as const;

/** A cloud terminal tab of each agent. */
const CLOUD = terminalTab(AGENT, "2f6e0c1a-5b3d-4c8e-9a1f-7d2b4e6a8c10", "Cloud 1");
const OTHER_CLOUD = terminalTab(OTHER_AGENT, "3a7f1d2b-6c4e-4d9f-8b2a-8e3c5f7b9d21", "Cloud 1");

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** A task that has used every fixed tab. */
function usedTask(id: string): OpenTask {
  return { id, holds: Object.fromEntries(SIDE_PANEL_TABS.map((tab) => [tab, true])) };
}

/** The open task and its agents, every one, or nothing while unread. */
interface Stood {
  task: string;
  taskAgents: readonly string[] | undefined;
  /** Whether the plan holds nothing yet, so its strip draws no tab. */
  bare?: boolean;
  /** The account signed in, none for no account. */
  account?: string;
  /** The agent the task's column shows, whose tabs alone the strip draws. */
  agent?: string;
  /** The Manager on no task whose own page the panel stands beside, at a stop of its own, in the task's place. */
  manager?: string;
}

/** Mounts the panel alone, as a launch does, over the task and agents given, answering the control as it stands. */
function launch(stood: Stood) {
  let control: SidePanelControl | undefined;

  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(
      undefined,
      held.manager !== undefined
        ? { id: undefined, holds: {}, bare: true, stop: held.manager }
        : held.bare === true
          ? { id: held.task, holds: {} }
          : { ...usedTask(held.task), agent: held.agent },
      held.taskAgents,
      [],
      [],
      held.taskAgents,
    );

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const terminals = windowTerminals();
  let account = stood.account;

  const render = (held: Stood) => {
    account = held.account;
    act(() =>
      root.render(
        onTerminals(
          terminals,
          createElement(
            WindowAccountContext.Provider,
            { value: held.account },
            createElement(Probe, { held }),
          ),
        ),
      ),
    );
  };

  render(stood);

  return {
    control: () => {
      assert.ok(control);

      return control;
    },
    /** Opens a Terminal tab as a real open does: its terminal held for the account signed in, then its tab chosen. */
    open: (tab: TerminalStripTab) => {
      act(() =>
        terminals.held.set(account, TERMINAL_KIND.CLOUD, tab.terminal, [
          ...terminals.held.of(account, TERMINAL_KIND.CLOUD, tab.terminal),
          { shell: tab.shell, title: tab.title },
        ]),
      );
      act(() => control?.onChoose(tab));
    },
    render,
    quit: () => {
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}

test("each agent's strip draws its own tabs and the files opened or browsed to under it, and comes back to the tab it was left on", () => {
  const first = { task: TASK, taskAgents: [AGENT, OTHER_AGENT], agent: AGENT };
  const panel = launch(first);
  panel.open(CLOUD);
  act(() => panel.control().onOpenFile({ path: "src/a.ts" }));
  act(() => panel.control().onBrowseFile("src/a.ts", "src/b.ts", false));
  panel.open(CLOUD);

  panel.render({ ...first, agent: OTHER_AGENT });
  assert.deepEqual(panel.control().strip, [], "none of the first agent's tabs");
  panel.open(OTHER_CLOUD);
  assert.deepEqual(panel.control().strip, [OTHER_CLOUD]);

  panel.render(first);
  assert.deepEqual(panel.control().strip, [CLOUD, fileTab("src/b.ts")]);
  assert.deepEqual(panel.control().tab, CLOUD, "the tab it was left on");
});

test("a pull request's tab opens on its plan, stands chosen across a launch, and stands on no other plan", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  assert.deepEqual(
    first.control().changes,
    [changesTab(PULL_REQUEST)],
    "opened once, chosen again",
  );
  assert.deepEqual(first.control().tab, changesTab(PULL_REQUEST));
  first.quit();

  // A launch opens the task on the pull request's tab it was left on, before its agents are read.
  const second = launch({ task: TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, [changesTab(PULL_REQUEST)]);
  assert.deepEqual(second.control().tab, changesTab(PULL_REQUEST));
  second.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().tab, changesTab(PULL_REQUEST));

  // Another task, its agents unread, never draws it, nor shows it chosen.
  second.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, undefined);
});

test("a record keeps each tab without its kind, as a build before tabs carried their kind wrote it, and a launch opens on it, each tab tagged with its kind", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  act(() =>
    first.control().onPin({ task: TASK }, changesTab(PULL_REQUEST), "Changes: Invite flow"),
  );
  first.quit();
  const { tasks, pins, tab } = JSON.parse(window.localStorage.getItem("app.sidePanel") ?? "{}");
  assert.ok(tasks, "the record keeps the task's choices");
  assert.deepEqual(
    [tab, tasks[TASK].changes, pins[0].tab],
    [{ changes: PULL_REQUEST }, [{ changes: PULL_REQUEST }], { changes: PULL_REQUEST }],
    "each tab is kept without its kind",
  );
  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, changesTab(PULL_REQUEST));
  assert.deepEqual(
    second.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [{ task: TASK, tab: changesTab(PULL_REQUEST), label: "Changes: Invite flow" }],
  );
});

test("a Changes tab closed stays closed across a launch, and closing the chosen one chooses the tab viewed before it", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  first.open(CLOUD);
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  act(() => first.control().onClose(changesTab(PULL_REQUEST)));
  assert.deepEqual(first.control().changes, []);
  assert.deepEqual(first.control().tab, CLOUD);
  first.quit();

  // Note that a Terminal tab is kept across no launch, so nothing stands to choose.
  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, undefined);
});

test("an agent's Terminal tab opens once at the strip's end and chosen, stands only on its agent's plan, and is kept across no launch", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  first.open(CLOUD);
  first.open(CLOUD);
  assert.deepEqual(first.control().terminals, [CLOUD], "opened once, chosen again");
  assert.deepEqual(first.control().strip.at(-1), CLOUD);
  assert.deepEqual(first.control().tab, CLOUD);

  // Another task never draws it, its agents read or not.
  first.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.ok(!first.control().strip.some((tab) => tab instanceof Object && "terminal" in tab));
  assert.equal(first.control().tab, undefined);
  first.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(first.control().tab, undefined);

  // Back on its task it stands as it was; closed, no tab stands.
  first.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(first.control().tab, CLOUD);
  act(() => first.control().onClose(CLOUD));
  assert.deepEqual(first.control().terminals, []);
  assert.equal(first.control().tab, undefined);
  first.open(OTHER_CLOUD);
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().terminals, []);
  assert.equal(second.control().tab, undefined);
});

test("another account signing in hides the last one's Terminal tabs, which stand again as they were once it signs in again", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT], account: "ada" });
  act(() => panel.control().onChoose(changesTab(PULL_REQUEST)));
  panel.open(CLOUD);
  panel.render({ task: TASK, taskAgents: [AGENT], account: "grace" });
  const forGrace = panel.control();
  panel.render({ task: TASK, taskAgents: [AGENT], account: "ada" });

  assert.deepEqual(forGrace.terminals, []);
  assert.deepEqual(forGrace.strip, [changesTab(PULL_REQUEST)]);
  assert.deepEqual(forGrace.tab, changesTab(PULL_REQUEST));
  assert.deepEqual(panel.control().terminals, [CLOUD]);
  assert.deepEqual(panel.control().tab, CLOUD);
});

test("a Changes tab pins to the sidebar, keeps its pin across a launch, and takes its pull request's name", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  act(() => first.control().onPin({ task: TASK }, changesTab(PULL_REQUEST), "Pull request"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(
    second.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [{ task: TASK, tab: changesTab(PULL_REQUEST), label: "Pull request" }],
  );
  // The panel's other choices read too, rather than the whole record being dropped.
  assert.deepEqual(second.control().tab, changesTab(PULL_REQUEST));

  act(() => second.control().onRenamePins(TASK, { pullRequests: NO_PULL_REQUESTS_KEPT }));
  assert.equal(second.control().pins[0]?.label, "Pull request", "its pull request unread");

  const pullRequests = withPullRequest(
    NO_PULL_REQUESTS_KEPT,
    { repository: "Acme/Relay", number: 42 },
    "#42 Expire invitations",
  );

  act(() => second.control().onRenamePins(TASK, { pullRequests }));
  assert.equal(second.control().pins[0]?.label, "#42 Expire invitations");

  // Shown from its pin on another task, it opens there, at the end of that task's strip.
  second.render({ task: OTHER_TASK, taskAgents: [OTHER_AGENT] });
  act(() => second.control().onShow(TASK, changesTab(PULL_REQUEST)));
  second.render({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, changesTab(PULL_REQUEST));
  assert.deepEqual(second.control().changes, [changesTab(PULL_REQUEST)]);
});

test("a record an earlier version kept still reads, each Pull request tab and pin it kept by an agent, and each pin on an agent's own page, let go alone and the rest of the record kept", () => {
  const file = "src/invites/accept.ts";
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["comments"],
      width: 480,
      tab: { changes: AGENT },
      tasks: {
        [TASK]: {
          opened: [],
          closed: ["comments"],
          changes: [{ changes: AGENT }, { changes: PULL_REQUEST }],
          order: [{ changes: AGENT, number: 7 }],
        },
      },
      pins: [
        { task: TASK, tab: { changes: OTHER_AGENT }, label: "#42 Invites", at: 1 },
        { task: TASK, tab: { file }, label: "accept.ts", at: 2 },
      ],
      agentPins: [{ agent: AGENT, tab: { changes: AGENT }, label: "#88 Quarantine", at: 3 }],
    }),
  );
  const panel = launch({ task: TASK, taskAgents: [OTHER_AGENT] });
  assert.deepEqual(
    panel.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [{ task: TASK, tab: fileTab(file), label: "accept.ts" }],
  );
  assert.deepEqual(panel.control().changes, [changesTab(PULL_REQUEST)]);
  assert.deepEqual(panel.control().closedTabs, ["comments"]);
  assert.equal(panel.control().width, 480, "the record's width is kept");
});

test("a file's pin opens its tab on the pin's task after a launch, which keeps no file's tab", () => {
  const file = "src/invites/accept.ts";
  const first = launch({ task: TASK, taskAgents: [] });
  act(() => first.control().onOpenFile({ path: file }));
  act(() => first.control().onPin({ task: TASK }, fileTab(file), "accept.ts"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [] });
  act(() => second.control().onShow(TASK, fileTab(file)));
  assert.deepEqual(second.control().tab, fileTab(file));
  assert.deepEqual(second.control().strip.at(-1), fileTab(file));
});

test("a tab pinned to the sidebar keeps the place a drag gave it across a launch, on this Mac", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  act(() =>
    first.control().onPin({ task: TASK }, changesTab(PULL_REQUEST), "Changes: Invite flow"),
  );
  const at = first.control().pins[0]?.at ?? assert.fail("the tab is pinned");
  act(() => first.control().onPlacePins(new Map([[at, "a3"]])));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.equal(second.control().pins[0]?.position, "a3");
});

test("a file named alone, as ⌘K finds it, shows the tab it has as it stands, and another opens in a tab the plan draws", () => {
  const shown = "src/invites/accept.ts";
  const found = "src/invites/expire.ts";
  let control: SidePanelControl | undefined;

  function Probe() {
    control = useSidePanel(undefined, usedTask(TASK), [], [], [], []);

    return null;
  }

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));

  const now = () => {
    assert.ok(control);

    return control;
  };

  act(() => now().onOpenFile({ path: shown, startLine: 3, endLine: 5 }));

  act(() => now().onOpenFile({ path: shown }));
  assert.deepEqual(now().tab, fileTab(shown));
  assert.deepEqual(
    now().files.map(({ path, range }) => ({ path, range })),
    [{ path: shown, range: { startLine: 3, endLine: 5 } }],
    "the tab keeps the lines it had lit",
  );

  act(() => now().onOpenFile({ path: found }));
  assert.deepEqual(now().tab, fileTab(found));
  assert.deepEqual(
    now().files.map(({ path }) => path),
    [shown, found],
  );
});

test("a thread of a Manager's chat stands beside that Manager's page alone, and holds the panel beside the page though full screen is asked for", () => {
  const thread = threadTab("7b2d40e8-1c3e-4f5a-9b7d-2e4f6a8c0e1b", AGENT);
  const panel = launch({ task: TASK, taskAgents: undefined, manager: AGENT });
  act(() => panel.control().onChoose(thread));
  assert.deepEqual([panel.control().open, panel.control().tab], [true, thread]);

  act(() => panel.control().onToggleFullScreen());
  assert.equal(panel.control().fullScreen, false, "a thread never fills the window");

  panel.render({ task: TASK, taskAgents: undefined, manager: OTHER_AGENT });
  assert.ok(
    !panel.control().strip.some((tab) => sameTab(tab, thread)),
    "another Manager's page draws no tab of this one's thread",
  );
});

test("the agent whose Terminal tab was shown last on a plan is the plan's own, which ⌘J goes to among several", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.equal(panel.control().lastTerminal, undefined);
  panel.open(CLOUD);
  panel.open(OTHER_CLOUD);
  act(() => panel.control().onChoose(changesTab(PULL_REQUEST)));
  assert.equal(panel.control().lastTerminal, OTHER_AGENT);
  panel.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(panel.control().lastTerminal, undefined);
});

test('closing the last tab shuts the panel and leaves full screen, and the toggle with nothing to show asks for the "+" at the toggle, a pick opening the panel on it', () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => panel.control().onChoose(changesTab(PULL_REQUEST)));
  act(() => panel.control().onToggleFullScreen());
  assert.equal(panel.control().fullScreen, true);

  act(() => panel.control().onClose(changesTab(PULL_REQUEST)));
  assert.equal(panel.control().open, false);
  assert.equal(panel.control().fullScreen, false);

  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, false, "never shown with nothing in it");
  assert.equal(panel.control().toggleAsked, true, 'the "+" is asked for at the toggle');

  act(() => panel.control().onChoose(changesTab(PULL_REQUEST)));
  assert.equal(panel.control().open, true);
  assert.equal(panel.control().fullScreen, false, "shown again beside the document");
  assert.deepEqual(panel.control().tab, changesTab(PULL_REQUEST));
  assert.equal(panel.control().toggleAsked, false);
});

test("a task opens with the panel shown or shut, and as wide, as it was last left there, a task it was never shown on starting shut whatever its strip holds unless a tab was asked for there, as a pin or a link opens one, and a plan whose strip holds no tab draws none", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT] });
  // Note that the agent works on both tasks, so its Terminal tab stands on each.
  panel.open(CLOUD);
  act(() => panel.control().onResize(520));
  assert.equal(panel.control().open, true);

  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.deepEqual(panel.control().strip, [CLOUD]);
  assert.equal(
    panel.control().open,
    false,
    "another task never shown on starts shut though its strip holds a tab",
  );
  panel.render({ task: TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, true, "coming back opens it as it was left there");

  act(() => panel.control().onShow(OTHER_TASK, CLOUD));
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, true, "a tab asked for on the stop arrived at stands");
  act(() => panel.control().onResize(400));
  panel.render({ task: TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().width, 520, "each task keeps how wide it stood");
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().width, 400);
  act(() => panel.control().onSetOpen(false));
  panel.render({ task: TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, true, "each task keeps whether it stood shown");
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, false, "one shut there stays shut");
  act(() => panel.control().onShow(TASK, CLOUD));
  panel.render({ task: TASK, taskAgents: [AGENT] });
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(
    panel.control().open,
    false,
    "a tab asked for on another task, which opens the panel there, leaves the one it was asked from as it was",
  );

  panel.render({ task: BARE_TASK, taskAgents: [], bare: true });
  assert.deepEqual(panel.control().strip, []);
  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, false, "with nothing to show it is never drawn");
  assert.equal(panel.control().toggleAsked, true);
  act(() => panel.control().onToggle());
  assert.equal(panel.control().toggleAsked, false, "the toggle again takes the ask back");
  act(() => panel.control().onNewTab());
  assert.equal(panel.control().toggleAsked, true, "⌘T asks at the toggle too");
  panel.render({ task: TASK, taskAgents: [] });
  assert.equal(panel.control().toggleAsked, false, "an ask stands only on its plan");
});

test("each Inbox item is a stop of its own, so the panel a link opened beside one is shut beside the next, though both are one task's", () => {
  let control: SidePanelControl | undefined;

  function Probe({ item }: { item: string }) {
    control = useSidePanel(
      undefined,
      { id: TASK, holds: {}, bare: true, stop: item },
      [],
      [],
      [],
      [AGENT],
    );

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (item: string) => act(() => root.render(createElement(Probe, { item })));
  const panel = () => control ?? assert.fail("the panel is held");

  render("item-1");
  act(() => panel().onOpen(changesTab(PULL_REQUEST)));
  assert.equal(panel().open, true);
  render("item-2");
  assert.deepEqual(panel().strip, [changesTab(PULL_REQUEST)]);
  assert.equal(panel().open, false);
});

test("a panel standing for no task keeps what was opened at its stop, as a Manager's page holds it: a pull request's tab there stands there alone, and the panel is as it was left on coming back", () => {
  let control: SidePanelControl | undefined;

  function Probe({ stop }: { stop: string }) {
    control = useSidePanel(undefined, { id: undefined, holds: {}, bare: true, stop });

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (stop: string) => act(() => root.render(createElement(Probe, { stop })));
  const panel = () => control ?? assert.fail("the panel is held");

  render("manager-1");
  act(() => panel().onOpen(changesTab(PULL_REQUEST)));
  assert.deepEqual([panel().strip, panel().open], [[changesTab(PULL_REQUEST)], true]);

  render("manager-2");
  assert.deepEqual([panel().strip, panel().open], [[], false], "another stop holds none of it");

  render("manager-1");
  assert.deepEqual(
    [panel().strip, panel().tab, panel().open],
    [[changesTab(PULL_REQUEST)], changesTab(PULL_REQUEST), true],
  );
});

test("beside the window's Inbox the panel stands for the item's plan with none of its fixed tabs, holds what the item opens there, and the plan's page finds its strip as it left it, a fixed tab it closed still closed and one it opened still open", () => {
  const COMMIT = "0123456789abcdef0123456789abcdef01234567";
  let control: SidePanelControl | undefined;

  function Probe({ inbox }: { inbox: boolean }) {
    control = useSidePanel(
      undefined,
      inbox ? { id: TASK, holds: {}, bare: true } : usedTask(TASK),
      inbox ? [] : [AGENT],
      [],
      [],
      inbox ? undefined : [AGENT],
    );

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (inbox: boolean) => act(() => root.render(createElement(Probe, { inbox })));

  const panel = () => {
    assert.ok(control);

    return control;
  };

  render(false);
  act(() => panel().onChoose(changesTab(PULL_REQUEST)));

  render(true);
  assert.deepEqual(
    panel().strip,
    [changesTab(PULL_REQUEST)],
    "no fixed tab stands beside the Inbox",
  );
  act(() => panel().onOpenFile({ path: "src/invites.ts", startLine: 3, endLine: 5 }, COMMIT));
  assert.deepEqual(panel().strip, [changesTab(PULL_REQUEST), fileTab("src/invites.ts")]);
  assert.deepEqual(panel().tab, fileTab("src/invites.ts"));

  render(false);
  assert.deepEqual(panel().strip, [changesTab(PULL_REQUEST), fileTab("src/invites.ts")]);
});

test("a panel kept open launches shown only where the task's strip holds a tab, whatever tab was chosen, and never empty", () => {
  // Note that the tab chosen as the window quit is kept nowhere here, as a Terminal's is not.
  const kept = { open: true, tabs: ["comments"], width: 400, pins: [] };
  window.localStorage.setItem("app.sidePanel", JSON.stringify({ ...kept, tasks: {} }));
  const bare = launch({ task: TASK, taskAgents: [], bare: true });
  assert.deepEqual(bare.control().strip, []);
  assert.equal(bare.control().open, false, "with nothing to draw it stands hidden, not empty");
  bare.quit();

  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(PULL_REQUEST)));
  first.quit();
  const held = launch({ task: TASK, taskAgents: [AGENT] });
  assert.equal(held.control().open, true, "a tab the strip holds shows it");
  assert.deepEqual(held.control().tab, changesTab(PULL_REQUEST));
});

test("a record kept while the Call and Code stood in the panel reads with their tabs let go from the strip, and the Call's pin let go too", () => {
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["board", "code", "call", "comments"],
      tab: "call",
      width: 400,
      tasks: { [TASK]: { opened: ["call"], closed: [], recent: ["call"], order: ["call"] } },
      pins: [{ task: TASK, tab: "call", label: "Call", at: 1 }],
    }),
  );
  const panel = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(
    panel.control().strip,
    [],
    "neither the Call, Code, nor the Board stands in the strip",
  );
  assert.equal(panel.control().tab, undefined);
  assert.deepEqual(panel.control().pins, [], "a pin of the Call, which is gone, is let go");
});

test("an Inbox tab an earlier version pinned, a task's or an agent's, is let go, since threads open in the window's Inbox", () => {
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({
      open: false,
      tabs: ["comments"],
      width: 400,
      pins: [{ task: TASK, tab: "inbox", label: "Inbox", at: 1 }],
      agentPins: [{ agent: AGENT, tab: "inbox", label: "Inbox", at: 2 }],
    }),
  );
  const panel = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(panel.control().pins, []);
});

test("a narrow room holds the open panel full screen alone, so the window's ways out of full screen shut it there, and a room widened again stands it beside the document", () => {
  let room: ShellRoom = SHELL_ROOM.NARROW;
  let control: SidePanelControl | undefined;

  function Probe({ at }: { at: ShellRoom }) {
    control = useSidePanel(undefined, usedTask(TASK), [AGENT], [], [], [AGENT], at);

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = () => act(() => root.render(createElement(Probe, { at: room })));
  const now = () => control ?? assert.fail("the panel is held");
  // The panel opens on a tab chosen, which the narrow room holds full screen.
  render();
  act(() => now().onChoose(changesTab(PULL_REQUEST)));
  assert.deepEqual([now().open, now().fullScreen, now().fullScreenOnly], [true, true, true]);

  // Back, a column's tab shown, and a pin opened step out of full screen this way.
  act(() => now().onToggleFullScreen());
  assert.equal(now().open, false, "leaving full screen in a narrow room shuts the panel");

  act(() => now().onToggle());
  room = SHELL_ROOM.WIDE;
  render();
  assert.deepEqual([now().open, now().fullScreen, now().fullScreenOnly], [true, false, false]);
});

test("the Inbox with nothing chosen has no task, so the panel left open shows over it in no room, neither full screen on a phone nor empty beside it", () => {
  let control: SidePanelControl | undefined;

  function Probe({ at, task }: { at: ShellRoom; task: OpenTask }) {
    control = useSidePanel(undefined, task, [AGENT], [], [], [AGENT], at);

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const now = () => control ?? assert.fail("the panel is held");

  const render = (at: ShellRoom, task: OpenTask) =>
    act(() => root.render(createElement(Probe, { at, task })));

  // The panel stands open on a plan once a tab is chosen, and is kept open for the next launch.
  render(SHELL_ROOM.NARROW, usedTask(TASK));
  act(() => now().onChoose(changesTab(PULL_REQUEST)));
  assert.equal(now().open, true);
  assert.equal(JSON.parse(window.localStorage.getItem("app.sidePanel") ?? "{}").open, true);

  for (const room of [SHELL_ROOM.NARROW, SHELL_ROOM.WIDE]) {
    render(room, { id: undefined, holds: {}, bare: true });
    assert.deepEqual(
      [now().open, now().fullScreen, now().fullScreenOnly],
      [false, false, false],
      `the ${room} room shows the Inbox with no panel over it`,
    );
  }
});

test("a link in the panel to an agent elsewhere carries the panel to the agent's task as it stands, where another move there starts it shut", () => {
  const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const AGENT_TASK = "6c8e0a2b-4d6f-4b8d-9f1a-3c5e7a9b1d2f";
  let control: SidePanelControl | undefined;

  function Probe({ on }: { on: string }) {
    control = useSidePanel(
      undefined,
      on === TASK
        ? { id: TASK, holds: {}, bare: true, pages: { taskId: TASK } }
        : { id: on, holds: {}, pages: { taskId: on } },
      [],
      [],
      [],
      [],
    );

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (on: string) => act(() => root.render(createElement(Probe, { on })));

  const panel = () => {
    assert.ok(control);

    return control;
  };

  const pagesDrawn = () =>
    panel().strip.flatMap((tab) => (!Predicate.isString(tab) && "page" in tab ? [tab.page] : []));

  render(TASK);
  act(() => panel().onOpen(pageTab(PAGE), { taskId: OTHER_TASK }));
  act(() => panel().onCarry());
  render(AGENT_TASK);
  assert.ok(panel().open, "the panel still open beside the agent's task");
  assert.deepEqual(panel().tab, pageTab(PAGE));
  assert.deepEqual(pagesDrawn(), [PAGE], "the page drawn there, read on its own task");
  assert.deepEqual(panel().pages[0]?.place, { taskId: OTHER_TASK });

  render(OTHER_AGENT);
  assert.equal(panel().open, false, "a move with nothing carried starts the next stop shut");
});

test("a page of another task opens beside the Inbox item, drawn there, and Open task lands on that task with the page still chosen and the panel open", () => {
  const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  let control: SidePanelControl | undefined;

  function Probe({ inbox }: { inbox: boolean }) {
    control = useSidePanel(
      undefined,
      inbox
        ? { id: TASK, holds: {}, bare: true, pages: { taskId: TASK } }
        : { ...usedTask(OTHER_TASK), pages: { taskId: OTHER_TASK } },
      [],
      [],
      inbox ? [] : [PAGE],
      [],
    );

    return null;
  }

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (inbox: boolean) => act(() => root.render(createElement(Probe, { inbox })));

  const panel = () => {
    assert.ok(control);

    return control;
  };

  render(true);
  act(() => panel().onOpen(pageTab(PAGE), { taskId: OTHER_TASK }));

  const pagesDrawn = () =>
    panel().strip.flatMap((tab) => (!Predicate.isString(tab) && "page" in tab ? [tab.page] : []));

  assert.deepEqual(pagesDrawn(), [PAGE], "drawn beside the item it opened on");
  assert.deepEqual(panel().tab, pageTab(PAGE));
  assert.deepEqual(panel().pages[0]?.place, { taskId: OTHER_TASK }, "read on its own task");

  // Open task: the window goes to the page's task, showing the tab there (`onShowPanelTab`).
  act(() => panel().onShow(OTHER_TASK, pageTab(PAGE)));
  render(false);
  assert.deepEqual(panel().tab, pageTab(PAGE), "the page still chosen");
  assert.ok(panel().open, "the panel still open");
  assert.deepEqual(pagesDrawn(), [PAGE]);
});

test("an agent's transcript stands in a panel beside the Inbox alone, once the task's agents hold it", () => {
  let control: SidePanelControl | undefined;

  function Probe({ bare }: { bare: boolean }) {
    control = useSidePanel(
      undefined,
      bare ? { id: TASK, holds: {}, bare: true } : usedTask(TASK),
      [],
      [],
      [],
      [AGENT, OTHER_AGENT],
    );

    return null;
  }

  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const render = (bare: boolean) => act(() => root.render(createElement(Probe, { bare })));

  const panel = () => {
    assert.ok(control);

    return control;
  };

  render(true);
  act(() => panel().onOpen(transcriptTab(AGENT)));
  assert.deepEqual(panel().strip, [transcriptTab(AGENT)]);

  render(false);
  assert.ok(
    !panel().strip.some((tab) => !Predicate.isString(tab) && "transcript" in tab),
    "a task's own page draws its agents in its column, never beside",
  );
});

test("an archived agent's turn Changes tab is drawn as a live agent's, while its Terminal tab is not, and a pull request's tab is drawn whatever agents the task holds", () => {
  const drawn = { taskAgents: ["live"], heldAgents: ["live", "archived"] };
  const TURN = "4a6c8e0b-2d4f-4b6a-8c0e-1d3f5a7b9c2e";
  assert.equal(drawsChanges(turnChangesTab("archived", TURN), drawn), true);
  assert.equal(drawsChanges(turnChangesTab("other", TURN), drawn), false);
  assert.equal(drawsTerminal({ ...CLOUD, terminal: "archived" }, drawn), false);
  // A place that names no held agents draws turn Changes tabs by its live ones, as before.
  assert.equal(drawsChanges(turnChangesTab("archived", TURN), { taskAgents: ["live"] }), false);
  assert.equal(drawsChanges(changesTab(PULL_REQUEST), { taskAgents: [] }), true);
});
