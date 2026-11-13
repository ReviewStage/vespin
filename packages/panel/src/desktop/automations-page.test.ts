// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import { AUTOMATION_PRESET } from "@repo/features/automation-presets";
import { AUTOMATION_CALL_FAILURE } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  GITHUB_TRIGGER_EVENT,
} from "@repo/features/automation-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { act } from "react";
import { test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import {
  announced,
  automation,
  automationRows,
  button,
  CI_DIGEST,
  DIGEST,
  FAILING,
  layIntegrations,
  layStanding,
  listed,
  menuItem,
  mount,
  mountPages,
  onLedger,
  PERSONAL,
  pick,
  picked,
  picker,
  pickerDescription,
  pickerDetail,
  promptEditor,
  render,
  rowOf,
  SWEEP,
  settle,
  tasksView,
  type,
  WORKSPACE,
  world,
  writePrompt,
} from "../testing/automations-page.js";
import { layContainersAt } from "../testing/container-width.js";
import { longPress, underAFinger } from "../testing/finger.js";
import { restOn } from "../testing/hint-rest.js";
import { playMotions } from "../testing/pane-motion.js";
import { relayout } from "../testing/resize-observer.js";
import { newTaskControl, tasksControl } from "../testing/tasks-control.js";

/**
 * automations-page.test.ts -- the Automations page as the window draws it: the listed workspace's automations, the workspace's before the personal ones, each naming its owner, an automation turned off saying so, a failed run marked, a switch's write taken in place, a read that did not land said with a retry, and an automation's editor, its schedule, its prompt, and the agent its runs go to.
 *
 * The window, its fakes, and the helpers both files read stand in `testing/automations-page.ts`.
 */

/** Each row's name and owner, top to bottom. */
function rows(page: HTMLElement): string[][] {
  return automationRows(page).map((row) => [
    row.querySelector(".automation-row-name")?.textContent ?? "",
    row.querySelector(".automation-owner-name")?.textContent ?? "",
  ]);
}

/** The button named, wherever it is drawn. */
/** What a reader names `control` by: the elements its `aria-labelledby` lists, itself among them, in order. */
function nameOf(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-labelledby") ?? "").split(" ");

  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** The servers chip, found as a reader names it: by its hidden field name, then its own face. */
function serversChip(root: ParentNode = document): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button[aria-labelledby]")].find((each) => {
    const [fieldName] = (each.getAttribute("aria-labelledby") ?? "").split(" ");

    return (
      fieldName !== undefined && document.getElementById(fieldName)?.textContent === "MCP servers"
    );
  });
}

/** The option of the list standing open whose words are `words`. */
function optionWords(words: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
    (each) => each.textContent === words,
  );

  assert.ok(found, `no option ${words}`);

  return found;
}

/** The button of the dialog standing whose words are `name`. */
function dialogButton(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      "[role=dialog] button, [role=alertdialog] button",
    ),
  ].find((each) => each.textContent === name);

  assert.ok(found, `no dialog button ${name}`);

  return found;
}

/** The toolbar's crumbs' words, in order. */
function crumbs(page: HTMLElement): string {
  return page.querySelector(".automation-toolbar nav")?.textContent ?? "";
}

/** The page's headings: an automation's page has one, its name, written in its title. */
function headings(page: HTMLElement): string[] {
  return [...page.querySelectorAll("h1")].map(
    (each) => each.querySelector("input")?.value ?? each.textContent?.trim() ?? "",
  );
}

type BarResult = { banner: HTMLElement; parts: Element[] };

/** The window's bar over `page`, its parts in the order they stand, each by its text. */
function bar(page: HTMLElement): BarResult {
  const banner = page.querySelector<HTMLElement>("header") ?? assert.fail("no bar");

  return { banner, parts: [...banner.children] };
}

test("the listed workspace's automations stand before the personal ones, under a heading each, every row naming its owner", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(listed(), [WORKSPACE.id]);
  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme", "Only you"],
  );
  assert.deepEqual(rows(page), [
    ["Nightly flaky-test sweep", "Acme"],
    ["Dependency bumps", "Acme"],
    ["Morning digest", "Only you"],
  ]);
});

test("one owner's automations alone stand under no heading, still naming their owner", async () => {
  world.standing = [DIGEST];
  const page = mount();
  await settle();

  assert.equal(page.querySelectorAll(".automation-group h2").length, 0);
  assert.deepEqual(rows(page), [["Morning digest", "Only you"]]);
});

test("an automation turned off reads Off where its next run would, and a failed newest run is marked at its row's end", async () => {
  world.standing = [{ ...SWEEP, enabled: false }, FAILING];
  const page = mount();
  await settle();

  const off = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(off.querySelector(".automation-row-when")?.textContent, "Off");
  assert.equal(off.querySelector(".failed-mark") === null, true);
  assert.ok(rowOf(page, "Dependency bumps").querySelector(".failed-mark"));
});

test("an automation an event fires says nothing where a next run would be, and a failed newest run is still marked", async () => {
  world.standing = [
    automation(8, {
      name: "Check each deploy",
      trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      lastRun: FAILING.lastRun,
    }),
  ];
  const page = mount();
  await settle();

  const row = rowOf(page, "Check each deploy");
  assert.equal(row.querySelector(".automation-row-when") === null, true);
  assert.doesNotMatch(row.textContent ?? "", /Not scheduled/u);
  assert.ok(row.querySelector(".failed-mark"));
});

test("an automation's row leads with its clock tile, wearing its newest run's state, and hangs its card", async () => {
  world.standing = [FAILING];
  const page = mount();
  await settle();

  const row = rowOf(page, "Dependency bumps");
  assert.ok(row.querySelector('.actor-mark[data-kind="automation"]'), "the clock tile leads");
  assert.equal(
    row.querySelector(".automation-row-glyph") === null,
    true,
    "no trigger glyph on a tile",
  );
  restOn(row.querySelector<HTMLElement>("button") ?? assert.fail("no press"));
  const card = document.querySelector('.ui-tooltip-card [data-actor-card="automation"]');
  assert.match(card?.textContent ?? "", /Dependency bumps/u);
  assert.match(card?.textContent ?? "", /Last ran/u);
});

test("a switch turns its automation off, and the row takes the service's answer in its place", async () => {
  const page = mount();
  await settle();

  const toggle = rowOf(page, "Nightly flaky-test sweep").querySelector<HTMLButtonElement>(
    "[role=switch]",
  );

  act(() => toggle?.click());
  await settle();

  assert.deepEqual(world.changes, [{ automationId: SWEEP.id, change: { enabled: false } }]);
  await vi.waitFor(() =>
    assert.equal(
      rowOf(page, "Nightly flaky-test sweep").querySelector(".automation-row-when")?.textContent,
      "Off",
    ),
  );
  const row = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(row.querySelector("[role=switch]")?.getAttribute("aria-checked"), "false");
});

