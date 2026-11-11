// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/features/tasks-model";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { pageTab } from "@repo/ui/tab-strip-model";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AdminRoute, useAdminRoute } from "../admin/admin-route.js";
import { type AgentRoute, useAgentRoute } from "../agent-route.js";
import { runAppCommand } from "../app-commands.js";
import { type AutomationsRoute, useAutomationsRoute } from "../automations-route.js";
import { type InboxRoute, useInboxRoute } from "../inbox-route.js";
import { useCopyLink } from "../links-at-hand.js";
import { type SettingsRoute, useSettingsRoute } from "../settings-link.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useTaskRoute } from "../task-route.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import { SIDE_PANEL_TAB } from "../tasks/task-tab-model.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { deliveryOf, handState, stateWith, withExperiments } from "../testing/app-state.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { type TestWindowRouter, windowRouter } from "../testing/window-router.js";
import { useVersionHistoryRoute, type VersionHistoryRoute } from "../version-history-route.js";
import { useHomeRoute } from "../workspace-routes.js";
import { useNarrowBacks } from "./narrow-backs.js";
import { PLACE_BINDING, usePlaceBinding } from "./place-binding.js";
import { usePlaceLeave } from "./place-leave.js";
import { useRoutedExits } from "./routed-exits.js";
import { ROUTED_PLACE } from "./routed-places.js";
import { taskAtOf } from "./task-step.js";
import {
  type HistoryBehind,
  useRoutedStanding,
  useWindowHistory,
  type WindowHistory,
} from "./window-history.js";

/**
 * window-history-narrow.test.ts -- on a stage as narrow as a phone's,
 * each pane opened over another is a step of its own: the side panel over
 * the plan, an Inbox item, a Settings page, and a version over their lists, and an automation's runs over its setup. Back returns to the pane before, Forward opens it again, each
 * place's way back from its pane (`places/narrow-backs.ts`) goes through the
 * history, and each step's address is the link Copy link copies there. On the
 * desktop's width none of them is a step. The window's plans tab and Settings are a fake holding only where the
 * window stands; the history is the memory one the desktop installs.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const TASK_PATH = `/acme/task/${DOCUMENT_TASK.id}`;

/** A page an agent wrote for the task, as its side panel tab names it. */
const PAGE_TAB: SidePanelTab = pageTab("page-1");

/** An Inbox item of the task. */
const ITEM: InboxChoice = { taskId: DOCUMENT_TASK.id, itemId: "item-1" };

/** An automation of Acme's, whose page stands over the plan. */
const AUTOMATION = "automation-1";

/** Where the window stands, as the Tasks tab holds it; Settings and Admin are the router's (`settings-link.ts`, `admin-route.ts`). */
interface Standing {
  readonly panel: { readonly open: boolean; readonly tab: SidePanelTab | undefined };
  /** The Inbox, which the router stands (`inbox-route.ts`): where it stands open at the start, the window's first address is its own. */
  readonly inbox: {
    readonly open: boolean;
    readonly chosen: InboxChoice | undefined;
    /** Whether the Inbox shows one column by its own width, as one narrower than its split does in a room still wide. */
    readonly single?: boolean;
  };
  /** Whether a page holds unsaved work whose ask answers every way out with Stay, as Cancel would. */
  readonly unsaved?: boolean | undefined;
  /** How many times a door naming a thing opened it in the side panel, as the real one counts them. */
  readonly opened?: number | undefined;
  /** Whether the window stands on Home, no task open, rather than on the task. */
  readonly home?: boolean | undefined;
}

/** The window on the task, every pane over it shut. */
const ON_TASK: Standing = {
  panel: { open: false, tab: undefined },
  inbox: { open: false, chosen: undefined },
};

