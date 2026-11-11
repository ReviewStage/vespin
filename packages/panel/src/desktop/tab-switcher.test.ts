// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentStatus, type ListedAgent } from "@repo/features/agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { fileTab } from "@repo/ui/tab-strip-model";
import { holdExits } from "@repo/ui/testing/held-exits";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { ROUTED_PLACE, type RoutedPlace } from "../places/routed-places.js";
import type { RecentStep, RecentSteps } from "../places/window-history.js";
import { type Place, routedPlace, type StepTitle, taskPlace } from "../places/window-steps.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { tasksControl } from "../testing/tasks-control.js";
import { windowRouter } from "../testing/window-router.js";
import { TabSwitcher } from "./tab-switcher.js";

/**
 * tab-switcher.test.ts -- ⌃Tab as the window answers it over Back's steps,
 * most recent first (`places/window-history.ts`'s `recent`, whose order and
 * reach its own tests hold): a quick tap goes to the screen before as a
 * visit and draws nothing; a hold draws the cards, the screen here first and
 * dimmed, each named as Back's list names its step and wearing its place's
 * glyph; ⇧ steps back, Escape goes nowhere, a card pressed is gone to, and a
 * still of the work area left is kept for its card. The cards stand in a modal dialog that holds focus while they
 * show and hands it back to where it was as they go, fading out on the exit
 * token, or at once where motion is held. A browser keeps ⌃Tab for its own
 * tabs, so a window that is no desktop app leaves it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const TASK = DOCUMENT_TASK.id;
/** A File tab of the task. */
const README = fileTab("README.md");
/** Another File tab of the task. */
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

/** The workspace the window lists. */
const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** A step of the task, its column and side panel on the tabs given, named as Back's list names it. */
function taskScreen(
  column?: MainTab,
  side?: SidePanelTab,
  title?: StepTitle,
): Omit<RecentStep, "standing"> {
  return {
    place: taskPlace("/acme/tasks/1", { taskId: TASK, column, side: side ?? null }),
    title,
    routed: ROUTED_PLACE.TASK,
    params: { workspace: "acme" },
  };
}

/** A step of a routed place at `address`, named as Back's list names it. */
function placeScreen(
  routed: RoutedPlace,
  address: string,
  title?: StepTitle,
  params: RecentStep["params"] = {},
): Omit<RecentStep, "standing"> {
  return { place: routedPlace(address), title, routed, params: { workspace: "acme", ...params } };
}

const INBOX = placeScreen(ROUTED_PLACE.INBOX, "/acme/inbox", { label: "Inbox" });

/** The window's steps, most recent first, the first the one it stands on, and every visit asked for. */
function windowSteps(screens: readonly Omit<RecentStep, "standing">[]) {
  const visits: Place[] = [];
  const steps: RecentSteps = {
    recent: () => screens.map((screen, at) => ({ ...screen, standing: at === 0 })),
    standingStep: () => screens[0]?.place,
    onVisitStep: (to) => visits.push(to),
  };
  return { steps, visits };
}

/** The switcher over `steps`, drawn under a window's router. */
async function mounted(
  steps: RecentSteps,
  tasks: TasksControl = tasksControl({
    activeTaskId: TASK,
    tasks: [{ ...DOCUMENT_TASK }],
    workspace: ACME,
  }),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const { provide } = windowRouter();
  // Note that the window's state lands on a later render, as main delivers it, so the switcher is drawn twice, as a window settles.
  for (let drawn = 0; drawn < 2; drawn += 1) {
    act(() =>
      root.render(
        withQueryClient(provide(createElement(TabSwitcher, { available: true, steps, tasks }))),
      ),
    );
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });
  }
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

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ui-tab-card")];
}

/** What each card says: its name and the words under it. */
function cardWords(): (string | null | undefined)[][] {
  return cards().map((card) => [
    card.querySelector(".ui-tab-card-name")?.textContent,
    card.querySelector(".ui-tab-card-detail")?.textContent,
  ]);
}

test("a quick tap goes to the screen before this one as a visit, without drawing anything", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const here = taskScreen(undefined, README);
  const { steps, visits } = windowSteps([here, INBOX]);
  await mounted(steps);

  const pressed = tab();
  assert.equal(
    pressed.defaultPrevented,
    true,
    "⌃Tab is the switcher's, not the field's or the terminal's under it",
  );
  letGo();

  assert.deepEqual(visits, [INBOX.place]);
  assert.equal(document.querySelector(DIALOG), null);
});

test("held, the cards show with the screen here first and dimmed; ⇧ steps back around, and Escape goes nowhere", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const { steps, visits } = windowSteps([
    taskScreen(undefined, README),
    taskScreen(undefined, NOTES),
    INBOX,
  ]);
  await mounted(steps);

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
  assert.deepEqual(visits, []);
});