test("what changed elsewhere is drawn as the host lays it, and a switch reads nothing again", async () => {
  const page = mount();
  await settle();
  world.standing = world.standing.map((each) =>
    each.id === FAILING.id ? { ...each, name: "Dependency bumps, weekly" } : each,
  );

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>("[role=switch]")
      ?.click(),
  );
  await settle();
  assert.deepEqual(listed(), [WORKSPACE.id], "the switch reads the list no more");
  layStanding();
  await settle();

  await vi.waitFor(() =>
    assert.deepEqual(rows(page), [
      ["Nightly flaky-test sweep", "Acme"],
      ["Dependency bumps, weekly", "Acme"],
      ["Morning digest", "Only you"],
    ]),
  );
});

test("a switch the service refuses stays where it was and says who may move it", async () => {
  world.changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mount();
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>("[role=switch]")
      ?.click(),
  );
  await settle();

  const row = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(row.querySelector("[role=switch]")?.getAttribute("aria-checked"), "true");
  assert.match(
    document.body.textContent ?? "",
    /Only its creator, or the workspace's owners and admins, can change it\./u,
  );
});

test("a list that could not be read says so, and Retry reads it again", async () => {
  world.standing = [DIGEST];
  world.listRefusals = 1;
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /The automations could not be read\./u);

  const retry = [...page.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );

  act(() => retry?.click());
  await settle();

  assert.deepEqual(listed(), [WORKSPACE.id, WORKSPACE.id]);
  await vi.waitFor(() => assert.deepEqual(rows(page), [["Morning digest", "Only you"]]));
});

test("with no automations the page says what one is, and with no workspace listed it asks for none", async () => {
  world.standing = [];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /No automations yet\./u);
  act(() => world.root?.unmount());
  world.root = undefined;

  mount(tasksControl({ workspace: undefined }));
  await settle();
  assert.deepEqual(listed(), [WORKSPACE.id], "no list is read with no workspace listed");
});

test("the list's title is its bar's heading, and Create with an agent and New automation end the bar", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const { banner, parts } = bar(page);
  assert.equal(banner.querySelectorAll("h1").length, 1);
  assert.equal(parts.length, 2, "a heading and the acts, with no box of the page's own between");
  const [heading, actions] = parts;
  assert.equal(heading?.querySelector("h1")?.textContent, "Automations");
  assert.deepEqual(
    [...(actions?.querySelectorAll("button") ?? [])].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    ["Create with an agent", "New automation"],
  );
});

test("with no workspace chosen the bar's two acts stay reachable by keyboard, press nothing, and say why on hover", async () => {
  const agentOpens: number[] = [];
  mount(
    tasksControl({
      workspace: undefined,
      newTask: newTaskControl({ onOpenForAutomation: () => agentOpens.push(1) }),
    }),
  );
  await settle();

  for (const name of ["Create with an agent", "New automation"]) {
    const bar_ = button(name);
    assert.equal(bar_.getAttribute("aria-disabled"), "true", name);
    assert.equal(bar_.disabled, false, `${name} stays focusable`);
    assert.match(pillOver(bar_) ?? "", /Choose a workspace first/u, name);
    act(() => bar_.click());
  }

  assert.deepEqual(agentOpens, []);
});

test("New automation, in the bar, opens a new automation's page", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() => button("New automation").click());
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.NEW });
});

test("while the list is first read it stands as quiet rows under its toolbar, said to a reader as being read", async () => {
  world.listHeld = true;
  const page = mount();
  await settle();

  const wait = page.querySelector("[role=status][aria-busy=true]");
  assert.equal(wait?.textContent, "Reading your automations…");
  assert.ok((wait?.querySelectorAll(".ui-skeleton").length ?? 0) > 0);
  const { parts } = bar(page);
  assert.equal(parts[0]?.querySelector("h1")?.textContent, "Automations");
  assert.ok(parts[1]?.querySelector("button"), "its acts stand at the bar's end");
});

test("with no workspace listed the list and a linked automation stand as quiet blocks, never as empty or gone", async () => {
  // Note that the tasks are read apart from the workspaces, so a listed task list says nothing of them.
  const page = mount(tasksControl({ workspace: undefined, listRead: true, listFailed: false }));
  await settle();
  assert.equal(
    page.querySelector("[role=status][aria-busy=true]")?.textContent,
    "Reading your automations…",
  );
  assert.doesNotMatch(page.textContent ?? "", /No automations yet\./u);

  act(() => world.root?.unmount());
  world.root = undefined;
  mount(tasksControl({ workspace: undefined }), {
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
  });
  await settle();
  const linked = document.body;
  assert.equal(
    linked
      .querySelector("[role=status][aria-busy=true]")
      ?.textContent?.startsWith("Reading the automation…"),
    true,
  );
  assert.doesNotMatch(linked.textContent ?? "", /Not found/u);
  assert.deepEqual(listed(), [], "no workspace's list is asked for");
});

test("an automation's whole row is its press: its owner and its next run open it too, and its switch only switches it", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const row = rowOf(page, "Nightly flaky-test sweep");
  const owner = row.querySelector<HTMLElement>(".automation-owner");
  assert.ok(owner, "the row names its owner");
  act(() => owner.click());
  await settle();
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });

  act(() => world.root?.unmount());
  document.body.innerHTML = "";
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const when = rowOf(list, "Nightly flaky-test sweep").querySelector<HTMLElement>(
    ".automation-row-when",
  );

  assert.ok(when, "the row says when it runs next");
  act(() => when.click());
  await settle();
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });

  act(() => world.root?.unmount());
  document.body.innerHTML = "";
  mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  act(() => button(`Turn off ${SWEEP.name}`).click());
  await settle();
  assert.deepEqual(world.places, [{ kind: AUTOMATIONS_PAGE.LIST }], "the switch opens nothing");
  assert.ok(world.changes.length > 0, "and switches it");
});

test("under a finger, an automation's row draws its switch and no ⋯, and held opens its menu", async () => {
  underAFinger();
  const page = mount();
  await settle();

  const row = rowOf(page, SWEEP.name);
  assert.ok(
    row.querySelector('button[aria-label="Automation actions"]') === null,
    "the row draws no ⋯",
  );
  assert.ok(row.querySelector(`[aria-label="Turn off ${SWEEP.name}"]`), "the row keeps its switch");
  longPress(
    row.querySelector<HTMLElement>("button.ui-list-row-main") ?? assert.fail("the row is a press"),
  );
  assert.ok(menuItem("Delete"), "held, it offers its menu");
});

test("a row opens its automation's page, headed by its name, with a crumb back to the list, and what it was saved as", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep").querySelector<HTMLButtonElement>("button")?.click(),
  );
  await settle();

  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  assert.deepEqual(headings(page), [SWEEP.name], "the page has one h1, the automation's name");
  assert.equal(
    page.querySelectorAll("input[aria-label='Automation name']").length,
    1,
    "the name is written once, in the title",
  );
  assert.ok(page.querySelector("h1 input[aria-label='Automation name']"), "the title is the field");
  assert.ok(
    page.querySelector('h1 .actor-mark[data-kind="automation"]'),
    "the clock tile stands before the name",
  );
  assert.equal(crumbs(page), "Automations", "the toolbar leads with the way back, not the name");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
  act(() => button("Automations").click());
  assert.deepEqual(
    world.places.at(-1),
    { kind: AUTOMATIONS_PAGE.LIST },
    "its crumb goes back to the list",
  );
});

