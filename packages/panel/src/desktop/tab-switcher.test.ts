// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary, type TasklessAgent } from "@repo/features/agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { agentTab, fileTab, STRIP_TAB_KIND } from "@repo/ui/tab-strip-model";
import { holdExits } from "@repo/ui/testing/held-exits";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { ROUTED_PLACE, type RoutedPlace } from "../places/routed-places.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { agentsControl, tasksControl } from "../testing/tasks-control.js";
import { windowRouter } from "../testing/window-router.js";
import { type PersonRoute, usePersonRoute } from "../workspace-routes.js";
import { TabSwitcher } from "./tab-switcher.js";

/**
 * tab-switcher.test.ts -- ⌃Tab as the window answers it: a stop is a whole
 * screen, taken as Back takes a step, so arriving on a task with both panes
 * is one stop, and a tab the window chose by itself or one chosen in the side
 * panel's strip takes it in place; a quick tap goes to the screen
 * before through the task's own doors, both panes restored, and draws
 * nothing; a hold draws the cards, the screen here first and dimmed, each
 * named as Back's list names it; ⇧ steps back, Escape goes nowhere, a card
 * pressed is gone to, and a still of the work area left is kept for its
 * card, out of the session recording. The cards stand in a modal dialog
 * that holds focus while they show and hands it back to where it was as
 * they go, fading out on the exit token, or at once where motion is held.
 * A browser keeps ⌃Tab for its own tabs, so a window that is no desktop app
 * leaves it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const TASK = DOCUMENT_TASK.id;
/** A File tab of the task, the side panel's first. */
const README = fileTab("README.md");
/** A second File tab of the task, beside the first. */
const NOTES = fileTab("docs/notes.md");

/** A still as main answers one, synthetic. */
const STILL = "data:image/jpeg;base64,AAAA";

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  releaseMotion();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.useRealTimers();
});

/** The cards' dialog, which the switcher draws in `@repo/ui`'s Dialog. */
const DIALOG = '[role="dialog"]';

/** What the switcher asked the window to show, in order. */
interface Asked {
  readonly shown: string[];
}

const asked = (): Asked => ({ shown: [] });