/** The Tasks tab over where the window stands, each press moving it as the real one does, its version history where the router stands it. */
function tasksTab(
  at: Standing,
  patch: (move: (held: Standing) => Standing) => void,
  room: ShellRoom,
  versions: VersionHistoryRoute,
  inbox: InboxRoute,
  agent: AgentRoute,
): TasksControl {
  const base = tasksControl();
  const panel = (next: Standing["panel"]) => patch((held) => ({ ...held, panel: next }));
  const inboxAt = (narrowed: string | undefined) => ({ workspace: ACME.slug, narrowed });
  // As the real one does, opening or shutting the panel leaves the tab where it stands.
  const setOpen = (open: boolean) => patch((held) => ({ ...held, panel: { ...held.panel, open } }));
  const shut = () => setOpen(false);
  // A narrow room holds the panel full screen alone, so leaving full screen there shuts it.
  const narrow = room === SHELL_ROOM.NARROW;
  const onTask = at.home !== true;
  return tasksControl({
    page: onTask ? TASKS_PAGE.DOCUMENT : TASKS_PAGE.HOME,
    activeTaskId: onTask ? DOCUMENT_TASK.id : undefined,
    boundFor: onTask ? DOCUMENT_TASK.id : undefined,
    region: onTask
      ? { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } }
      : base.region,
    // Note that the task is listed in Acme, as the Inbox's item of it is listed there.
    tasks: [{ ...DOCUMENT_TASK, workspaceId: ACME.id }],
    workspaces: [ACME],
    workspace: ACME,
    sidePanel: {
      ...base.sidePanel,
      open: at.panel.open,
      stop: onTask ? DOCUMENT_TASK.id : undefined,
      fullScreen: at.panel.open && narrow,
      fullScreenOnly: at.panel.open && narrow,
      tab: at.panel.tab,
      opened: at.opened ?? 0,
      onShow: (_taskId, tab) =>
        patch((held) => ({ ...held, panel: { open: true, tab }, opened: (held.opened ?? 0) + 1 })),
      onSetOpen: setOpen,
      onToggle: () => panel({ open: !at.panel.open, tab: at.panel.tab }),
      onToggleFullScreen: () => (narrow ? shut() : undefined),
      // The task's one tab, which closing empties the strip of and so shuts the panel, as the real one does.
      strip: at.panel.tab === undefined ? [] : [at.panel.tab],
      onClose: () => panel({ open: false, tab: undefined }),
    },
    // As the real one does, a panel filling the window is the nearer layer than the task.
    back: () => {
      if (at.panel.open) shut();
      return true;
    },
    // As the real one does, an agent's page opens and leaves by the router.
    agentView: {
      ...base.agentView,
      agentId: agent.agentId,
      onOpen: (agentId) => agent.onOpen(agentId, ACME.slug),
      onClose: agent.onClose,
    },
    // As the real doors do, the Inbox opens by the router, narrowed to the task named or to none.
    onShowInbox: ({ taskId }) => inbox.onOpen(inboxAt(taskId)),
    // As the real tab does, the Inbox's way back to its list is the router's, and whether it shows one column its own.
    inboxView: { ...base.inboxView, single: at.inbox.single ?? false, onClear: inbox.onClear },
    // As the real history does, each choice is a move of the router's.
    history: {
      ...base.history,
      open: versions.open,
      selected: versions.spot?.revision,
      spot: versions.spot,
      listed: versions.spot?.listed ?? true,
      onSelect: (revision) => versions.onMove({ revision, opened: undefined, listed: false }),
      onList: () => {
        if (versions.spot !== undefined) versions.onMove({ ...versions.spot, listed: true });
      },
    },
  });
}

/** Each place's way back from its pane, as the shell's screens take them. */
interface WaysBack {
  /** The side panel's, standing only full screen over the page it is opened on. */
  readonly pane: () => void;
  readonly inbox: () => void;
  readonly settings: () => void;
  readonly versions: () => void;
  /** An automation's runs', back to its setup. */
  readonly runs: () => void;
}

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  handState({}, { access: { admin: true } });
});