test("a new automation is created only once it is named and told its task, and then stands as its own page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.deepEqual(headings(page), [""]);
  assert.equal(
    page.querySelector<HTMLInputElement>("h1 input[aria-label='Automation name']")?.placeholder,
    "New automation",
    "a page not yet made stands as New automation until it is named",
  );
  assert.equal(crumbs(page), "Automations");

  act(() => button("Create automation").click());
  await settle();
  assert.deepEqual(world.creates, []);
  assert.match(page.textContent ?? "", /Name the automation\./u);
  assert.match(page.textContent ?? "", /Tell the agent what to do\./u);
  assert.equal(
    promptEditor(page).getAttribute("aria-invalid"),
    "true",
    "the prompt is marked as what stops the save",
  );

  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  writePrompt(page, "Triage the issues opened overnight.");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(world.creates.length, 1);
  assert.deepEqual(world.creates[0], {
    workspaceId: WORKSPACE.id,
    name: "Morning triage",
    trigger: {
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      cron: "0 9 * * 1-5",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the issues opened overnight." },
    scope: AUTOMATION_SCOPE.PERSONAL,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
    archiveSuccessful: true,
    slackDelivery: false,
    repositories: ["acme/ledger"],
  });
  assert.equal(world.places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.deepEqual(headings(page), ["Morning triage"]);
});

test("an edit says it is unsaved and saves only what moved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  writePrompt(page, "Fix the two flakiest tests.");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    {
      automationId: SWEEP.id,
      change: {
        action: { ...SWEEP.action, prompt: "Fix the two flakiest tests.", disabledServers: [] },
      },
    },
  ]);
  await vi.waitFor(() =>
    assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved"),
  );
});

test("a save the service refuses keeps the draft and says why under the name", async () => {
  world.changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => button("Save").click());
  await settle();

  assert.equal(
    page.querySelector("[role='alert']")?.textContent,
    "Only its creator, or the workspace's owners and admins, can change it.",
  );
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Sweep",
  );
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
});

test("a switch the service refuses in the editor toasts, as the list's does, and leaves the page's alert and its Save unmarked", async () => {
  world.changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => page.querySelector<HTMLButtonElement>("[role=switch]")?.click());
  await settle();

  assert.equal(page.querySelector("[role='alert']") === null, true);
  assert.match(
    document.body.textContent ?? "",
    /Only its creator, or the workspace's owners and admins, can change it\./u,
  );
  assert.equal(page.querySelector("[role=switch]")?.getAttribute("aria-checked"), "true");
});

test("a deletion asks first, then goes back to the list without the automation", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Automation actions").click());
  act(() => menuItem("Delete").click());
  await settle();
  assert.deepEqual(world.deletes, []);
  act(() => dialogButton("Delete automation").click());
  await settle();

  assert.deepEqual(world.deletes, [SWEEP.id]);
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.ok(world.deletedNow(SWEEP.id), "the history passes over its page");
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
});

test("a deletion the service refuses says why in the deletion's words, not a save's", async () => {
  world.deleteRefusal = AUTOMATION_CALL_FAILURE.UNANSWERED;
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Automation actions").click());
  act(() => menuItem("Delete").click());
  await settle();
  act(() => dialogButton("Delete automation").click());
  await settle();

  assert.match(
    document.querySelector("[role=dialog], [role=alertdialog]")?.textContent ?? "",
    /The automation could not be deleted\. Try again\./u,
  );
});

test("a row's Delete asks first, and once confirmed the row leaves the list and the history passes over its page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);

  const actions = row.querySelector('button[aria-label="Automation actions"]');
  assert.ok(actions instanceof HTMLElement);
  act(() => actions.click());
  await settle();
  act(() => menuItem("Delete").click());
  await settle();

  assert.deepEqual(world.deletes, []);
  assert.ok(rows(page).some(([name]) => name === SWEEP.name));
  assert.match(
    document.querySelector("[role=dialog], [role=alertdialog]")?.textContent ?? "",
    new RegExp(`Delete ${SWEEP.name}\\?`, "u"),
  );

  act(() => dialogButton("Delete automation").click());
  await settle();

  assert.deepEqual(world.deletes, [SWEEP.id]);
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.ok(world.deletedNow(SWEEP.id), "the history passes over its page");
});

test("a row's Delete withdrawn deletes nothing and leaves the row standing", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);

  const actions = row.querySelector('button[aria-label="Automation actions"]');
  assert.ok(actions instanceof HTMLElement);
  act(() => actions.click());
  await settle();
  act(() => menuItem("Delete").click());
  await settle();
  act(() => dialogButton("Cancel").click());
  await settle();

  assert.deepEqual(world.deletes, []);
  assert.ok(rows(page).some(([name]) => name === SWEEP.name));
});

/** The leave dialog's question, while it stands. */
function leaveAsked(): string | undefined {
  return [...document.querySelectorAll("[role=dialog], [role=alertdialog]")]
    .map((dialog) => dialog.textContent ?? "")
    .find((words) => words.includes("Leave with unsaved changes?"));
}

test("Escape leaves a page with nothing unsaved for the list, and asks first where its draft would be lost", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  // Note that the way out is the router's move, which asks a turn later, once its blocker holds it.
  await settle();
  assert.equal(world.places.length, 1, "the unsaved draft stands");
  assert.match(leaveAsked() ?? "", /Your changes to this automation are lost\./u);
  act(() => button("Cancel").click());
  await settle();
  assert.equal(leaveAsked(), undefined);

  type(page.querySelector("input[aria-label='Automation name']"), SWEEP.name);
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("a new automation with something written asks before any way out leaves it, and Leave goes where was asked", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  writePrompt(page, "Triage the issues opened overnight.");
  act(() => button("Automations").click());
  await settle();
  assert.equal(world.places.length, 1, "the crumb waits on the question");
  assert.ok(leaveAsked(), "the leave question stands");
  act(() => button("Cancel").click());
  await settle();

  const editing = world.windowPath();
  act(() => world.openBoard());
  await settle();
  assert.equal(world.windowPath(), editing, "the sidebar's row waits on the question too");
  act(() => button("Leave").click());
  await settle();
  assert.equal(world.windowPath(), `/${WORKSPACE.id}/tasks`);
});

test("the shell hears the page's ask only while an edit is unsaved, and asking through it waits on the page's question", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(world.shellAsk, undefined, "a page with nothing unsaved holds nothing back");

  writePrompt(page, "Fix the two flakiest tests.");
  const left: string[] = [];
  act(() => world.shellAsk?.(() => left.push("sign-in")));
  assert.ok(leaveAsked(), "the shell's way out asks the page's question");
  assert.deepEqual(left, []);
  act(() => button("Leave").click());
  await settle();
  assert.deepEqual(left, ["sign-in"]);

  act(() => button("Save").click());
  await settle();
  assert.equal(world.shellAsk, undefined, "once saved, the shell holds nothing back");
});