/** A field that holds focus before ⌃Tab, and two screens for the cards. */
async function heldOnField() {
  handCapabilities(DESKTOP_CAPABILITIES);
  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  await mounted(windowSteps([taskScreen(undefined, README), INBOX]).steps);
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

test("a card is named as Back's list names its step, a task's by its tabs' words where nothing names it, and a place by its door's word", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  await mounted(
    windowSteps([
      taskScreen(undefined, README, { label: DOCUMENT_TASK.name, detail: "README.md" }),
      taskScreen(undefined, NOTES),
      placeScreen(ROUTED_PLACE.SETTINGS, "/settings/general", {
        label: "Settings",
        detail: "General",
      }),
      placeScreen(ROUTED_PLACE.VERSION_HISTORY, "/acme/tasks/1/versions"),
    ]).steps,
  );

  tab();
  tab();
  assert.deepEqual(cardWords(), [
    [DOCUMENT_TASK.name, "README.md"],
    ["Task", "notes.md"],
    ["Settings", "General"],
    ["Version history", ""],
  ]);
});

test("a person's page card wears their face and name, not a generic icon", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  await mounted(
    windowSteps([
      INBOX,
      placeScreen(
        ROUTED_PLACE.PERSON,
        "/acme/people/user-ada",
        { label: "Ada Lovelace" },
        { userId: "user-ada" },
      ),
    ]).steps,
  );

  tab();
  tab();
  const card = cards().find((each) => each.textContent?.includes("Ada Lovelace"));
  assert.ok(card, "the person's page is a card");
  assert.equal(card.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
});

test("a card pressed while the cards show is gone to", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const settings = placeScreen(ROUTED_PLACE.SETTINGS, "/settings/general", { label: "Settings" });
  const { steps, visits } = windowSteps([taskScreen(undefined, README), INBOX, settings]);
  await mounted(steps);

  tab();
  tab();
  const card = cards().find((each) => /Settings/u.test(each.textContent ?? ""));
  assert.ok(card);
  act(() => {
    card.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true }),
    );
  });

  assert.deepEqual(visits, [settings.place]);
  assert.equal(document.querySelector(DIALOG), null);
});

test("the screen left is taken as a still of the work area for its card, drawn as it lands while the cards show", async () => {
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
  await mounted(windowSteps([taskScreen(undefined, README), INBOX]).steps);

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
  assert.equal(preview?.querySelector("img")?.getAttribute("src"), STILL);
  assert.equal(cards()[1]?.querySelector("img"), null, "a screen with no still wears its glyph");
});

test("a window that is no desktop app leaves ⌃Tab to the browser", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP));
  const { steps, visits } = windowSteps([taskScreen(undefined, README), INBOX]);
  await mounted(steps);

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), false);
  assert.deepEqual(visits, []);
});

test("the menu bar's Next recent tab goes at once, as a tap does", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const { steps, visits } = windowSteps([taskScreen(undefined, README), INBOX]);
  await mounted(steps);

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB));
  });
  assert.deepEqual(visits, [INBOX.place]);
});

test("a dialog over the window keeps ⌃Tab, so nothing moves behind it", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const { steps, visits } = windowSteps([taskScreen(undefined, README), INBOX]);
  await mounted(steps);
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), true);
  assert.deepEqual(visits, []);
});

/** An agent on the task, listed in the window as the list followed live carries it. */
function listedAgent(status: AgentStatus): ListedAgent {
  return {
    id: "0a1b2c3d-0000-4000-8000-200000000001",
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Sweep flaky tests",
    createdAt: 1,
    status,
    turnId: null,
    startedBy: { userId: "user-ada", name: "Ada Lovelace" },
    workspaceId: "workspace-acme",
    repository: "acme/relay",
  };
}

/** The switcher's cards, held over the Inbox with the agent's page the screen behind, the window listing the agent. */
async function agentCardAfter(agent: ListedAgent): Promise<HTMLElement | undefined> {
  handCapabilities(DESKTOP_CAPABILITIES);
  const page = placeScreen(ROUTED_PLACE.AGENT, `/acme/agents/${agent.id}`, undefined, {
    agentId: agent.id,
  });
  await mounted(windowSteps([INBOX, page]).steps, { ...tasksControl(), liveAgents: [agent] });
  tab();
  tab();
  return cards().find((card) => card.textContent?.includes(agent.title ?? ""));
}

test("an agent's page whose turn failed says so at its card's end, as its row and its tab do", async () => {
  const card = await agentCardAfter(listedAgent(AGENT_STATUS.FAILED));
  assert.ok(card?.querySelector(".failed-mark"));
});

test("an agent's page that finished says nothing at its card's end", async () => {
  const card = await agentCardAfter(listedAgent(AGENT_STATUS.COMPLETED));
  assert.ok(card);
  assert.equal(card.querySelector(".failed-mark"), null);
});

test("an automation's agent on its run's task is named by its title and its automation, not as a bare agent", async () => {
  const card = await agentCardAfter({
    ...listedAgent(AGENT_STATUS.COMPLETED),
    title: "Draft standup entry",
    automationId: "automation-standup",
    automationName: "Daily standup",
  });
  // The card is found by the agent's title, so a bare "Agent" finds none.
  assert.match(card?.textContent ?? "", /Daily standup/);
});