/** Takes down every window mounted so far, since a window's history is the one its root installed last. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

/** The window standing as `start` says in a room, under a router over a memory history, or over the history given, and its addresses written from its Copy link, as the root wires them. */
function mount(
  room: ShellRoom,
  start: Standing,
  held: TestWindowRouter = windowRouter(
    createMemoryHistory({ initialEntries: [start.inbox.open ? "/acme/inbox" : "/app"] }),
  ),
) {
  let history: (WindowHistory & HistoryBehind) | undefined;
  let shown: TasksControl | undefined;
  let ways: WaysBack | undefined;
  let standing = start;
  let restand: ((move: (held: Standing) => Standing) => void) | undefined;
  let settings: SettingsRoute | undefined;
  let admin: AdminRoute | undefined;
  let automations: AutomationsRoute | undefined;
  let versions: VersionHistoryRoute | undefined;
  let inbox: InboxRoute | undefined;
  let agent: AgentRoute | undefined;
  function Probe() {
    const [at, setAt] = useState(start);
    standing = at;
    // The window's routed exits leave for the Tasks tab's place and stay through the leave guard, as the window's root fills them in.
    const exits = useRoutedExits();
    exits.leave = () => leave();
    restand = setAt;
    // Settings and Admin stand where the router does, as the window's root reads them.
    settings = useSettingsRoute({
      workspaces: [ACME],
      listedId: ACME.id,
      narrow: room === SHELL_ROOM.NARROW,
    });
    admin = useAdminRoute({ listedSlug: () => ACME.slug });
    automations = useAutomationsRoute({
      narrow: room === SHELL_ROOM.NARROW,
    });
    versions = useVersionHistoryRoute({
      narrow: room === SHELL_ROOM.NARROW,
    });
    inbox = useInboxRoute();
    agent = useAgentRoute();
    const tab = tasksTab(at, setAt, room, versions, inbox, agent);
    // The window's leave guard, whose page holding unsaved work answers every ask with Stay, as Cancel would.
    const placeLeave = usePlaceLeave();
    exits.stay = placeLeave.stays;
    const unsaved = at.unsaved === true;
    useEffect(
      () => (unsaved ? placeLeave.stand((_leave, stay) => stay()) : undefined),
      [unsaved, placeLeave],
    );
    // Home stands where the router does, under the workspace listed, as the window's root reads it.
    const home = useHomeRoute({ listed: () => ACME.slug });
    // Leaves the routed place standing for the task bound's own place, or Home, as the Tasks tab's door does.
    const taskRoute = useTaskRoute();
    const leave = () => {
      const at =
        tab.boundFor === undefined
          ? undefined
          : taskAtOf(tab.boundFor, tab.tasks, tab.workspaces, tab.workspace, undefined);
      if (at === undefined) home.onOpen();
      else taskRoute.onOpen(at, true);
    };
    const tasks: TasksControl = {
      ...tab,
      placeLeave,
      atHome: home.open,
      onAutomationRuns: automations.onRuns,
      onLeaveRouted: leave,
    };
    const routed = useRoutedStanding();
    const copyLink = useCopyLink(
      tasks,
      settings.standing
        ? { view: settings.view, workspace: ACME, listed: settings.listed }
        : undefined,
      true,
      room,
      admin.open ? admin.view : undefined,
      routed?.place,
    );
    history = useWindowHistory({
      known: true,
      link: copyLink.placed,
      routed,
      automations,
      versionHistory: versions,
      inbox,
      room,
      tasks,
    });
    // Home and the task bound follow each other, as the window's root keeps them.
    usePlaceBinding({
      known: true,
      place: routed?.place,
      task: tasks.taskView.taskId,
      page: routed?.place.binding === PLACE_BINDING.TASK ? undefined : routed?.address,
      bound: tasks.boundFor,
      onUnbind: tasks.onUnbindTask,
      onSelect: tasks.onArriveTask,
      onToBound: leave,
      onToUnbound: home.onOpen,
    });
    // The ways back read the window's history, as the window's root hands it its routed exits.
    exits.behind = history.behind;
    shown = tasks;
    // Each place's way back from its pane, as the place module takes it, over what the router stands.
    const backs = useNarrowBacks(room === SHELL_ROOM.NARROW);
    const over = { routed: inbox.open || agent.agentId !== undefined, taskId: tasks.boundFor };
    const { sidePanel, history: versionList } = tasks;
    const { listAddress, list } = settings;
    const { setupAddress, onRuns } = automations;
    const versionsList = versions.listAddress;
    const { listAddress: inboxList, onClear } = inbox;
    ways = {
      pane: () => backs.pane(over, () => sidePanel.onSetOpen(false)),
      inbox: () => backs.list(ROUTED_PLACE.INBOX, inboxList, onClear),
      settings: () => backs.list(ROUTED_PLACE.SETTINGS, listAddress, list),
      versions: () => backs.list(ROUTED_PLACE.VERSION_HISTORY, versionsList, versionList.onList),
      runs: () => backs.list(ROUTED_PLACE.AUTOMATIONS, setupAddress, () => onRuns(false)),
    };
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      held.provide(withExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS), createElement(Probe))),
    ),
  );
  return {
    history: () => history ?? assert.fail("the window's history stands"),
    /** The Tasks tab as the shell presses it. */
    tab: () => shown ?? assert.fail("the Tasks tab stands"),
    /** Each place's way back from its pane (`places/narrow-backs.ts`). */
    back: () => ways ?? assert.fail("the ways back stand"),
    /** Where the window stands, the Inbox as the router stands it. */
    at: (): Standing => ({
      ...standing,
      inbox: { ...standing.inbox, open: inbox?.open === true, chosen: inbox?.chosen },
    }),
    /** The Inbox as the router stands it. */
    inbox: () => inbox ?? assert.fail("the Inbox's route stands"),
    /** The agent whose page the router stands, while one does. */
    agent: () => agent?.agentId,
    /** Settings as the router stands it, and the navigation a Settings link makes. */
    settings: () => settings ?? assert.fail("Settings stands"),
    /** Admin as the router stands it. */
    admin: () => admin ?? assert.fail("Admin stands"),
    /** The Automations pages as the router stands them. */
    automations: () => automations ?? assert.fail("the Automations route stands"),
    /** The task's version history as the router stands it. */
    versions: () => versions ?? assert.fail("the version history's route stands"),
    /** Opens the task's version history by the router, as its menu item does. */
    openVersions: () => act(() => versions?.onOpen(ACME.slug, DOCUMENT_TASK.id)),
    /** Opens an Automations page by the router, as a link or a press does, past the leave guard as the page it leaves let go. */
    openAutomation: (to: AutomationsPlace) => act(() => automations?.onOpen(to, ACME.slug)),
    /** Opens Settings where `link` names, as a Settings link does. */
    openSettings: (link: SettingsLink) => act(() => void settings?.open(link)),
    /** Moves the window as a door other than the history would, one leaving the Inbox leaving its route as the real door does. */
    move: (to: (held: Standing) => Standing) =>
      act(() => {
        if (inbox?.open === true && standing.inbox.open && !to(standing).inbox.open)
          inbox.onClose();
        restand?.(to);
      }),
    /** Presses through the shell, as a press of the pointer lands before the door it opens. */
    press: (press: () => void) =>
      act(() => {
        window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        press();
      }),
    /** The address of every entry the router's history holds, oldest first, and the one standing. */
    addresses: () => held.addresses(),
    standingAddress: () => held.history.location.href,
    /** Moves the history by itself, as a browser's Back and Forward do, never through the window. */
    moveHistory: (delta: number) => act(() => held.history.go(delta)),
    held,
  };
}