test("a new automation with nothing written leaves at once, and one just created stands as its own page without asking", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  act(() => button("Automations").click());
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.equal(leaveAsked(), undefined);
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  writePrompt(page, "Triage the issues opened overnight.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(world.places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.equal(leaveAsked(), undefined);
});

test("the Owner row stands in a shared workspace, and not in the account's personal one", async () => {
  const shared = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.equal(picked(shared, "Owner"), "Only you");
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const personal = mountPages({ kind: AUTOMATIONS_PAGE.NEW }, PERSONAL);
  await settle();
  assert.equal(personal.querySelector("button[aria-label^='Owner: ']") === null, true);
});

/** The groups of the editor's form, by their titles, top to bottom. */
function formGroups(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".automation-form section[aria-labelledby] h2")].map(
    (title) => title.textContent ?? "",
  );
}

test("who owns an automation is the editor's first setting, and nowhere else on its page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.equal(formGroups(page)[0], "Sharing");
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor .automation-owner") === null, true);
  assert.equal(page.querySelector("h1 .automation-owner") === null, true);
});

test("another's personal automation's Owner picker draws its owner unnamed, never as the reader", async () => {
  world.standing = [{ ...DIGEST, mine: false }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id });
  await settle();

  assert.equal(
    picker(page, "Owner").querySelector(".actor-mark")?.getAttribute("data-kind"),
    "someone",
  );
});

test("a personal automation another member made is not called Only you, in its row, its heading, or its Owner picker", async () => {
  const theirs = { ...DIGEST, name: "Their digest", mine: false };
  world.standing = [SWEEP, theirs];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme", "Personal"],
  );
  assert.deepEqual(rows(page).at(-1), ["Their digest", "Personal"]);
  act(() => world.root?.unmount());

  const editor = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: theirs.id });
  await settle();
  assert.equal(picked(editor, "Owner"), "Personal");
});

test("a new agent's MCP servers are a field chip of the owner's connected ones until switched off, the row naming those off, and a switch saves with the task", async () => {
  world.standing = [{ ...SWEEP, mine: true }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const chip = serversChip() ?? assert.fail("the servers chip stands");
  assert.match(page.textContent ?? "", /Every connected MCP server is on\./u);
  assert.equal(chip.querySelectorAll(".ui-provider-mark").length, 2, "Linear's and Sentry's marks");

  act(() => chip.click());
  await settle();

  const sentry = document.querySelector<HTMLButtonElement>(
    "[role=switch][aria-label='Sentry for this agent']",
  );

  assert.ok(sentry, "the agent box's own switches stand");
  act(() => sentry.click());
  assert.match(page.textContent ?? "", /Sentry off\./u);
  assert.equal(chip.querySelectorAll(".ui-provider-mark").length, 1, "Linear's mark alone");
  assert.equal(nameOf(chip), "MCP servers", "marks draw no words, so the field's name stands");

  const linear = document.querySelector<HTMLButtonElement>(
    "[role=switch][aria-label='Linear for this agent']",
  );

  assert.ok(linear, "Linear's switch stands");
  act(() => linear.click());
  assert.equal(nameOf(chip), "MCP servers None", "the name carries the word the chip draws");
  act(() => linear.click());
  assert.equal(nameOf(chip), "MCP servers");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes.at(-1), {
    automationId: SWEEP.id,
    change: { action: { ...SWEEP.action, disabledServers: [INTEGRATION_PROVIDER.SENTRY] } },
  });
});

test("a new agent's MCP servers row claims nothing while the owner's connections are read", async () => {
  world.standing = [{ ...SWEEP, mine: true }];
  world.integrationsHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const reading = [...page.querySelectorAll("[role=status]")].map((each) => each.textContent);
  assert.ok(reading.includes("Reading your connected MCP servers…"), "the row says it is reading");
  assert.doesNotMatch(page.textContent ?? "", /None connected yet\.|Every connected MCP server/u);
  assert.equal(serversChip(page) === undefined, true, "no chip claims None while the read is out");
});

test("a new agent's MCP servers row says a refused read of the owner's connections, and Retry reads them", async () => {
  world.standing = [{ ...SWEEP, mine: true }];
  world.integrationsRefusals = 1;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  await vi.waitFor(() =>
    assert.match(
      page.querySelector("[role=alert]")?.textContent ?? "",
      /Your connected MCP servers could not be read\./u,
    ),
  );
  assert.doesNotMatch(page.textContent ?? "", /None connected yet\./u);

  act(() => button("Retry").click());
  await settle();
  await vi.waitFor(() =>
    assert.match(page.textContent ?? "", /Every connected MCP server is on\./u),
  );
  assert.equal(
    (serversChip() ?? assert.fail("the servers chip stands")).querySelectorAll(".ui-provider-mark")
      .length,
    2,
  );
});

test("another member's automation says which servers its creator switched off, offering no switch of the reader's own", async () => {
  world.standing = [
    {
      ...SWEEP,
      mine: false,
      action: { ...SWEEP.action, disabledServers: [INTEGRATION_PROVIDER.SENTRY, "notion-2"] },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(
    page.textContent ?? "",
    /Its creator's connected MCP servers, but Sentry and Notion \(account 2\) switched off\./u,
  );
  assert.equal(serversChip(page) === undefined, true);
});

test("the Runs panel hides and shows by its toggle and by the side panel's chord, and stays as it was left", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.ok(page.querySelector("aside[aria-label='Runs']"), "it stands at first");

  act(() => button("Hide runs").click());
  assert.equal(page.querySelector("aside[aria-label='Runs']") === null, true);
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const again = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(
    again.querySelector("aside[aria-label='Runs']") === null,
    true,
    "folded as it was left",
  );
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL));
  assert.ok(again.querySelector("aside[aria-label='Runs']"), "⌥⌘B brings it back");
  window.localStorage.clear();
});

test("the Runs panel slides out past the page's right edge as it is hidden, held drawn and out of reach until it has, and slides back in as it is shown", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const pane = () => page.querySelector<HTMLElement>(".automation-runs-pane");
  const motions = playMotions();

  try {
    act(() => button("Hide runs").click());
    const leaving = pane() ?? assert.fail("the panel is held drawn through its slide out");
    assert.ok(leaving.hasAttribute("data-leaving"), "it has left the layout");
    assert.ok(leaving.hasAttribute("inert"), "nothing in it is reached on its way out");
    const exit = motions.played.find((each) => each.element === leaving);
    assert.deepEqual(exit?.keyframes.at(-1), { transform: "translateX(100%)" });

    act(() => exit?.finish());
    assert.equal(pane() === null, true, "it is let go once its slide has played");

    act(() => button("Show runs").click());
    const arriving = pane() ?? assert.fail("it stands again");
    assert.equal(arriving.hasAttribute("data-leaving"), false);
    const entry = motions.played.find((each) => each.element === arriving);
    assert.deepEqual(entry?.keyframes, [{ transform: "translateX(100%)" }, { transform: "none" }]);
  } finally {
    motions.remove();
    window.localStorage.clear();
  }
});