/** The workspace the window lists, whose places the switcher's doors open under. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** The window on the task, its panel on `tab` and its column on `column`, every door the switcher may use recorded in `told`. */
function onTask(
  tab: SidePanelTab,
  told: Asked,
  overrides: Partial<TasksControl> = {},
  column?: MainTab,
): TasksControl {
  const base = tasksControl({ activeTaskId: TASK, tasks: [{ ...DOCUMENT_TASK }], workspace: ACME });
  const named = (shown: MainTab | SidePanelTab) =>
    typeof shown === "string" ? shown : JSON.stringify(shown);
  return {
    ...base,
    mainTabs: {
      ...base.mainTabs,
      tab: column,
      tabs: column === undefined ? [] : [column],
      openAgents:
        column !== undefined && typeof column !== "string" && column.kind === STRIP_TAB_KIND.AGENT
          ? [column.agent]
          : [],
    },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      strip: [README, NOTES],
      tab,
      onShow: (taskId, shown) =>
        told.shown.push(`panel beside ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    },
    onShowPanelTab: (taskId, shown) =>
      told.shown.push(`panel ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    onShowColumnTab: (taskId, shown) =>
      told.shown.push(`column ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    ...overrides,
  };
}

/** The window on the task as `onTask` draws it, `tab` opened in its side panel by a door naming it, as a link opens a file, which Back and ⌃Tab take a step for. */
function openedOnTask(
  tab: SidePanelTab,
  told: Asked,
  overrides: Partial<TasksControl> = {},
  column?: MainTab,
): TasksControl {
  const shown = onTask(tab, told, overrides, column);
  return { ...shown, sidePanel: { ...shown.sidePanel, opened: shown.sidePanel.opened + 1 } };
}

/** The switcher over a window, drawn again on each place the test moves the window to. */
async function mounted(room: ShellRoom = SHELL_ROOM.WIDE) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  // The window's router, which stands the Board and a person's page at their addresses, and a person's page opened through its route, as a door opens it.
  const { history, provide } = windowRouter();
  let personRoute: PersonRoute | undefined;
  function PersonDoor(): null {
    personRoute = usePersonRoute();
    return null;
  }
  /** Draws the switcher over `tasks`, the window's router standing at `at`, `/app` unless said. */
  const draw = async (
    tasks: TasksControl,
    place: RoutedPlace | undefined = undefined,
    at = "/app",
  ) => {
    if (history.location.pathname !== at) act(() => history.push(at));
    act(() =>
      root.render(
        withQueryClient(
          provide(
            createElement(
              ShellRoomContext.Provider,
              { value: room },
              createElement(PersonDoor),
              createElement(TabSwitcher, {
                available: true,
                tab: PANEL_TAB.TASKS,
                place,
                onTabChange: () => undefined,
                tasks,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });
  };
  /** Opens `userId`'s page under Acme with the name a door knew them by, as the window's door opens it, then draws `tasks` over it. */
  const drawPerson = async (tasks: TasksControl, userId: string, name: string) => {
    act(() => personRoute?.onOpen(userId, name, "acme"));
    await draw(tasks, undefined, history.location.pathname);
  };
  /** Where the window's router stands, which a place's door moves. */
  const at = () => history.location.pathname;
  return { draw, drawPerson, at };
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const tab = (shift = false) =>
  key("keydown", { key: "Tab", code: "Tab", ctrlKey: true, shiftKey: shift });
const letGo = () => key("keyup", { key: "Control", code: "ControlLeft" });

/** A press of the pointer, as a tab chosen by hand is led by. */
function press(): void {
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ui-tab-card")];
}

/** The Inbox's address under Acme, where a window drawn on it stands. */
const INBOX_AT = "/acme/inbox";

test("a tab chosen by hand in the side panel's strip takes the screen in place, as Back's step does, so a quick tap goes back where you came from without drawing anything", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  press();
  await window.draw(onTask(NOTES, told));
  press();
  await window.draw(onTask(README, told));

  const pressed = tab();
  assert.equal(
    pressed.defaultPrevented,
    true,
    "⌃Tab is the switcher's, not the field's or the terminal's under it",
  );
  letGo();

  assert.deepEqual([told.shown, window.at()], [[], INBOX_AT]);
  assert.equal(document.querySelector(DIALOG), null);
});

test("arriving on a task is one screen, the tabs that arrive with it taking it in place, so ⌃Tab goes back where you came from", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  press();
  await window.draw(onTask(NOTES, told));
  await window.draw(onTask(README, told, {}, agentTab("x")));

  tab();
  letGo();
  assert.deepEqual([told.shown, window.at()], [[], INBOX_AT]);
});

test("a place under Admin is no screen standing, so ⌃Tab from Admin does not pass over it to the screen before", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  press();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  press();
  const underAdmin = onTask(NOTES, told);
  await window.draw(underAdmin, ROUTED_PLACE.ADMIN, "/acme/admin");

  tab();
  letGo();
  assert.deepEqual(told.shown, [], "the task before the Inbox is not gone to");
});

test("a screen picked restores both its panes, the task opened once", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(README, told, {}, agentTab("x")));
  press();
  await window.draw(onTask(README, told), ROUTED_PLACE.INBOX, INBOX_AT);

  tab();
  letGo();
  assert.deepEqual(told.shown, [
    `column the task: ${JSON.stringify(agentTab("x"))}`,
    `panel beside the task: ${JSON.stringify(README)}`,
  ]);
});

test("held, the cards show with the screen here first and dimmed; ⇧ steps back around, and Escape goes nowhere", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));

  tab();
  tab();
  const shown = cards();
  assert.equal(shown.length, 3);
  assert.deepEqual(
    shown.map((card) => card.getAttribute("aria-selected")),
    ["false", "false", "true"],
  );
  assert.match(shown[2]?.textContent ?? "", /Inbox/u);

  tab(true);
  tab(true);
  assert.equal(
    cards()[0]?.getAttribute("aria-selected"),
    "true",
    "back past the second card to the first",
  );
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();

  assert.equal(document.querySelector(DIALOG), null);
  assert.deepEqual(told, asked());
});

/** A field that holds focus before ⌃Tab, and a file opened in the task's side panel so the cards have two screens. */
async function heldOnField() {
  handCapabilities(DESKTOP_CAPABILITIES);
  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));
  tab();
  tab();
  return field;
}

test("the cards stand in a dialog announced as modal that holds focus, and letting go hands focus back to where it was", async () => {
  const field = await heldOnField();

  const dialog = document.querySelector<HTMLElement>(DIALOG);
  assert.ok(dialog, "the cards are drawn in a dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(
    document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent,
    "Recent tabs",
  );
  assert.ok(dialog.contains(document.activeElement), "focus is held inside the dialog");

  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  assert.equal(document.activeElement, field);
});

test("the cards fade out as ⌃ is let go, drawn and inert through the exit, and are gone after it", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  await heldOnField();

  letGo();
  act(() => vi.advanceTimersToNextFrame());
  const standsAFrameOn = document.querySelector(DIALOG) !== null;
  await act(async () => exits.finish());

  assert.equal(standsAFrameOn, true);
  assert.equal(document.querySelector(DIALOG), null);
});

test("the cards go at once while motion is held", async () => {
  holdMotion();
  holdExits();
  await heldOnField();

  letGo();

  assert.equal(document.querySelector(DIALOG), null);
});

test("a task's card is named as Back's list names the screen: the task, then its panes' tabs", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));

  tab();
  tab();
  const words = cards().map((card) => [
    card.querySelector(".ui-tab-card-name")?.textContent,
    card.querySelector(".ui-tab-card-detail")?.textContent,
  ]);
  assert.deepEqual(words, [
    [DOCUMENT_TASK.name, "README.md"],
    [DOCUMENT_TASK.name, "notes.md"],
  ]);
});

test("a task's card says the task and its agent's tab by the names they go by now, and the agent as Back's list called it where nothing names it now", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  const column = agentTab("agent-token");
  const agent = (title: string): AgentSummary => ({
    id: column.agent,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  });
  const named = (title: string | undefined, name = DOCUMENT_TASK.name) => ({
    tasks: [{ ...DOCUMENT_TASK, name }],
    agents: agentsControl({ agents: title === undefined ? [] : [agent(title)] }),
  });
  await window.draw(onTask(NOTES, told, named("Token refresh"), column));
  await window.draw(openedOnTask(README, told, named("Token renewal", "Auth rewrite"), column));

  tab();
  tab();
  const left = () => {
    const card = cards()[1];
    return [
      card?.querySelector(".ui-tab-card-name")?.textContent,
      card?.querySelector(".ui-tab-card-detail")?.textContent,
    ];
  };
  assert.deepEqual(left(), ["Auth rewrite", "Token renewal · notes.md"]);

  await window.draw(openedOnTask(README, told, named(undefined, "Auth rewrite"), column));
  assert.deepEqual(left(), ["Auth rewrite", "Token refresh · notes.md"]);
});

test("a person's page card wears their face and name, not a generic icon", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.drawPerson(onTask(NOTES, told), "user-ada", "Ada Lovelace");
  press();
  await window.draw(onTask(NOTES, told));

  tab();
  tab();
  const card = cards().find((each) => each.textContent?.includes("Ada Lovelace"));
  assert.ok(card, "the person's page is a card");
  assert.equal(card.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
});

test("a card pressed while the cards show is gone to, a place through its own door", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  await window.draw(onTask(README, told));

  tab();
  tab(true);
  const inbox = cards().find((card) => /Inbox/u.test(card.textContent ?? ""));
  assert.ok(inbox);
  act(() => {
    inbox.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true }),
    );
  });

  assert.equal(window.at(), INBOX_AT);
  assert.equal(document.querySelector(DIALOG), null);
});

test("the screen left is taken as a still of the work area for its card, drawn as it lands while the cards show, and the session recording leaves it out", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const taken: unknown[] = [];
  let answer: (still: string) => void = () => undefined;
  fakeActPort({
    [ACT_KIND.WINDOW_CAPTURE]: (part) => {
      taken.push(part);
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    },
  });
  const work = document.createElement("main");
  work.className = "desktop-main";
  work.getBoundingClientRect = () => new DOMRect(240, 0, 1040, 800);
  document.body.append(work);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));

  tab();
  tab();
  assert.equal(cards()[0]?.querySelector("img"), null, "no still yet, so the glyph stands");
  // Note that the mutation sends the capture a moment after the cards show, so the test answers it once it is sent.
  await vi.waitFor(() => assert.equal(taken.length, 1));
  act(() => answer(STILL));
  await vi.waitFor(() =>
    assert.equal(cards()[0]?.querySelector("img")?.getAttribute("src") === STILL, true),
  );

  assert.deepEqual(taken, [{ x: 240, y: 0, width: 1040, height: 800 }]);
  const preview = cards()[0]?.querySelector(".ui-tab-card-preview");
  assert.ok(preview?.classList.contains("ph-no-capture"));
  assert.equal(preview?.querySelector("img")?.getAttribute("src"), STILL);
  assert.equal(cards()[1]?.querySelector("img"), null, "a stop with no still wears its glyph");
});

test("a window that is no desktop app leaves ⌃Tab to the browser", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP));
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), false);
  assert.deepEqual(told, asked());
});

test("the menu bar's Next recent tab goes at once, as a tap does", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB));
  });
  assert.deepEqual(told.shown, [`panel the task: ${JSON.stringify(NOTES)}`]);
});

test("a dialog over the window keeps ⌃Tab, so nothing moves behind it", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told));
  await window.draw(openedOnTask(README, told));
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), true);
  assert.deepEqual(told, asked());
});

test("a screen whose tab closed since it was left is no stop", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  await window.draw(onTask(NOTES, told));
  press();
  const closed = onTask(README, told);
  await window.draw({
    ...closed,
    sidePanel: { ...closed.sidePanel, strip: [README] },
  });

  tab();
  letGo();
  assert.deepEqual([told.shown, window.at()], [[], INBOX_AT]);
});

test("a task's screens stay stops while the Inbox stands in its place with a panel strip of its own", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(README, told));
  press();
  const over = onTask(README, told);
  await window.draw(
    { ...over, sidePanel: { ...over.sidePanel, strip: [] } },
    ROUTED_PLACE.INBOX,
    INBOX_AT,
  );

  tab();
  letGo();
  assert.deepEqual(told.shown, [`panel the task: ${JSON.stringify(README)}`]);
});

test("a tab closed on its task's page stays let go once the Inbox stands in the task's place", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told, { boundFor: undefined }), ROUTED_PLACE.HOME);
  await window.draw(openedOnTask(README, told));
  press();
  await window.draw(onTask(NOTES, told));
  const closed = onTask(NOTES, told);
  await window.draw({
    ...closed,
    sidePanel: { ...closed.sidePanel, strip: [NOTES] },
  });
  press();
  const over = onTask(NOTES, told);
  await window.draw(
    { ...over, sidePanel: { ...over.sidePanel, strip: [] } },
    ROUTED_PLACE.INBOX,
    INBOX_AT,
  );

  tab();
  tab();
  assert.deepEqual(
    cards().map((card) => card.querySelector(".ui-tab-card-detail")?.textContent),
    ["", "notes.md", ""],
  );
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();
});

test("a task opened before its row reaches the list stays a stop, and one gone from the list once left does not", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  press();
  await window.draw(onTask(NOTES, told, { tasks: [] }));
  await window.draw(onTask(NOTES, told));
  press();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);

  tab();
  letGo();
  assert.deepEqual(told.shown, [`panel the task: ${JSON.stringify(NOTES)}`]);

  await window.draw(
    onTask(NOTES, told, { activeTaskId: undefined, tasks: [] }),
    ROUTED_PLACE.INBOX,
    INBOX_AT,
  );
  tab();
  letGo();
  assert.deepEqual(
    told.shown,
    [`panel the task: ${JSON.stringify(NOTES)}`],
    "a task deleted since is no stop",
  );
});

test("the open task gone from the list after it was listed, as one deleted by a teammate, is no stop", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(NOTES, told), ROUTED_PLACE.INBOX, INBOX_AT);
  press();
  await window.draw(onTask(NOTES, told));
  await window.draw(onTask(NOTES, told, { tasks: [] }));
  press();
  await window.draw(onTask(NOTES, told, { tasks: [] }), ROUTED_PLACE.INBOX, INBOX_AT);

  tab();
  letGo();
  assert.deepEqual(told, asked());
});

test("a screen picked past unsaved work is restored only once the leave is confirmed, both panes together", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const asks: (() => void)[] = [];
  const guarded = {
    stand: () => () => undefined,
    pass: (leave: () => void) => leave(),
    // Note that the fake's doors move nothing a blocker could hold, so the move held at the ask is the whole door.
    arrive: (move: (free: boolean) => void, landed: () => void) =>
      asks.push(() => {
        move(false);
        landed();
      }),
    stays: () => undefined,
    stayed: () => false,
    along: () => undefined,
  };
  const window = await mounted();
  await window.draw(onTask(README, told, { placeLeave: guarded }, agentTab("x")));
  press();
  await window.draw(onTask(README, told, { placeLeave: guarded }), ROUTED_PLACE.INBOX, INBOX_AT);

  tab();
  letGo();
  assert.deepEqual(told.shown, [], "nothing moves while the ask stands");
  tab();
  tab();
  assert.equal(
    cards()[0]?.dataset.here,
    "true",
    "a leave not yet confirmed leaves the screen here first",
  );
  assert.match(cards()[0]?.textContent ?? "", /Inbox/u);
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();
  asks[0]?.();
  assert.deepEqual(told.shown, [
    `column the task: ${JSON.stringify(agentTab("x"))}`,
    `panel beside the task: ${JSON.stringify(README)}`,
  ]);
});

test("a narrow room's panel, which fills the window as it stands, is opened on the screen's tab and not toggled shut", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const turned: string[] = [];
  const narrow = (control: TasksControl): TasksControl => ({
    ...control,
    sidePanel: {
      ...control.sidePanel,
      fullScreenOnly: true,
      onToggleFullScreen: () => turned.push("full screen turned"),
    },
  });
  const window = await mounted();
  const filled = onTask(README, told);
  await window.draw(narrow({ ...filled, sidePanel: { ...filled.sidePanel, fullScreen: true } }));
  press();
  const shut = onTask(README, told);
  await window.draw(
    narrow({ ...shut, sidePanel: { ...shut.sidePanel, open: false } }),
    ROUTED_PLACE.INBOX,
    INBOX_AT,
  );

  tab();
  letGo();
  assert.deepEqual(told.shown, [`panel the task: ${JSON.stringify(README)}`]);
  assert.deepEqual(turned, []);
});

test("a screen picked with its panel shut shuts the panel, and one with the panel filling the window fills it again", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const panel: string[] = [];
  const doors = (control: TasksControl): TasksControl => ({
    ...control,
    sidePanel: {
      ...control.sidePanel,
      onSetOpen: (open) => panel.push(open ? "opened" : "shut"),
      onToggleFullScreen: () => panel.push("full screen turned"),
    },
  });
  const window = await mounted();
  const shut = onTask(NOTES, told, {}, agentTab("x"));
  await window.draw(doors({ ...shut, sidePanel: { ...shut.sidePanel, open: false } }));
  const filled = openedOnTask(README, told, {}, agentTab("x"));
  await window.draw(doors({ ...filled, sidePanel: { ...filled.sidePanel, fullScreen: true } }));
  press();
  await window.draw(doors(onTask(NOTES, told)), ROUTED_PLACE.INBOX, INBOX_AT);

  tab();
  letGo();
  assert.deepEqual(told.shown, [`panel the task: ${JSON.stringify(README)}`]);
  assert.deepEqual(panel, ["full screen turned"]);

  press();
  await window.draw(doors(onTask(NOTES, told)), undefined, "/acme/tasks");
  tab(true);
  letGo();
  assert.deepEqual(told.shown, [
    `panel the task: ${JSON.stringify(README)}`,
    `column the task: ${JSON.stringify(agentTab("x"))}`,
  ]);
  assert.deepEqual(panel, ["full screen turned", "shut"]);
});

/** An agent with no task, listed in the window, as the sidebar lists it. */
function listedAgent(status: TasklessAgent["status"]): TasklessAgent {
  return {
    id: "0a1b2c3d-0000-4000-8000-200000000001",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Sweep flaky tests",
    createdAt: 1,
    status,
    turnId: null,
    startedBy: { userId: "user-ada", name: "Ada Lovelace" },
    automationId: null,
    workspaceId: "workspace-acme",
    repository: "acme/relay",
    activityAt: 1,
  };
}

/** The switcher's cards, held over the agent's page and then the Inbox, so the agent is the stop behind; listed with no task where nothing else lists it. */
async function agentCardAfter(
  agent: Pick<AgentSummary, "id" | "title">,
  listed: Partial<TasksControl> = { listedAgents: { standing: [], archived: [] } },
): Promise<HTMLElement | undefined> {
  handCapabilities(DESKTOP_CAPABILITIES);
  const base = tasksControl();
  const window = await mounted();
  await window.draw({
    ...base,
    ...listed,
    agentView: { ...base.agentView, agentId: agent.id },
  });
  press();
  await window.draw({ ...base, ...listed }, ROUTED_PLACE.INBOX, INBOX_AT);
  tab();
  tab();
  return cards().find((card) => card.textContent?.includes(agent.title ?? ""));
}

/** The switcher's card of an agent with no task, listed as the sidebar lists it. */
function tasklessCardAfter(status: TasklessAgent["status"]): Promise<HTMLElement | undefined> {
  const agent = listedAgent(status);
  return agentCardAfter(agent, { listedAgents: { standing: [agent], archived: [] } });
}

test("an agent's stop whose turn failed says so at its end, as its row and its tab do", async () => {
  const card = await tasklessCardAfter(AGENT_STATUS.FAILED);
  assert.ok(card?.querySelector(".failed-mark"));
});

test("an agent's stop that finished says nothing at its end", async () => {
  const card = await tasklessCardAfter(AGENT_STATUS.COMPLETED);
  assert.ok(card);
  assert.equal(card.querySelector(".failed-mark"), null);
});

test("an automation's agent on its run's task is named by its title and its automation, not as a bare agent", async () => {
  const { workspaceId, repository, ...summary } = listedAgent(AGENT_STATUS.COMPLETED);
  const agent: AgentSummary = {
    ...summary,
    planId: TASK,
    title: "Draft standup entry",
    automationId: "automation-standup",
    automationName: "Daily standup",
  };
  const card = await agentCardAfter(agent, {
    liveAgents: [{ ...agent, workspaceId, repository }],
  });
  // The card is found by the agent's title, so a bare "Agent" finds none.
  assert.match(card?.textContent ?? "", /Daily standup/);
});