type Window = ReturnType<typeof mount>;

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The path ⇧⌘C copies where the window stands. */
function copiedHere(): string {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  const link = copied[0] ?? assert.fail("a link is copied");
  return new URL(link).pathname;
}

/** Back, then Forward, checking the window stands as each says. */
function backAndForth<Shown>(
  window: Window,
  list: (at: Standing) => Shown,
  expectedList: Shown,
  expectedItem: Shown,
): void {
  act(() => window.history().onBack());
  assert.deepEqual(list(window.at()), expectedList, "Back stands the screen before");
  assert.equal(window.history().canGoForward, true);
  act(() => window.history().onForward());
  assert.deepEqual(list(window.at()), expectedItem, "Forward stands the item again");
}

test("on a narrow stage the window has no Home: standing there, it stands on the Inbox's list instead, which takes Home's step, so Back has nothing to land on; a wide one stands on Home as ever", () => {
  const phone = mount(SHELL_ROOM.NARROW, { ...ON_TASK, home: true });
  assert.equal(phone.at().inbox.open, true, "the Inbox stands");
  assert.deepEqual(phone.addresses(), ["/acme/inbox"]);
  assert.equal(phone.history().canGoBack, false);
  unmountAll();

  const wide = mount(SHELL_ROOM.WIDE, { ...ON_TASK, home: true });
  assert.equal(wide.at().inbox.open, false, "Home stands");
});

test("on a narrow stage the side panel opened over the plan is a step: Back shuts it, Forward opens it on its tab, and each step's address is its link", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  assert.equal(window.standingAddress(), copiedHere());
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));

  assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  assert.equal(window.standingAddress(), copiedHere());
  backAndForth(
    window,
    (at) => at.panel,
    { open: false, tab: PAGE_TAB },
    {
      open: true,
      tab: PAGE_TAB,
    },
  );
});

test("on a narrow stage the side panel's way back steps back to the plan, so Back does not open the panel again and no open and shut adds a step", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  for (let round = 0; round < 2; round += 1) {
    window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
    window.press(() => window.back().pane());
    assert.equal(window.at().panel.open, false, "the way back shuts the panel");
    assert.deepEqual(
      window.addresses(),
      [TASK_PATH, `${TASK_PATH}/page/page-1`],
      "adding no step, however often the panel is opened and shut",
    );
    assert.equal(window.standingAddress(), TASK_PATH);
    assert.equal(window.history().canGoBack, false, "Back has no panel to open");
    assert.equal(window.history().canGoForward, true, "and Forward opens it again");
  }
});