test("the Runs panel's edge resizes it within its bounds, and the width stands on the next page", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const pane = () => document.querySelector<HTMLElement>(".automation-runs-pane");
  const edge = page.querySelector<HTMLElement>("[role=separator][aria-label='Resize runs']");
  assert.ok(edge, "the panel has a resize edge");
  assert.equal(pane()?.style.width, "340px");

  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  assert.equal(pane()?.style.width, "356px", "the arrow away from the panel widens it");
  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  assert.equal(pane()?.style.width, "280px", "Home is its least width");
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(pane()?.style.width, "280px");
  window.localStorage.clear();
});

/** The pill the pointer resting on `element` raises, or nothing where it raises none. */
function pillOver(element: Element): string | undefined {
  restOn(element);
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));

  return pill;
}

test("an automation's toolbar too narrow for its acts' words beside its name folds the way back and Run now to their glyphs, each raising its words in its pill", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const toolbar = page.querySelector(".automation-toolbar") ?? assert.fail("no toolbar");

  const acts = () =>
    ["Automations", "Run now"].map((name) => {
      const press =
        [...toolbar.querySelectorAll("button")].find((each) => each.textContent === name) ??
        assert.fail(`no ${name}`);

      return { name, pill: pillOver(press) };
    });

  // A 760 window's toolbar, past the traffic lights.
  const narrow = layContainersAt({ "automation-toolbar": 570 }, { only: ["./desktop.css"] });

  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", pill: "Automations" },
      { name: "Run now", pill: "Run now" },
    ]);
  } finally {
    narrow.remove();
  }

  const wide = layContainersAt({ "automation-toolbar": 1100 }, { only: ["./desktop.css"] });

  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", pill: undefined },
      { name: "Run now", pill: undefined },
    ]);
  } finally {
    wide.remove();
  }
});

test("a Run now still out is named by what it is doing and refuses another press", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  world.runHeld = true;
  const run = button("Run now");
  act(() => run.click());
  await settle();
  act(() => run.click());
  await settle();

  assert.deepEqual(
    {
      name: run.getAttribute("aria-label"),
      busy: run.getAttribute("aria-busy"),
      runsAsked: world.runsAsked,
    },
    { name: "Starting", busy: "true", runsAsked: [SWEEP.id] },
  );
});

test("a page naming an automation the list does not hold, as a link to another workspace's may, says it is not found and draws nothing of it", async () => {
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "3f0e6f5c-7d1a-4f6e-9a55-999999999999",
  });

  await settle();

  assert.match(
    page.textContent ?? "",
    /Not foundThis automation doesn't exist, or you don't have access to it\./u,
  );
});

test("a page naming an automation the list does not hold keeps its bar, its way back to the list standing in it", async () => {
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "3f0e6f5c-7d1a-4f6e-9a55-999999999999",
  });

  await settle();

  const { banner } = bar(page);
  assert.equal(banner.parentElement?.getAttribute("aria-label"), "Not found");

  const back = [...banner.querySelectorAll("button")].find(
    (each) => each.textContent === "Automations",
  );

  act(() => back?.click());
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("an automation's page opened before the list is read stands its toolbar's way back over its form as quiet blocks", async () => {
  world.listHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const wait = page.querySelector("[role=status][aria-busy=true]");
  assert.equal(wait?.textContent?.startsWith("Reading the automation…"), true);
  assert.ok((wait?.querySelectorAll(".ui-settings-row .ui-skeleton").length ?? 0) > 0);
  assert.match(crumbs(page), /^Automations/u);
  act(() => button("Automations").click());
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("Escape leaves an automation's page still waiting on the list for the list", async () => {
  world.listHeld = true;
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS), "its way out is offered");
  });
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("what is typed while a save is out stands, unsaved, once the save lands", async () => {
  world.heldChanges = [];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => button("Save").click());
  await settle();
  writePrompt(page, "Fix the two flakiest tests.");
  world.heldChanges[0]?.();
  await settle();

  assert.equal(promptEditor(page).textContent, "Fix the two flakiest tests.");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
});

test("with no workspace listed because the workspaces could not be read, the list and a linked automation say so, and Retry reads them again", async () => {
  world.workspacesRefused = true;
  const unread = () => tasksControl({ workspace: undefined });
  const page = mount(unread());
  await settle();
  assert.match(page.textContent ?? "", /The workspaces could not be read\./u);
  assert.equal(page.querySelector("[role=status][aria-busy=true]") === null, true);
  act(() => button("Retry").click());
  await settle();
  assert.equal(world.tasksRefreshes, 1);

  // The read Retry asked for lands, listing the workspace, whose automations are then read.
  render(tasksControl({ workspace: WORKSPACE }));
  await settle();
  assert.deepEqual(listed(), [WORKSPACE.id]);
  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
  assert.ok(rows(page).length > 0, "the workspace's automations are drawn");

  act(() => world.root?.unmount());
  world.root = undefined;
  const linked = mount(unread(), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.match(linked.textContent ?? "", /The workspaces could not be read\./u);
  assert.doesNotMatch(linked.textContent ?? "", /Reading the automation/u);
  act(() => button("Retry").click());
  await settle();
  assert.equal(world.tasksRefreshes, 2);
});

test("an automation's page whose list could not be read says so with Retry, rather than calling it gone", async () => {
  world.listRefusals = 1;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /The automations could not be read\./u);
  assert.doesNotMatch(page.textContent ?? "", /gone/u);
  act(() => button("Retry").click());
  await settle();

  await vi.waitFor(() =>
    assert.equal(
      page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
      SWEEP.name,
    ),
  );
});

test("a new automation's page moved to another workspace starts afresh in that workspace's repository", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");

  act(() => world.moveTo({ ...WORKSPACE, id: "workspace-beta", name: "Beta" }));
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Beta triage");
  writePrompt(page, "Triage Beta's issues.");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(world.creates.length, 1);
  assert.deepEqual(
    [world.creates[0]?.workspaceId, world.creates[0]?.repositories],
    ["workspace-beta", ["beta/app"]],
  );
});

test("an automation fired by an event says its trigger in one sentence, and a save of its task leaves the trigger so", async () => {
  const onEvent = automation(7, {
    name: "Triage new bugs",
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "issue-opened", labels: ["bug"] },
  });

  world.standing = [onEvent];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: onEvent.id });
  await settle();

  assert.equal(
    pickerDetail(page, "Type"),
    "When an issue by people is opened in acme/ledger labeled bug",
  );
  assert.equal(picked(page, "Event"), "Issue opened");
  assert.equal(page.querySelector("button[aria-label^='Time zone: ']") === null, true);
  writePrompt(page, "Reproduce the bug first.");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    {
      automationId: onEvent.id,
      change: {
        action: { ...onEvent.action, prompt: "Reproduce the bug first.", disabledServers: [] },
      },
    },
  ]);
});

test("Escape keeps a new page whose schedule was changed, though nothing was typed", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Runs", "Daily");
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));

  assert.equal(world.places.length, 1);
});

/** A new automation's page, named and given its prompt, ready to have its schedule picked. */
async function mountNewScheduled(): Promise<HTMLElement> {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Weekly sweep");
  writePrompt(page, "Update the dependencies.");

  return page;
}

test("a schedule repeated weekly is saved on Monday at nine, as its day and time are first drawn", async () => {
  const page = await mountNewScheduled();
  pick(page, "Runs", "Weekly");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(world.creates.at(-1)?.trigger, {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: "0 9 * * 1",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

/** Lists the workspace with Memory on, as its admin turned it on. */
function memoryOn(): void {
  world.remembering = true;
  world.deliverTasks(tasksView());
}

/** The button of the suggestion named under the list, none where it is not suggested. */
function suggestion(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll<HTMLButtonElement>("[aria-label='Suggested'] button")].find(
    (each) => each.textContent?.startsWith(name),
  );
}

test("Memory digest is suggested under the list, and under an empty one, only while the workspace has Memory on", async () => {
  const off = mount();
  await settle();
  assert.equal(suggestion(off, "Memory digest"), undefined);
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  memoryOn();
  const full = mount();
  await settle();
  assert.equal(automationRows(full).length, 3);
  assert.ok(suggestion(full, "Memory digest"));
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  world.standing = [];
  const empty = mount();
  await settle();
  assert.match(empty.textContent ?? "", /No automations yet\./u);
  assert.ok(suggestion(empty, "Memory digest"));
});

test("Memory digest is suggested no more once the list holds the reader's own or a workspace automation made from it, whatever its name, and still beside a teammate's personal one or one merely named for it", async () => {
  memoryOn();

  for (const { held, suggested } of [
    {
      held: { name: "Weekly memories", preset: AUTOMATION_PRESET.MEMORY_DIGEST, mine: true },
      suggested: false,
    },
    {
      held: { name: "Their memories", preset: AUTOMATION_PRESET.MEMORY_DIGEST, mine: false },
      suggested: true,
    },
    { held: { name: "Memory digest", mine: true }, suggested: true },
  ]) {
    world.standing = [SWEEP, automation(4, { ...held, scope: AUTOMATION_SCOPE.PERSONAL })];
    const page = mount();
    await settle();

    assert.equal(automationRows(page).length, 2);
    assert.equal(suggestion(page, "Memory digest") !== undefined, suggested, held.name);
    act(() => world.root?.unmount());
    document.body.innerHTML = "";
  }
});

test("a new automation started from Memory digest is made every Monday at nine in the member's zone, in no repository, archiving its finished runs", async () => {
  memoryOn();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() => suggestion(page, "Memory digest")?.click());
  await settle();
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Memory digest",
  );
  act(() => button("Create automation").click());
  await settle();

  const made = world.creates[0];
  assert.ok(made, "the automation is made");
  assert.deepEqual(
    {
      name: made.name,
      trigger: made.trigger,
      repositories: made.repositories,
      archiveSuccessful: made.archiveSuccessful,
      target: made.target,
      preset: made.preset,
    },
    {
      name: "Memory digest",
      trigger: {
        kind: AUTOMATION_TRIGGER.SCHEDULE,
        cron: "0 9 * * 1",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      repositories: [],
      archiveSuccessful: true,
      target: { kind: AUTOMATION_TARGET.NEW_AGENT },
      preset: AUTOMATION_PRESET.MEMORY_DIGEST,
    },
  );
  assert.match(made.action.prompt, /forget_memory/u);
});

/** The listed workspace as one of its admins reads it, who may connect its integrations. */
const ADMINISTERED = { ...WORKSPACE, role: WORKSPACE_ROLE.ADMIN };

/** The workspace's Sentry once an install landed on it. */
const SENTRY_INSTALLED = {
  configured: true,
  installations: [{ installationId: "a1b2c3d4-0000-4000-8000-000000000002" }],
};

test("Investigate Sentry alerts asks for Sentry while the workspace has none, Connect for an admin and whom to ask for a member, and stands as any suggestion once it is connected", async () => {
  world.sentryRead = { configured: true, installations: [] };
  const member = mount();
  await settle();
  const asked = suggestion(member, "Investigate Sentry alerts");
  assert.match(asked?.textContent ?? "", /Ask an owner or admin to connect Sentry$/u);
  assert.equal(asked?.disabled, true, "a member cannot connect it");
  act(() => world.root?.unmount());
  document.body.innerHTML = "";
  // A window of its own follows the workspace's integrations afresh.
  world.integrationsFollowed.clear();

  const admin = mount(tasksControl({ workspace: ADMINISTERED }));
  await settle();
  assert.match(
    suggestion(admin, "Investigate Sentry alerts")?.textContent ?? "",
    /Connect Sentry$/u,
  );

  world.sentryRead = SENTRY_INSTALLED;
  act(() => layIntegrations(ADMINISTERED.id));
  await settle();
  const connected = suggestion(admin, "Investigate Sentry alerts");
  assert.doesNotMatch(connected?.textContent ?? "", /Connect Sentry|Ask an owner/u);
  assert.equal(connected?.disabled, false);
});

test("a new automation started from Triage a red main or Investigate Sentry alerts is made with its preset and trigger, the workspace's, Sentry connected first where its card asked for it", async () => {
  world.sentryRead = { configured: true, installations: [] };
  const triage = mountPages({ kind: AUTOMATIONS_PAGE.LIST }, ADMINISTERED);
  await settle();
  act(() => suggestion(triage, "Triage a red main")?.click());
  await settle();
  act(() => button("Create automation").click());
  await settle();
  act(() => world.root?.unmount());
  document.body.innerHTML = "";
  world.integrationsFollowed.clear();

  const investigate = mountPages({ kind: AUTOMATIONS_PAGE.LIST }, ADMINISTERED);
  await settle();
  act(() => suggestion(investigate, "Investigate Sentry alerts")?.click());
  await settle();
  assert.deepEqual(world.sentryInstalls, [ADMINISTERED.id], "its press starts the install");
  world.sentryRead = SENTRY_INSTALLED;
  act(() => layIntegrations(ADMINISTERED.id));
  await settle();
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(
    world.creates.map((made) => ({
      preset: made.preset,
      trigger:
        made.trigger.kind === AUTOMATION_TRIGGER.GITHUB
          ? {
              kind: made.trigger.kind,
              event: made.trigger.event,
              branches: made.trigger.branches,
              defaultBranch: made.trigger.defaultBranch,
            }
          : made.trigger,
      scope: made.scope,
      target: made.target,
      repositories: made.repositories?.length,
    })),
    [
      {
        preset: AUTOMATION_PRESET.RED_MAIN_TRIAGE,
        trigger: {
          kind: AUTOMATION_TRIGGER.GITHUB,
          event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
          branches: undefined,
          defaultBranch: true,
        },
        scope: AUTOMATION_SCOPE.WORKSPACE,
        target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null },
        repositories: 1,
      },
      {
        preset: AUTOMATION_PRESET.SENTRY_ALERT_INVESTIGATION,
        trigger: {
          kind: AUTOMATION_TRIGGER.INTEGRATION,
          provider: TRIGGER_PROVIDER.SENTRY,
          event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
        },
        scope: AUTOMATION_SCOPE.WORKSPACE,
        target: { kind: AUTOMATION_TARGET.NEW_AGENT },
        repositories: 1,
      },
    ],
  );
});

/** The Nightly sweep's page, standing on a schedule of Wednesdays at 07:30 Tokyo time. */
async function mountWeeklySweep(): Promise<HTMLElement> {
  world.standing = [
    {
      ...SWEEP,
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "30 7 * * 3", timezone: "Asia/Tokyo" },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  return page;
}

test("a weekly schedule's day picked is saved, with its time and zone as they stood", async () => {
  const page = await mountWeeklySweep();
  pick(page, "Day", "Monday");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "30 7 * * 1", timezone: "Asia/Tokyo" },
    },
  });
});