test("on a narrow stage the way back taken as the side panel's last tab closes shuts it by a step back to the plan, so Back does not open it again and Forward opens the tab again", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  for (let round = 0; round < 2; round += 1) {
    window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
    // The tab closes as ever, shutting the panel its strip empties, and the panel's way back follows in the same press.
    window.press(() => {
      window.tab().sidePanel.onClose(PAGE_TAB);
      window.back().pane();
    });
    assert.deepEqual(window.at().panel, { open: false, tab: undefined }, "the tab closes");
    assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`], "adding no step");
    assert.equal(window.standingAddress(), TASK_PATH);
    assert.equal(window.history().canGoBack, false, "Back has no panel to open");
  }
  act(() => window.history().onForward());
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB }, "Forward opens the tab again");
});

test("on a narrow stage a side panel the window opened with, as a link loaded on it opens it, shuts in its own step, leaving none behind or ahead", () => {
  const window = mount(SHELL_ROOM.NARROW, { ...ON_TASK, panel: { open: true, tab: PAGE_TAB } });
  assert.deepEqual(window.addresses(), [`${TASK_PATH}/page/page-1`]);

  window.press(() => window.back().pane());
  assert.equal(window.at().panel.open, false);
  assert.deepEqual(window.addresses(), [TASK_PATH], "the plan takes the panel's step in place");
  assert.equal(window.history().canGoBack, false);
  assert.equal(window.history().canGoForward, false);
});

test("on a narrow stage a task opened from a list on its plan is one step, whose panel's way back shows the task's column in that step, so Back returns to the list at once", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined },
  });
  // A task opened from a list lands on its plan, the side panel over it, in one move (`use-tasks-tab.ts`'s `onSelect`).
  window.move((held) => ({
    ...held,
    inbox: { ...held.inbox, open: false },
    panel: { open: true, tab: SIDE_PANEL_TAB.DESCRIPTION },
  }));
  assert.equal(window.addresses().length, 2, "landing on the plan is one step after the list");

  window.press(() => window.back().pane());
  assert.deepEqual(
    window.at().panel,
    { open: false, tab: SIDE_PANEL_TAB.DESCRIPTION },
    "the way back shuts the panel",
  );
  assert.equal(window.at().inbox.open, false, "and leaves the task standing");
  assert.equal(window.addresses().length, 2, "in the plan's own step");
  assert.equal(window.standingAddress(), TASK_PATH);

  act(() => window.history().onBack());
  assert.equal(window.at().inbox.open, true, "Back returns to the list in one step");
});

test("on a narrow stage an Inbox item opened from its list is a step, and the Inbox's way back steps back to the list", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined },
  });
  // A row pressed chooses its item and stands it alone, as the Inbox's columns do.
  window.press(() => {
    window.inbox().onChoose(ITEM);
  });

  assert.deepEqual(window.addresses(), ["/acme/inbox", "/acme/inbox/item-1"]);
  assert.equal(window.standingAddress(), copiedHere());
  const shownItem = (at: Standing) => at.inbox.chosen;
  backAndForth(window, shownItem, undefined, ITEM);

  window.press(() => window.back().inbox());
  assert.equal(shownItem(window.at()), undefined, "the way back stands the list");
  assert.equal(window.history().canGoForward, true, "as a step back, the item ahead");
  assert.equal(window.standingAddress(), "/acme/inbox");
});

test("an Inbox narrowed to a task, showing one column, steps its item's way back to the task's list rather than adding a step after the item", () => {
  const window = mount(SHELL_ROOM.WIDE, {
    ...ON_TASK,
    inbox: { open: false, chosen: undefined, single: true },
  });
  window.press(() => window.tab().onShowInbox({ taskId: DOCUMENT_TASK.id }));
  window.press(() => {
    window.inbox().onChoose(ITEM);
  });
  window.press(() => window.back().inbox());

  assert.equal(window.history().canGoForward, true, "a step back, the item ahead");
  assert.equal(window.standingAddress(), `/acme/inbox/task/${DOCUMENT_TASK.id}`);
});

test("in a room still wide, as a 700px stage is, an Inbox showing one column by its own width holds its item as a step after its list, and its way back steps back to the list", () => {
  const window = mount(SHELL_ROOM.WIDE, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined, single: true },
  });
  window.press(() => {
    window.inbox().onChoose(ITEM);
  });

  assert.deepEqual(window.addresses(), ["/acme/inbox", "/acme/inbox/item-1"]);
  const shownItem = (at: Standing) => at.inbox.chosen;
  backAndForth(window, shownItem, undefined, ITEM);

  window.press(() => window.back().inbox());
  assert.equal(shownItem(window.at()), undefined, "the way back stands the list");
  assert.equal(window.history().canGoForward, true, "as a step back, the item ahead");
  assert.equal(window.standingAddress(), "/acme/inbox");
});

test("on the desktop's width an Inbox item stands at its own address, which Copy link names, whether the Inbox shows one column by its own width or splits", () => {
  for (const single of [true, false]) {
    const window = mount(SHELL_ROOM.WIDE, {
      ...ON_TASK,
      inbox: { open: true, chosen: undefined, single },
    });
    window.press(() => window.inbox().onChoose(ITEM));
    assert.equal(window.standingAddress(), "/acme/inbox/item-1");
    assert.equal(copiedHere(), "/acme/inbox/item-1", "Copy link names the item at hand");
    unmountAll();
  }
});

test("on a narrow stage a Settings page chosen from its list is a step, whose list stands at /settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
  assert.equal(window.standingAddress(), "/acme/settings");
  assert.equal(window.standingAddress(), copiedHere());
  window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });

  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings", "/acme/settings/appearance"]);
  assert.equal(window.standingAddress(), copiedHere());
  act(() => window.history().onBack());
  assert.equal(window.settings().listed, true, "Back stands the list before");
  assert.equal(window.history().canGoForward, true);
  act(() => window.history().onForward());
  assert.deepEqual(
    [window.settings().listed, window.settings().view],
    [false, SETTINGS_VIEW.APPEARANCE],
    "Forward stands the page again",
  );
});

test("on a narrow stage a version chosen from the list is a step, which Back and its way back leave for the list", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openVersions();
  window.press(() => window.tab().history.onSelect(2));

  assert.deepEqual(window.addresses(), [
    TASK_PATH,
    `${TASK_PATH}/versions`,
    `${TASK_PATH}/version/2`,
  ]);
  assert.equal(window.standingAddress(), copiedHere());
  act(() => window.history().onBack());
  assert.equal(window.versions().spot?.listed, true, "Back stands the list");
  act(() => window.history().onForward());
  assert.equal(window.versions().spot?.revision, 2, "Forward stands the version again");

  window.press(() => window.back().versions());
  assert.equal(window.standingAddress(), `${TASK_PATH}/versions`);
  assert.equal(window.history().canGoForward, true, "the way back stepped back to the list");
});

test("on a narrow stage a Settings page a link opened has no list behind it, so the way back stands the list in the page's step and Back leaves Settings", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  // A link turns to Settings on its page in one navigation.
  window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings/appearance"]);

  window.press(() => window.back().settings());
  assert.equal(window.settings().listed, true);
  assert.deepEqual(window.addresses(), [TASK_PATH, "/acme/settings"]);
  assert.equal(window.history().canGoForward, false);

  act(() => window.history().onBack());
  assert.equal(window.settings().standing, false, "Back leaves Settings for the task");
  assert.equal(window.standingAddress(), TASK_PATH);
});

test("a pairing's link loaded at its own address opens Settings in that entry's place, so Back leaves the tab rather than landing on the link again", () => {
  const loaded = "/connect/pair-code";
  const window = mount(
    SHELL_ROOM.WIDE,
    { ...ON_TASK, home: true },
    windowRouter(createMemoryHistory({ initialEntries: [loaded] })),
  );
  // The link opens Settings' Hosts page, as the window's own door for it does.
  window.openSettings({ page: SETTINGS_VIEW.HOSTS });
  assert.deepEqual(window.addresses(), ["/acme/settings/hosts"]);
  assert.equal(window.history().canGoBack, false);
});

test("on the desktop's width none of a narrow room's panes is a step: the side panel opened by its toggle, a Settings page, and a version", () => {
  const moves: readonly [Standing, (window: Window) => void][] = [
    [
      { ...ON_TASK, panel: { open: false, tab: PAGE_TAB } },
      (window) => window.press(() => window.tab().sidePanel.onToggle()),
    ],
    [
      ON_TASK,
      (window) => {
        window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
        window.openSettings({ page: SETTINGS_VIEW.APPEARANCE });
      },
    ],
    [
      ON_TASK,
      (window) => {
        window.openVersions();
        window.press(() => window.tab().history.onSelect(2));
      },
    ],
  ];
  for (const [start, open] of moves) {
    const window = mount(SHELL_ROOM.WIDE, start);
    open(window);
    // Each screen's way back to its list, which a wide room draws no button for, stands nothing new either.
    window.press(() => {
      window.back().settings();
      window.back().versions();
    });
    // Note that Settings and a version history, entered, are a step of their own after the task, however their pages turn.
    const entered = window.settings().standing || window.versions().open ? 1 : 0;
    assert.equal(window.addresses().length, 1 + entered, "one step, however the panes turn");
    assert.equal(window.history().canGoBack, entered === 1);
    unmountAll();
  }
});

test("a move the history makes by itself, as a browser's Back does, takes the window to the step before and keeps the step ahead, which its Forward opens again", () => {
  const window = mount(SHELL_ROOM.WIDE, ON_TASK);
  window.openSettings({ page: SETTINGS_VIEW.ACCOUNT, listed: true });
  const steps = window.addresses();
  assert.equal(steps.length, 2);

  window.moveHistory(-1);
  assert.equal(window.settings().standing, false, "the window lands on the plan");
  assert.deepEqual(window.addresses(), steps, "and records no step");
  assert.equal(window.standingAddress(), TASK_PATH);
  assert.equal(window.history().canGoForward, true);

  window.moveHistory(1);
  assert.equal(window.settings().standing, true, "Forward opens Settings again");
  assert.deepEqual(window.addresses(), steps);
});

test("on a narrow stage a move the history makes by itself back from the side panel shuts it, as the window's own Back does", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));

  window.moveHistory(-1);
  assert.deepEqual(window.at().panel, { open: false, tab: PAGE_TAB });
  assert.deepEqual(window.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  window.moveHistory(1);
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB });
});

test("a window whose history already stands on a step when it opens, as a reloaded tab's does, opens that step rather than recording where it first stood", () => {
  const before = mount(SHELL_ROOM.NARROW, ON_TASK);
  before.press(() => before.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  const { held } = before;
  unmountAll();

  const reloaded = mount(SHELL_ROOM.NARROW, ON_TASK, held);
  assert.deepEqual(
    reloaded.at().panel,
    { open: true, tab: PAGE_TAB },
    "the side panel opens again",
  );
  assert.deepEqual(reloaded.addresses(), [TASK_PATH, `${TASK_PATH}/page/page-1`]);
  assert.equal(reloaded.history().canGoBack, true);
});

test("a reloaded window whose saved step is the Admin place opens it once the account is known for an admin, its access read a moment after it signs in", async () => {
  const before = mount(SHELL_ROOM.NARROW, ON_TASK);
  act(() => before.admin().onOpen({ kind: "cost" }));
  await settle();
  const { held } = before;
  unmountAll();

  // The reloaded window's first document holds no access yet, as main's does until the read answers.
  let deliver: ((snapshot: AppStateSnapshot) => void) | undefined;
  const unread = stateWith(
    {},
    {
      access: { admin: false, pending: true },
    },
  );
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(unread),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      deliver = listener;
      return () => undefined;
    },
  });
  const reloaded = mount(SHELL_ROOM.NARROW, ON_TASK, held);
  await settle();
  assert.deepEqual(
    [reloaded.admin().open, reloaded.admin().view, reloaded.standingAddress()],
    [true, { kind: "cost" }, "/acme/admin/cost"],
    "the place stands, waiting on the read, rather than being passed over",
  );

  act(() =>
    deliver?.({
      ...unread,
      version: unread.version + 1,
      access: { ...unread.access, admin: true },
    }),
  );
  await settle();
  assert.deepEqual([reloaded.admin().open, reloaded.admin().view], [true, { kind: "cost" }]);
});

/** The automation's page, as a link to it or a press opens it, and as a link to one of its runs opens it. */
const AUTOMATION_PAGE: AutomationsPlace = { kind: AUTOMATIONS_PAGE.EDIT, automationId: AUTOMATION };
const LINKED_RUN: AutomationsPlace = { ...AUTOMATION_PAGE, runId: "run-1" };

/** The page standing taking up unsaved work, as an automation's editor does once its draft is written in. */
const UNSAVED = (held: Standing): Standing => ({ ...held, unsaved: true });

test("on a narrow stage an automation's runs chosen from its setup are a step, whose way back steps back to the setup without asking to leave its unsaved work", async () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openAutomation(AUTOMATION_PAGE);
  await settle();
  window.move(UNSAVED);
  window.press(() => window.automations().onRuns(true));
  await settle();
  assert.equal(window.automations().runs, true);
  assert.equal(window.addresses().length, 3);

  window.press(() => window.back().runs());
  await settle();
  assert.equal(window.automations().runs, false);
  assert.equal(window.addresses().length, 3, "the way back added no step");
  assert.equal(window.history().canGoForward, true, "the way back was a step back");
});

test("on a narrow stage an automation opened on its runs, as a run's link opens it, has no setup behind it, so the way back stands the setup in the runs' step", async () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openAutomation(LINKED_RUN);
  await settle();
  assert.equal(window.automations().runs, true);
  assert.equal(window.addresses().length, 2);

  window.press(() => window.back().runs());
  await settle();
  assert.equal(window.automations().runs, false);
  assert.deepEqual(window.addresses(), [
    `/acme/task/${DOCUMENT_TASK.id}`,
    `/acme/automation/${AUTOMATION}`,
  ]);
  assert.equal(window.history().canGoForward, false);
});

test("on a narrow stage Back and Forward between an automation's setup and a run a link opened move the window there without asking to leave its unsaved work", async () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openAutomation(AUTOMATION_PAGE);
  await settle();
  window.openAutomation(LINKED_RUN);
  await settle();
  window.move(UNSAVED);

  act(() => window.history().onBack());
  await settle();
  assert.deepEqual(window.automations().place, AUTOMATION_PAGE);
  act(() => window.history().onForward());
  await settle();
  assert.deepEqual(window.automations().place, LINKED_RUN);
});

test("on a narrow stage Back from an automation with unsaved work to another automation still asks, and stays where it is refused", async () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.openAutomation({ kind: AUTOMATIONS_PAGE.EDIT, automationId: "automation-2" });
  await settle();
  window.openAutomation(AUTOMATION_PAGE);
  await settle();
  window.move(UNSAVED);

  act(() => window.history().onBack());
  await settle();
  assert.deepEqual(window.automations().place, AUTOMATION_PAGE, "the draft's automation stands");
});

test("on a narrow stage another thing a link opens in the side panel standing over the plan is a step of its own, which Back shows again", () => {
  const window = mount(SHELL_ROOM.NARROW, ON_TASK);
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, SIDE_PANEL_TAB.DESCRIPTION));
  assert.equal(window.addresses().length, 3, "the plan, the page's tab, then the plan's tab");

  act(() => window.history().onBack());
  assert.deepEqual(window.at().panel, { open: true, tab: PAGE_TAB });
});

test("on a narrow stage a task's way out steps back past its own panes to the page it was opened from, pushing nothing, and Forward opens the task again", () => {
  const window = mount(SHELL_ROOM.NARROW, {
    ...ON_TASK,
    inbox: { open: true, chosen: undefined },
  });
  assert.equal(window.history().away, undefined, "the Inbox's list has nothing behind it");
  window.move((held) => ({
    ...held,
    inbox: { ...held.inbox, open: false },
    panel: { open: true, tab: SIDE_PANEL_TAB.DESCRIPTION },
  }));
  // The task's own panes, each a step of its own: the agents' column, then a page's tab.
  window.press(() => window.back().pane());
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, PAGE_TAB));
  const steps = window.addresses();
  assert.equal(steps.length, 3);
  assert.ok(window.history().away, "the Inbox stands behind the task");

  act(() => window.history().onLeave());
  assert.equal(window.at().inbox.open, true, "the way out lands on the Inbox at once");
  assert.deepEqual(window.addresses(), steps, "and pushes nothing");
  assert.equal(window.held.at(), 0);

  act(() => window.history().onForward());
  assert.equal(window.at().inbox.open, false, "Forward opens the task again");
});

test("on a narrow stage a task with no page behind it, as one a link opened, names none for its way out", () => {
  const window = mount(SHELL_ROOM.NARROW, { ...ON_TASK, panel: { open: true, tab: PAGE_TAB } });
  window.press(() => window.tab().sidePanel.onShow(DOCUMENT_TASK.id, SIDE_PANEL_TAB.DESCRIPTION));
  assert.equal(window.history().canGoBack, true, "Back has the task's own pane behind it");
  assert.equal(window.history().away, undefined, "but the way out has no page to go back to");
});