test("a schedule's time is written as its summary says it, and a time that cannot be read is marked and changes nothing", async () => {
  const page = await mountWeeklySweep();

  const field = () =>
    page.querySelector<HTMLInputElement>("input[aria-label='Time']") ?? assert.fail("no time");

  assert.equal(field().value, "7:30 AM");
  assert.match(page.textContent ?? "", /Wednesdays? at 7:30 AM/u);

  assert.equal(button("Save").disabled, true, "nothing is written yet");
  type(field(), "soon");
  assert.equal(button("Save").disabled, false, "words that are no time are unsaved work");

  // Note that "2" reads as 2:00 AM and moves the schedule before the colon after it makes the words unreadable.
  type(field(), "2");
  type(field(), "2:");
  assert.equal(field().getAttribute("aria-invalid"), "true");
  const saves = world.changes.length;
  act(() => button("Save").click());
  await settle();
  assert.equal(world.changes.length, saves, "no save runs over a time that cannot be read");
  assert.match(page.textContent ?? "", /Write the time as 2:00 AM\./u);
  type(field(), "6:45 PM");
  assert.equal(field().getAttribute("aria-invalid"), null);
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "45 18 * * 3", timezone: "Asia/Tokyo" },
    },
  });
});

test("a weekly schedule's time typed is saved, with its day and zone as they stood", async () => {
  const page = await mountWeeklySweep();
  type(page.querySelector("input[aria-label='Time']"), "18:45");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "45 18 * * 3", timezone: "Asia/Tokyo" },
    },
  });
});

test("a schedule's time zone is saved as searched for and picked", async () => {
  const page = await mountNewScheduled();
  act(() => picker(page, "Time zone").click());
  type(document.querySelector("input[placeholder='Search time zones']"), "Tokyo");
  act(() => {
    [...document.querySelectorAll<HTMLButtonElement>("[role=option]")]
      .find((each) => each.textContent?.includes("Asia/Tokyo"))
      ?.click();
  });
  assert.equal(picked(page, "Time zone"), "Asia/Tokyo");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(world.creates.at(-1)?.trigger, {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: "0 9 * * 1-5",
    timezone: "Asia/Tokyo",
  });
});

test("a custom cron is saved as written, in the zone the schedule already had", async () => {
  const page = await mountWeeklySweep();
  pick(page, "Runs", "Custom");
  type(page.querySelector("input[aria-label='Cron']"), "15 2 * * 1-5");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "15 2 * * 1-5", timezone: "Asia/Tokyo" },
    },
  });
});

test("Escape while writing the prompt lets go of the caret and reaches the window marked taken, composing or not", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  writePrompt(page, "Triage the issues opened overnight.");
  const prompt = promptEditor(page);
  act(() => prompt.focus());

  const reached: boolean[] = [];
  const listen = (event: KeyboardEvent) => reached.push(event.defaultPrevented);
  window.addEventListener("keydown", listen);

  const pressEscape = (init: KeyboardEventInit) =>
    act(() => {
      prompt.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }),
      );
    });

  pressEscape({ isComposing: true });
  assert.equal(
    document.activeElement === prompt,
    true,
    "the input method's cancel keeps the caret",
  );
  pressEscape({});
  window.removeEventListener("keydown", listen);

  // Note that both reach the window, whose live call Escape stops first, marked taken, so neither leaves the page.
  assert.deepEqual(reached, [true, true]);
  assert.equal(document.activeElement === prompt, false);
  assert.equal(prompt.textContent, "Triage the issues opened overnight.");
});

test("a new automation with no repository is created to work in none, but not on a GitHub event, whose refusal describes the repository chip", async () => {
  world.noRecent = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  writePrompt(page, "Triage the issues opened overnight.");
  pick(page, "Type", "GitHub event");
  act(() => button("Create automation").click());
  await settle();

  const refusal = "Choose the repository whose events start it.";
  assert.equal(
    world.creates.length,
    0,
    "nothing on a GitHub event is created without a repository",
  );
  assert.ok(announced(refusal), "the refusal is announced");

  const chip =
    page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip") ??
    assert.fail("no repository chip");

  const ids = chip.getAttribute("aria-describedby")?.split(" ") ?? [];
  assert.ok(
    ids.some((id) => document.getElementById(id)?.textContent === refusal),
    "the refusal describes the chip it is about",
  );
  assert.equal(chip.getAttribute("aria-invalid"), "true");

  pick(page, "Type", "Schedule");
  act(() => button("Create automation").click());
  await settle();
  assert.deepEqual(
    world.creates[0]?.repositories,
    [],
    "a schedule is created to work in no repository",
  );
});

test("the repository chosen first is not said again among the others its runs work in", async () => {
  const several = automation(8, {
    name: "Cross-repo sweep",
    repositories: ["acme/ledger", "acme/web"],
  });

  world.standing = [several];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: several.id });
  await settle();
  assert.match(page.textContent ?? "", /also work in acme\/web\./u);

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => optionWords("webacme").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /also work in/u);
});

test("runs land in a new agent on the account's default until a model is chosen, and archiving successful runs is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /Your default, until you choose one\./u);
  act(() => button("Archive finished runs").click());
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    { automationId: SWEEP.id, change: { archiveSuccessful: true } },
  ]);
});

test("an agent the workspace's list no longer holds stays the pick it was saved as, and can be picked again after another", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

  const following = automation(10, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });

  world.standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();
  assert.equal(picked(page, "Agent"), "An agent no longer listed");

  pick(page, "Agent", "CI digest");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
  pick(page, "Agent", "An agent no longer listed");

  assert.equal(picked(page, "Agent"), "An agent no longer listed");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
});

test("the agent a same-agent automation was saved with is named as the task list carries it once the newest no longer hold it", async () => {
  const older = onLedger({
    ...CI_DIGEST,
    id: "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d90",
    title: "Onboarding analysis",
  });

  world.workspaceAgents = [
    ...Array.from({ length: AGENT_BOUNDS.MAX_WORKSPACE_AGENTS }, (_, at) =>
      onLedger({
        ...CI_DIGEST,
        id: `8c1a6a4f-3d2e-4d8b-8b66-${String(at).padStart(12, "0")}`,
        createdAt: 2 + at,
      }),
    ),
    older,
  ];

  const following = automation(10, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: older.id },
  });

  world.standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();

  assert.equal(picked(page, "Agent"), "Onboarding analysis");
});

test("the agent a same-agent automation was saved with is not offered once its repository is changed", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

  const following = automation(11, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });

  world.standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => optionWords("webacme").click());
  await settle();
  assert.equal(picked(page, "Agent"), "Started by its first run");
  act(() => picker(page, "Agent").click());

  assert.deepEqual(
    [...document.querySelectorAll("[role=option] .ui-combobox-option-label")].map(
      (name) => name.textContent,
    ),
    ["Started by its first run"],
  );
});

test("Same agent saves with none chosen, its first run starting one, or with one chosen from the workspace's agents on the automation's repository", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Runs land in", "Same agent");
  await settle();
  assert.ok(
    pickerDescription(page, "Agent").some((words) =>
      words?.includes("Every later run is sent to it"),
    ),
    "the Agent picker says later runs go to the first run's agent",
  );
  act(() => button("Save").click());
  await settle();

  pick(page, "Agent", "CI digest");
  assert.equal(picked(page, "Agent"), "CI digest");
  act(() => button("Save").click());
  await settle();
  // A picked agent is let go again, for the next run to start one.
  pick(page, "Agent", "Started by its first run");
  assert.equal(picked(page, "Agent"), "Started by its first run");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null } },
    },
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: CI_DIGEST.id } },
    },
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null } },
    },
  ]);
});

/** Whether the picker named wears a glyph before its name, a chip's chevron not being one. */
function chipWearsGlyph(page: HTMLElement, label: string): boolean {
  return picker(page, label).querySelector(".ui-chip-name")?.previousElementSibling != null;
}

/** The Agent picker's rows, each as its glyph, its name, and its detail beside it, and the marks at its end. */
function agentRows(): {
  glyph: boolean;
  name: string | null;
  detail: string | null;
  ends: (string | null)[];
}[] {
  return [...document.querySelectorAll("[role=option]")].map((option) => ({
    glyph:
      option.querySelector(".ui-combobox-option-glyph svg, .ui-combobox-option-glyph img") !== null,
    name: option.querySelector(".ui-combobox-option-label")?.textContent ?? null,
    detail: option.querySelector(".ui-combobox-option-detail")?.textContent ?? null,
    // Note that the hint's marks stand inside the replay mark its menu draws them under, so a mark is a child of that mark, or of the hint where none stands.
    ends: [...(option.querySelector(".ui-combobox-option-hint")?.children ?? [])]
      .flatMap((mark) =>
        mark.matches("[data-replay-mask], [data-replay-unmask]") ? [...mark.children] : [mark],
      )
      .map((mark) => mark.getAttribute("aria-label")),
  }));
}

test("the Agent picker draws each agent as every agent menu does: its glyph, its name, its task, and the failed mark where its turn failed, the chip wearing the chosen agent's glyph and name", async () => {
  const BROKEN = {
    ...CI_DIGEST,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b22",
    title: "Nightly sweep",
    status: "failed",
  } as const;

  world.workspaceAgents = [onLedger(BROKEN), onLedger(CI_DIGEST)];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  assert.equal(picked(page, "Agent"), "Started by its first run");
  assert.equal(
    chipWearsGlyph(page, "Agent"),
    false,
    "no agent is chosen, so the chip wears no glyph",
  );

  act(() => picker(page, "Agent").click());
  assert.deepEqual(agentRows(), [
    { glyph: false, name: "Started by its first run", detail: null, ends: [] },
    { glyph: true, name: "Nightly sweep", detail: "Another task", ends: ["Failed"] },
    { glyph: true, name: "CI digest", detail: "Another task", ends: [] },
  ]);

  const row = [...document.querySelectorAll<HTMLElement>("[role=option]")][2];
  assert.ok(row, "the menu lists the second agent");
  act(() => row.click());
  assert.equal(picked(page, "Agent"), "CI digest");
  assert.equal(chipWearsGlyph(page, "Agent"), true, "the chip wears the chosen agent's glyph");
});

test("the Agent picker offers the workspace's unarchived agents on the automation's repository, newest first, its case aside", async () => {
  const named = (id: string, title: string, createdAt: number) =>
    onLedger({ ...CI_DIGEST, id: `8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3c${id}`, title, createdAt });

  world.workspaceAgents = [
    named("01", "Ledger cleanup", 2),
    { ...named("02", "Shouting ledger", 3), repository: "Acme/Ledger" },
    { ...named("03", "Archived digest", 4), archivedAt: 5 },
    { ...named("04", "Web checks", 4), repository: "acme/web" },
    { ...named("05", "Another workspace's", 4), workspaceId: "workspace-other" },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  assert.deepEqual(
    agentRows().map((row) => row.name),
    ["Started by its first run", "Shouting ledger", "Ledger cleanup"],
  );
});

test("the Agent picker's rows each hang their agent's card while the pointer rests on them", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  // The first row chooses none, so the agent's is the second.
  restOn(document.querySelectorAll("[role=option]")[1] ?? assert.fail("the menu lists the agent"));
  const card = document.querySelector(".ui-tooltip-card") ?? assert.fail("the row hangs a card");
  assert.equal(card.querySelector(".ui-hover-card-name")?.textContent, "CI digest");
});

test("a word typed in the Agent picker asks the service for the repository's agents it names, so one past the newest is found, chosen, kept named, and saved", async () => {
  const OLDER = {
    ...CI_DIGEST,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b23",
    title: "Seat limits",
  } as const;

  world.agentsFound = (words) => (words === "seat" ? [OLDER] : []);
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    "seat",
  );
  await vi.waitFor(() =>
    assert.deepEqual(
      agentRows().map((row) => row.name),
      ["Seat limits"],
    ),
  );
  assert.deepEqual(world.agentsAsked.at(-1), {
    workspaceId: WORKSPACE.id,
    repository: "acme/ledger",
    words: "seat",
  });

  act(() => (document.querySelector<HTMLElement>("[role=option]") ?? assert.fail("found")).click());
  await settle();
  assert.equal(picked(page, "Agent"), "Seat limits");
  act(() => button("Save").click());
  await settle();
  assert.deepEqual(world.changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: OLDER.id } },
    },
  ]);
});

test("a word typed in the Agent picker keeps the newest agents whose rows hold it, so one named by its model stays where the service matches no model", async () => {
  const UNTITLED = { ...CI_DIGEST, title: null, createdAt: 2 } as const;
  world.workspaceAgents = [
    onLedger(UNTITLED),
    onLedger({ ...CI_DIGEST, id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b27" }),
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());
  const [, named] = agentRows();
  assert.ok(named?.name, "the untitled agent is drawn under a name of its own");

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    named.name.toLowerCase(),
  );
  await settle();

  assert.deepEqual(
    agentRows().map((row) => row.name),
    [named.name],
  );
});

test("the agent a same-agent automation was saved with, once the list no longer holds it, is left out of a search's results and offered again once the search is cleared", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8f";

  const following = automation(11, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });

  world.standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();
  act(() => picker(page, "Agent").click());
  const names = () => agentRows().map((row) => row.name);
  assert.deepEqual(names(), ["Started by its first run", "An agent no longer listed", "CI digest"]);

  const search = () =>
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input');

  type(search(), "ci");
  await settle();
  assert.deepEqual(names(), ["CI digest"]);
  type(search(), "");
  await settle();

  assert.deepEqual(names(), ["Started by its first run", "An agent no longer listed", "CI digest"]);
});
