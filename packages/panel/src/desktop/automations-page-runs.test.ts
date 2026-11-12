// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AUTOMATION_CALL_FAILURE } from "@repo/features/automation-view";
import {
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import {
  SENTRY_LEVEL,
  SENTRY_TRIGGER_EVENT,
  TRIGGER_PROVIDER,
} from "@repo/features/trigger-catalog";
import { PROFILE } from "@repo/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished, test, vi } from "vitest";
import { useAutomationsRoute } from "../automations-route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../tasks/automations-place.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  announced,
  automation,
  button,
  CI_DIGEST,
  copiedShown,
  copyFieldValue,
  DIGEST,
  FAILING,
  glyphs,
  isOn,
  layStanding,
  MADE_SECRET,
  menuItem,
  mount,
  mountPages,
  PERSONAL,
  phoneRuns,
  pick,
  picked,
  picker,
  pickerDescription,
  pickerDetail,
  ROTATED_SECRET,
  routerAt,
  rowOf,
  runRows,
  SWEEP,
  says,
  settle,
  switchNamed,
  type,
  WORKSPACE,
  world,
  writePrompt,
} from "../testing/automations-page.js";
import { pressInComposer, typeInComposer } from "../testing/composer.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { testQueryClientNow, withQueryClient } from "../testing/copy-feedback.js";
import { longPress, underAFinger } from "../testing/finger.js";
import { pixelsOf, wayBackGap } from "../testing/laid-length.js";
import { tasksControl } from "../testing/tasks-control.js";
import { appStateIn } from "../use-app-state.js";
import { AutomationsPage } from "./automations-page.js";

/**
 * automations-page-runs.test.ts -- an automation's runs and the Runs tab, the models it may run on, its GitHub, webhook, and Sentry triggers, its menus and links, and the page on a narrow stage and a phone.
 *
 * The window, its fakes, and the helpers both files read stand in `testing/automations-page.ts`.
 */

test("a run whose agent works on a task opens the agent on its task, its tab chosen, not its own page", async () => {
  const taskId = "0f6a2c4e-8b1d-4f3a-9c5e-7d2b4a6c8e10";
  world.liveAgents = [
    { ...CI_DIGEST, planId: taskId, workspaceId: WORKSPACE.id, repository: null },
  ];
  world.runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "completed" },
      firedAt: 3,
      settledAt: 3,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => runRows(page)[0]?.querySelector("button")?.click());
  assert.deepEqual(world.agentsShown, [`${taskId} ${CI_DIGEST.id}`]);
  assert.deepEqual(world.agentsOpened, []);
});

test("an automation's runs stand on its page's right, newest first, a run that started an agent opening it", async () => {
  world.runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 3,
      settledAt: 3,
    },
    {
      id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const [started, refused] = runRows(page);
  assert.match(started?.textContent ?? "", /^Fix the flaky testJan 1, 1970Working/u);
  assert.match(
    refused?.textContent ?? "",
    /^Scheduled runJan 1, 1970Its creator is no longer in the workspace\./u,
  );
  act(() => started?.querySelector("button")?.click());
  assert.deepEqual(world.agentsOpened, [CI_DIGEST.id]);
  // The window comes back to the automation from its agent's page, as Back takes it.
  act(() => world.sendTo({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id }));
  await settle();
  const unstarted = runRows(page)[1]?.querySelector<HTMLButtonElement>(".ui-list-row-main");
  assert.equal(unstarted?.tagName, "BUTTON", "a run that started no agent is a press too");
  act(() => unstarted?.click());
  assert.ok(
    document.activeElement?.querySelector("input[aria-label='Automation name']"),
    "it opens the automation's setup beside it, handing it the keyboard",
  );
});

test("the Runs tab lists every automation's runs, each naming its automation, narrowed to the running or the failed", async () => {
  world.standing = [SWEEP, DIGEST];
  world.workspaceRuns = [
    {
      id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 3,
      settledAt: 3,
      automation: { id: SWEEP.id, name: SWEEP.name },
    },
    {
      id: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
      automation: { id: DIGEST.id, name: DIGEST.name },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const choiceOf = (words: string) =>
    [...page.querySelectorAll<HTMLElement>("[role=radio]")].find(
      (each) => each.querySelector(".ui-choice-bar-label")?.textContent === words,
    );

  const choose = (words: string) => {
    const found = choiceOf(words);
    assert.ok(found, `no choice ${words}`);
    act(() => found.click());
  };

  choose("Runs");
  await settle();

  const listedRuns = () =>
    [...page.querySelectorAll("ul[aria-label='Runs'] li")].map((row) => row.textContent ?? "");

  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.RUNS });
  assert.equal(listedRuns().length, 2);
  assert.deepEqual(
    ["Runs", "All", "Running", "Failed"].map((words) => choiceOf(words)?.textContent),
    ["Runs1", "All", "Running1", "Failed1"],
    "the Runs tab counts what runs, and Running and Failed what each keeps",
  );
  assert.match(
    listedRuns()[0] ?? "",
    /^Fix the flaky testJan 1, 1970Nightly flaky-test sweep · Working/u,
  );
  assert.match(listedRuns()[1] ?? "", /^Scheduled runJan 1, 1970Morning digest · /u);
  choose("Failed");
  assert.deepEqual(
    listedRuns().map((row) => row.startsWith("Scheduled run")),
    [true],
  );
  choose("Running");
  assert.deepEqual(
    listedRuns().map((row) => row.startsWith("Fix the flaky test")),
    [true],
  );
  act(() => page.querySelector<HTMLButtonElement>("ul[aria-label='Runs'] li button")?.click());
  assert.deepEqual(world.agentsOpened, [CI_DIGEST.id]);
});

test("on the Runs tab a run that started no agent and names no subject opens its automation", async () => {
  world.standing = [SWEEP, DIGEST];
  world.workspaceRuns = [{ ...UNSTARTED_RUN, automation: { id: DIGEST.id, name: DIGEST.name } }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.RUNS });
  await settle();

  act(() => page.querySelector<HTMLElement>("ul[aria-label='Runs'] .ui-list-row-main")?.click());
  assert.deepEqual(world.places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id });
});

test("under a finger no run draws a ⋯, and a long press opens its menu", async () => {
  underAFinger();
  world.standing = [SWEEP, DIGEST];
  world.workspaceRuns = [
    { ...SWEEP_RUN, automation: { id: SWEEP.id, name: SWEEP.name } },
    { ...UNSTARTED_RUN, automation: { id: DIGEST.id, name: DIGEST.name } },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.RUNS });
  await settle();

  const presses = [
    ...page.querySelectorAll<HTMLElement>("ul[aria-label='Runs'] .ui-list-row-main"),
  ];

  assert.equal(presses.length, 2);
  assert.ok(page.querySelector("button[aria-label='Run actions']") === null, "no run draws a ⋯");
  const [, unstarted] = presses;
  assert.ok(unstarted);
  longPress(unstarted);
  assert.ok(menuItem("Copy link"), "the long press opens the run's menu");
});

test("an automation's runs stand as quiet rows under the panel's heading while they are first read", async () => {
  world.runsHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const wait = page.querySelector("aside[aria-label='Runs'] [role=status]");
  assert.equal(wait?.textContent, "Reading its runs…");
  assert.ok((wait?.querySelectorAll(".ui-list-row .ui-skeleton").length ?? 0) > 0);
});

test("Run now starts a run under a key of its own, and the run stands first once it is laid", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.match(
    page.querySelector("aside[aria-label='Runs'] .ui-empty-state")?.textContent ?? "",
    /^No runs yet\.$/u,
    "the panel with no run stands the empty state",
  );

  act(() => button("Run now").click());
  await settle();
  layStanding();
  await settle();

  assert.deepEqual(world.runsAsked, [SWEEP.id]);
  await vi.waitFor(() => assert.match(runRows(page)[0]?.textContent ?? "", /^Run now/u));
});

test("a Run now the service refuses says why under the name, and a new automation has no Run now", async () => {
  world.runRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Run now").click());
  await settle();
  assert.equal(
    page.querySelector("[role='alert']")?.textContent,
    "Only its creator, or the workspace's owners and admins, can run it.",
  );
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const fresh = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.ok(![...fresh.querySelectorAll("button")].some((each) => each.textContent === "Run now"));
  assert.match(fresh.textContent ?? "", /No runs yet\./u);
});

test("a Run now refused while a save is out leaves the save's check to land, and its own refusal standing", async () => {
  world.heldChanges = [];
  world.runRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  // The check's motion never finishes, so a check that landed stands to be read.
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.classList.contains("ui-button-done") ? [new EventTarget()] : [];
    },
  });
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  });
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  const save = button("Save");

  act(() => save.click());
  await settle();
  act(() => button("Run now").click());
  await settle();
  world.heldChanges[0]?.();
  await settle();

  assert.ok(save.querySelector(".ui-button-done"), "Save shows its check");
  assert.equal(
    page.querySelector("[role='alert']")?.textContent,
    "Only its creator, or the workspace's owners and admins, can run it.",
  );
});

/** A run of the sweep that started the CI digest agent, which a press on its row opens. */
const SWEEP_RUN = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
  status: AUTOMATION_RUN_STATUS.STARTED,
  reason: null,
  agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
  firedAt: 3,
  settledAt: 3,
} as const;

/** A run that started no agent and names no subject, so has nothing of its own to open. */
const UNSTARTED_RUN = {
  id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
  status: AUTOMATION_RUN_STATUS.FAILED,
  reason: "creator-left",
  agent: null,
  firedAt: 2,
  settledAt: 2,
} as const;

test("opening a run's agent with unsaved changes asks first, and Leave opens it", async () => {
  world.runs = [SWEEP_RUN];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");

  act(() => runRows(page)[0]?.querySelector("button")?.click());
  await settle();
  assert.deepEqual(world.agentsOpened, []);
  act(() => button("Leave").click());
  await settle();

  assert.deepEqual(world.agentsOpened, [CI_DIGEST.id]);
});

test("a default model that could not be read is said as unknown, and a model can still be chosen", async () => {
  world.defaultRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  // Note that the default reads as failed once the preferences' failure reaches their query.
  await vi.waitFor(() =>
    assert.match(
      page.textContent ?? "",
      /It runs on your default model, which could not be read\./u,
    ),
  );
  assert.equal(
    page.querySelector(".agent-model-chip") === null,
    true,
    "no model is drawn as the default",
  );
  // Note that the menu is hung from the chip by its laid-out boxes, which jsdom draws none of.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("automation-model-picker"))
      return DOMRect.fromRect({ x: 200, y: 400, width: 120, height: 24 });

    if (this.classList.contains("ui-anchored-popover"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 300 });

    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  const readsBefore = world.catalogReads;
  act(() => button("Choose a model").click());
  await settle();

  assert.ok(page.querySelector(".ui-searchable-menu"), "the model menu opens");
  assert.equal(
    world.catalogReads,
    readsBefore,
    "opening it draws the catalog the host holds, asking nothing",
  );
  assert.equal(
    page.querySelector(".automation-editor-status")?.textContent,
    "Saved",
    "opening the menu chooses nothing",
  );
});

test("the reader's own automation says a model nothing of theirs pays for cannot run, while a teammate's, run on its maker's connections, says nothing of it", async () => {
  world.catalogUnconnected = true;
  world.standing = [DIGEST, SWEEP];

  /** The pinned rows of the Model row's menu and its last line, on the automation given. */
  const footOn = async (automationId: string): Promise<string> => {
    const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId });
    await settle();
    const chip = page.querySelector<HTMLButtonElement>(".agent-model-chip button");
    assert.ok(chip, "the Model row draws the default's chip");
    act(() => chip.click());
    await settle();

    return [...page.querySelectorAll(".ui-searchable-menu-foot, .ui-searchable-menu-last-line")]
      .map((block) => block.textContent ?? "")
      .join("");
  };

  assert.match(await footOn(DIGEST.id), /Opus 5\.5 cannot run until you connect a Claude plan/u);
  const teammates = await footOn(SWEEP.id);
  assert.match(teammates, /Effort/u, "the menu is open on its pinned rows");
  assert.doesNotMatch(teammates, /cannot run|Connect/u);
});

test("a GitHub automation's row says its trigger as one sentence, naming the repository it is heard in", async () => {
  world.standing = [
    automation(9, {
      name: "Code review",
      trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "pull-request-updated" },
    }),
  ];
  const page = mount();
  await settle();

  assert.ok(
    says(
      rowOf(page, "Code review"),
      "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
    ),
  );
});

test("a new automation set to a GitHub event takes its settings as switches in the Trigger card, is created on them, and the list's row says it too", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "GitHub event");
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
  );
  act(() => switchNamed("From Vespin's agents").click());
  assert.equal(isOn("Skip drafts"), true);
  assert.equal(isOn("Include forks"), false);
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people or Vespin's agents is opened, marked ready, or pushed to in acme/ledger",
  );
  type(page.querySelector("input[aria-label='Automation name']"), "Code review");
  writePrompt(page, "Review this pull request.");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(world.creates[0]?.trigger, {
    kind: AUTOMATION_TRIGGER.GITHUB,
    event: "pull-request-updated",
    senders: ["people", "app-agents"],
    moments: ["opened", "ready", "pushed"],
    drafts: false,
    forks: false,
  });
  act(() => button("Automations").click());
  await settle();
  assert.ok(
    says(
      rowOf(page, "Code review"),
      "When a pull request by people or Vespin's agents is opened, marked ready, or pushed to in acme/ledger",
    ),
  );
});

test("a schedule Vespin cannot read is not created, and the refusal is announced under its row", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Nightly sweep");
  writePrompt(page, "Sweep the stale branches.");
  pick(page, "Repeats", "Custom");
  type(page.querySelector("input[aria-label='Cron']"), "every night");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(world.creates, []);
  assert.ok(announced("That isn't a schedule Vespin can read."), "the refusal is announced");
  assert.ok(
    !pickerDescription(page, "Type").includes("That isn't a schedule Vespin can read."),
    "the refusal stands under the cron's row, not the trigger's",
  );
  const cron = page.querySelector("input[aria-label='Cron']");
  const describedBy = cron?.getAttribute("aria-describedby")?.split(" ") ?? [];
  assert.ok(
    describedBy.some(
      (id) => document.getElementById(id)?.textContent === "That isn't a schedule Vespin can read.",
    ),
    "the refusal describes the Cron field it is about",
  );
  assert.equal(cron?.getAttribute("aria-invalid"), "true", "the Cron field says it is wrong");

  type(page.querySelector("input[aria-label='Cron']"), "0 2 * * *");
  await settle();
  assert.ok(!announced("That isn't a schedule Vespin can read."), "the refusal is gone");
  assert.equal(
    page.querySelector("input[aria-label='Cron']")?.getAttribute("aria-invalid"),
    null,
    "the Cron field no longer says it is wrong",
  );
});

test("a webhook made in the window shows its secret once, with Copy kept out of the app state, and gone once Done is pressed", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  writePrompt(page, "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();

  const field = copyFieldValue(page, "secret");
  assert.equal(field?.textContent, MADE_SECRET);
  assert.match(page.textContent ?? "", /You won't be able to see this again/u);
  assert.ok(
    !JSON.stringify(appStateIn(testQueryClientNow()) ?? {}).includes(MADE_SECRET),
    "no app state holds it",
  );
  act(() => button("Copy secret").click());
  await settle();
  assert.deepEqual(world.copied, [MADE_SECRET]);
  assert.ok(copiedShown(button("Copy secret")));

  act(() => button("Done").click());
  assert.equal(copyFieldValue(page, "secret"), undefined);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET), "it is gone");
  assert.ok(button("New secret"), "a new secret is the only way to another");
});

test("a new secret shown after one was copied says nothing was copied of it yet", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  writePrompt(page, "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();
  act(() => button("Copy secret").click());
  await settle();
  assert.ok(copiedShown(button("Copy secret")), "the first secret's copy is shown");

  act(() => button("Done").click());
  act(() => button("New secret").click());
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((each) => each.textContent === "Make secret");

    confirm?.click();
  });
  await settle();

  assert.equal(copyFieldValue(page, "secret")?.textContent, ROTATED_SECRET);
  assert.ok(!copiedShown(button("Copy secret")), "the new secret is not shown as copied");
});

test("a shown secret is let go of once the automation is saved as anything but a webhook", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  writePrompt(page, "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(copyFieldValue(page, "secret")?.textContent, MADE_SECRET);

  pick(page, "Type", "Schedule");
  act(() => button("Save").click());
  await settle();
  pick(page, "Type", "Webhook");

  assert.equal(copyFieldValue(page, "secret"), undefined);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET));
});

test("a new secret, asked for first, is shown once on the page that asked, and is gone once the page is left", async () => {
  const hooked = automation(8, {
    name: "Fix Sentry alerts",
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    webhookUrl: "https://vespin.dev/api/automations/hooked/webhook",
  });

  world.standing = [hooked];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: hooked.id });
  await settle();

  assert.equal(copyFieldValue(page, "address")?.textContent, hooked.webhookUrl);
  assert.equal(copyFieldValue(page, "secret"), undefined, "no secret is shown unasked");
  act(() => button("Copy address").click());
  await settle();
  assert.deepEqual(world.copied, [hooked.webhookUrl]);
  assert.ok(copiedShown(button("Copy address")));
  act(() => button("New secret").click());
  await settle();
  assert.deepEqual(world.secretsAsked, [], "nothing is replaced before the developer says so");
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((each) => each.textContent === "Make secret");

    assert.ok(confirm, "the dialog asks first");
    confirm.click();
  });
  await settle();

  assert.deepEqual(world.copied, [hooked.webhookUrl]);
  assert.deepEqual(world.secretsAsked, [hooked.id]);
  assert.equal(copyFieldValue(page, "secret")?.textContent, ROTATED_SECRET);
  assert.match(page.textContent ?? "", /Don't send secrets in the body/u);

  act(() => button("Automations").click());
  await settle();
  act(() => rowOf(page, "Fix Sentry alerts").querySelector<HTMLButtonElement>("button")?.click());
  await settle();
  assert.equal(copyFieldValue(page, "secret"), undefined, "never shown again");
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(ROTATED_SECRET));
});

test("a webhook not yet saved as one says it gets its address once it is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Type", "Webhook");

  assert.equal(copyFieldValue(page, "address"), undefined);
  assert.match(page.textContent ?? "", /Save it as a webhook to get its address/u);
  assert.equal(pickerDetail(page, "Type"), "When its webhook is called");
});

test("an automation's ⋯ in its editor, its row's right-click in the list, and the right-click of a run each offer Copy link, copying its link under the listed workspace, a run that started no agent included", async () => {
  world.runs = [
    {
      id: "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 1,
      settledAt: 1,
    },
    {
      id: "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: null,
      agent: null,
      firedAt: 0,
      settledAt: 0,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  act(() => button("Automation actions").click());
  await act(async () => menuItem("Copy link").click());
  const run = runRows(page)[0]?.querySelector("button");
  assert.ok(run, "the run is listed");
  act(() => {
    run.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());
  const unstarted = runRows(page)[1];
  assert.ok(unstarted, "the run that started no agent is listed");
  act(() => {
    unstarted.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());
  act(() => button("Automations").click());
  await settle();
  act(() => {
    rowOf(page, SWEEP.name)
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());

  const automationLink = `https://vespin.dev/${WORKSPACE.id}/automation/${SWEEP.id}`;
  assert.deepEqual(world.copied.slice(-4), [
    automationLink,
    `${automationLink}/run/6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`,
    `${automationLink}/run/7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e`,
    automationLink,
  ]);
});

test("a right-click on an automation's switch opens no menu, and Escape from its row's menu hands focus back to the row", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const openMenus = () => document.querySelectorAll('[role="menu"]:not([data-leaving])').length;
  const row = rowOf(page, SWEEP.name);

  act(() => {
    button(`Turn off ${SWEEP.name}`).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(openMenus(), 0, "the switch's right-click is its own");

  const press = row.querySelector("button");
  assert.ok(press, "the row is a press");
  act(() =>
    press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  assert.equal(openMenus(), 1);
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await settle();
  assert.equal(document.activeElement === press, true);
});

test("an automation row's ⋯, its right-click and the menu key open the same menu, whose Copy link copies its link and whose Run now runs it", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);
  const press = row.querySelector("button") ?? assert.fail("the row is a press");
  const openMenus = () => document.querySelectorAll('[role="menu"]:not([data-leaving])');
  const items = () => [...(openMenus()[0]?.querySelectorAll('[role="menuitem"]') ?? [])];

  const closeMenu = async () => {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await settle();
  };

  const actions = row.querySelector('button[aria-label="Automation actions"]');
  assert.ok(actions instanceof HTMLElement);

  const doors = [
    () => act(() => actions.click()),
    () =>
      act(() => {
        press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      }),
    () =>
      act(() => {
        press.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
        );
      }),
  ];

  for (const open of doors) {
    open();
    await settle();
    assert.equal(openMenus().length, 1);
    assert.equal(openMenus()[0]?.getAttribute("aria-label"), "Automation actions");
    assert.deepEqual(
      items().map((item) => item.textContent),
      ["Copy link", "Run now", "Delete"],
    );
    await closeMenu();
  }

  doors[2]?.();
  await settle();
  await act(async () => menuItem("Copy link").click());
  assert.equal(world.copied.at(-1), `https://vespin.dev/${WORKSPACE.id}/automation/${SWEEP.id}`);
  doors[0]?.();
  await settle();
  await act(async () => menuItem("Run now").click());
  await settle();
  assert.deepEqual(world.runsAsked, [SWEEP.id]);
});

test("a link to a run shows the Runs panel a reader folded, its run marked current, a fold after it stands, and the link opened again shows it again", async () => {
  window.localStorage.clear();
  world.runs = [
    {
      id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
    },
  ];
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  act(() => button("Hide runs").click());
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  });

  await settle();
  const current = runRows(page)[0]?.querySelector("[aria-current]")?.getAttribute("aria-current");
  act(() => button("Hide runs").click());
  const folded = page.querySelector("aside[aria-label='Runs']");
  act(() =>
    world.sendTo({
      kind: AUTOMATIONS_PAGE.EDIT,
      automationId: SWEEP.id,
      runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
    }),
  );

  assert.equal(current, "true");
  assert.equal(folded === null, true, "the fold after it stands");
  assert.ok(page.querySelector("aside[aria-label='Runs']"), "the same link opened again shows it");
  window.localStorage.clear();
});

test("a link to a run opens its automation's editor with that run marked current among its runs", async () => {
  world.runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 3,
      settledAt: 3,
    },
    {
      id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
    },
  ];

  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  });

  await settle();

  assert.deepEqual(
    runRows(page).map(
      (row) => row.querySelector("[aria-current]")?.getAttribute("aria-current") ?? null,
    ),
    [null, "true"],
  );
});

/**
 * The Automations pages on a narrow stage, a phone's, or the room given,
 * standing on `start`, with the window's stylesheets laid: the page and
 * whether its runs stand alone held as the Plans tab holds them, its runs'
 * screen shown and left by their own presses.
 */
function mountNarrow(start: AutomationsPlace, room: ShellRoom = SHELL_ROOM.NARROW): HTMLElement {
  const pagesRouter = routerAt(start);

  function Pages() {
    // As the Tasks tab does, the runs stand alone through the route, which a page opened on a run's link stands.
    const route = useAutomationsRoute({ narrow: room === SHELL_ROOM.NARROW });

    const tasks = tasksControl({
      workspace: WORKSPACE,
      workspaces: [PERSONAL, WORKSPACE],
      onAutomationRuns: route.onRuns,
    });

    return createElement(
      "div",
      { className: "desktop-shell", "data-room": room },
      createElement(AutomationsPage, { tasks, room }),
    );
  }

  const container = document.createElement("div");
  document.body.append(container);
  world.root = createRoot(container);
  act(() => world.root?.render(withQueryClient(pagesRouter.provide(createElement(Pages)))));

  return container;
}

/** Which of an automation's two screens are on screen: its setup, and its runs. */
function screensShown(page: HTMLElement): string[] {
  const setup = page.querySelector(".automation-editor-screen") ?? assert.fail("no setup");
  const runsScreen = page.querySelector("section[aria-label='Runs']") ?? assert.fail("no runs");

  return [...(shown(setup) ? ["setup"] : []), ...(shown(runsScreen) ? ["runs"] : [])];
}

test("on a narrow stage an automation's setup stands the whole width with its runs hidden, until Runs stands them alone under a way back that returns to the setup", async () => {
  window.localStorage.clear();
  world.runs = [SWEEP_RUN, UNSTARTED_RUN];
  const sheets = layContainersAt({});

  try {
    const page = mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
    await settle();
    assert.deepEqual(screensShown(page), ["setup"]);
    assert.equal(
      page.querySelector(".automation-runs-pane") === null,
      true,
      "no Runs panel stands beside the setup, kept open or not",
    );

    phoneRuns();
    assert.deepEqual(screensShown(page), ["runs"]);
    const runsScreen = page.querySelector("section[aria-label='Runs']");
    assert.equal(runsScreen?.querySelectorAll("li").length, 2, "its runs are listed");

    act(() => button(SWEEP.name).click());
    assert.deepEqual(screensShown(page), ["setup"]);

    phoneRuns();
    act(() => runsScreen?.querySelectorAll<HTMLElement>(".ui-list-row-main")[1]?.click());
    assert.deepEqual(
      screensShown(page),
      ["setup"],
      "a run that opens nothing else opens the setup",
    );
  } finally {
    sheets.remove();
  }
});

test("on a wide stage an automation's page under the split's line by its own width stands its setup alone, its toolbar's Runs standing the runs alone under a way back to the setup", async () => {
  window.localStorage.clear();
  world.runs = [SWEEP_RUN];
  const sheets = layContainersAt({});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("automations-view") ? 700 : 0 });
  });

  try {
    const page = mountNarrow(
      { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id },
      SHELL_ROOM.WIDE,
    );

    await settle();
    assert.deepEqual(screensShown(page), ["setup"]);
    assert.equal(
      page.querySelector(".automation-runs-pane") === null,
      true,
      "no Runs panel stands beside it",
    );

    act(() => button("Runs").click());
    assert.deepEqual(screensShown(page), ["runs"]);
    assert.equal(
      page.querySelector(".automation-runs-screen h2") === null,
      true,
      "the screen is titled Runs already, so its runs wear no second heading",
    );

    act(() => button(SWEEP.name).click());
    assert.deepEqual(screensShown(page), ["setup"]);
  } finally {
    sheets.remove();
  }
});

test("on a narrow stage Runs, from the head's ⋯, takes the focus to the runs' way back, and the way back hands it to the ⋯ it was chosen from", async () => {
  window.localStorage.clear();
  mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const more = button("Automation actions");
  act(() => {
    more.focus();
    more.click();
  });
  const runsItem = menuItem("Runs");
  act(() => runsItem.click());
  const back = button(SWEEP.name);
  assert.ok(document.activeElement === back, "the way back to the setup");

  act(() => {
    back.focus();
    back.click();
  });
  assert.ok(document.activeElement === button("Automation actions"), "the setup's ⋯");
});

test("on a narrow stage a link to a run opens on its runs, with the run marked and the way back to the setup", async () => {
  world.runs = [SWEEP_RUN];

  const page = mountNarrow({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: SWEEP_RUN.id,
  });

  await settle();
  assert.equal(page.querySelector(".automation-editor-screen")?.hasAttribute("hidden"), true);
  const runsScreen = page.querySelector("section[aria-label='Runs']");
  assert.equal(runsScreen?.hasAttribute("hidden"), false);
  assert.ok(runsScreen?.querySelector("[aria-current]"), "the run the link named is marked");
  assert.ok(document.activeElement === button(SWEEP.name), "the focus on the way back");
});

test("on a narrow stage each row says when it runs next before what fires it, under its name, a far run with its year, and a lone owner's card is headed in place of each row's owner", async () => {
  world.standing = [
    { ...SWEEP, nextRunAt: Date.UTC(2026, 9, 22, 9) },
    { ...FAILING, enabled: false },
    {
      ...automation(4, { name: "Yearly audit", scope: AUTOMATION_SCOPE.WORKSPACE }),
      nextRunAt: Date.UTC(2099, 1, 1, 9),
    },
  ];
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme"],
  );
  assert.equal(page.querySelector(".automation-owner") === null, true, "no row names its owner");

  const line = (name: string) =>
    rowOf(page, name).querySelector(".ui-list-row-description")?.textContent ?? "";

  assert.match(line("Nightly flaky-test sweep"), /^Next .+ · Weekdays at 9:00 AM · UTC$/u);
  assert.equal(line("Dependency bumps"), "Weekdays at 9:00 AM · UTC");
  assert.match(
    line("Yearly audit"),
    /^Next .*2099.* · Weekdays at 9:00 AM · UTC$/u,
    "a far run names its year",
  );
  assert.ok(rowOf(page, "Dependency bumps").querySelector(".failed-mark"));
});

/** An automation fired by Sentry alerts from two projects at the error level, waiting six hours before the same issue runs again. */
const SENTRY_ALERTS = automation(11, {
  name: "Fix Sentry errors",
  trigger: {
    kind: AUTOMATION_TRIGGER.INTEGRATION,
    provider: TRIGGER_PROVIDER.SENTRY,
    event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    filters: { project: ["web", "api"], level: [SENTRY_LEVEL.ERROR] },
  },
  guards: { ...AUTOMATION_DEFAULT_GUARDS, subjectCooldownHours: 6 },
});

/** A Sentry issue's firing, as its run keeps it. Synthetic. */
const ISSUE_FIRING = {
  kind: AUTOMATION_FIRING.INTEGRATION,
  provider: TRIGGER_PROVIDER.SENTRY,
  event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
  subject: {
    id: "4711",
    title: "TypeError: cart is undefined",
    url: "https://acme.sentry.io/issues/4711/",
  },
} as const;

test("a Sentry automation's runs wear Sentry's mark, its row says its event and filters, and a skipped run says its issue and opens it", async () => {
  const opened: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, openWeb: (url: string) => opened.push(url) });
  world.standing = [SENTRY_ALERTS];
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  assert.ok(
    rowOf(list, "Fix Sentry errors").querySelector(
      '.actor-mark[data-kind="automation"] .integration-mark-sentry',
    ),
    "the row's tile wears Sentry's mark",
  );
  assert.ok(
    says(rowOf(list, "Fix Sentry errors"), "When an alert fires in Sentry · web, api · error"),
  );
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  world.runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-000000000011",
      firing: ISSUE_FIRING,
      status: AUTOMATION_RUN_STATUS.SKIPPED,
      reason: "same-subject",
      agent: null,
      firedAt: 1,
      settledAt: 1,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();
  const [row] = runRows(page);
  assert.ok(row, "the run is listed");
  assert.deepEqual(glyphs([row]), ["sentry"]);
  assert.ok(says(row, "TypeError: cart is undefined"));
  assert.ok(says(row, "Skipped: already ran for this issue within its cooldown."));
  act(() => row.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(opened, ["https://acme.sentry.io/issues/4711/"]);
});

test("a new Sentry automation is made on the event, filters, levels, and cooldown picked, the alert recommended and how to send it said", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Sentry");
  assert.equal(picked(page, "Event"), "Alert triggered (recommended)");
  assert.match(pickerDetail(page, "Event") ?? "", /alert rule's action/u);
  pick(page, "Event", "New issue");
  type(page.querySelector("input[aria-label='Projects']"), "web, api,");
  type(page.querySelector("input[aria-label='Environments']"), "production");
  act(() => button("Fatal").click());
  act(() => button("Error").click());
  assert.equal(
    pickerDetail(page, "Type"),
    "When a new issue is created in Sentry · web, api · production · error, fatal",
  );
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Projects']")?.value,
    "web, api,",
    "a comma still to be followed stands as typed",
  );

  type(page.querySelector("input[aria-label='Hours before the same issue runs again']"), "0");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  writePrompt(page, "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(world.creates.length, 0);
  assert.match(page.textContent ?? "", /Wait a whole number of hours, from 1 to 168\./u);

  type(page.querySelector("input[aria-label='Hours before the same issue runs again']"), "12");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(world.creates.length, 1);
  assert.deepEqual(world.creates[0]?.trigger, {
    kind: AUTOMATION_TRIGGER.INTEGRATION,
    provider: TRIGGER_PROVIDER.SENTRY,
    event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
    filters: {
      project: ["web", "api"],
      environment: ["production"],
      level: [SENTRY_LEVEL.FATAL, SENTRY_LEVEL.ERROR],
    },
  });
  assert.deepEqual(world.creates[0]?.guards, {
    ...AUTOMATION_DEFAULT_GUARDS,
    subjectCooldownHours: 12,
  });
});

test("a Sentry filter over its bounds says so under its own row, never under Type", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Sentry");
  type(
    page.querySelector("input[aria-label='Projects']"),
    Array.from({ length: 11 }, (_, n) => `project-${n}`).join(", "),
  );
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  writePrompt(page, "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(world.creates.length, 0);
  assert.ok(announced("Keep each filter to 10 values of up to 100 characters."));
  assert.equal(
    page.querySelector("input[aria-label='Projects']")?.getAttribute("aria-invalid"),
    "true",
  );
  assert.notEqual(
    page.querySelector("input[aria-label='Environments']")?.getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(picker(page, "Type").getAttribute("aria-invalid"), null);
});

test("a saved Sentry automation opens on its filters and cooldown, and a cooldown changed saves over its guards alone", async () => {
  world.standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  assert.equal(picked(page, "Type"), "Sentry");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Projects']")?.value,
    "web, api",
  );
  assert.equal(button("Error").getAttribute("aria-checked"), "true");

  const hours = page.querySelector<HTMLInputElement>(
    "input[aria-label='Hours before the same issue runs again']",
  );

  assert.equal(hours?.value, "6");

  type(hours, "48");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(world.changes, [
    {
      automationId: SENTRY_ALERTS.id,
      change: { guards: { ...AUTOMATION_DEFAULT_GUARDS, subjectCooldownHours: 48 } },
    },
  ]);
});

test("where the workspace has no Sentry installed, a Sentry trigger offers Install Sentry in its rows' place, which installs on the workspace", async () => {
  world.sentryRead = { configured: true, installations: [] };
  world.standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  await vi.waitFor(() => assert.match(page.textContent ?? "", /Sentry isn't installed/u));
  assert.equal(page.querySelector("button[aria-label^='Event: ']") === null, true);
  assert.equal(page.querySelector("input[aria-label='Projects']") === null, true);
  act(() => button("Install Sentry").click());
  await settle();
  assert.deepEqual(world.sentryInstalls, [WORKSPACE.id]);
});

test("a Sentry read that fails says so above a saved trigger's rows, which stay editable, and Retry reads again", async () => {
  world.sentryRefusals = 1;
  world.standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  await vi.waitFor(() =>
    assert.match(page.textContent ?? "", /The workspace's Sentry could not be read\./u),
  );
  assert.ok(page.querySelector("input[aria-label='Projects']"), "the saved trigger's rows stand");
  act(() => button("Retry").click());
  await settle();
  await vi.waitFor(() => assert.doesNotMatch(page.textContent ?? "", /could not be read/u));
  assert.ok(page.querySelector("input[aria-label='Projects']"));
});

test("Sentry stays listed but unpickable, saying why, where this deployment holds no Sentry integration, and one already fired by it keeps its rows", async () => {
  world.sentryRead = { configured: false, installations: [] };
  world.standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  act(() => picker(page, "Type").click());

  const sentryOption = () =>
    [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
      (row) => row.querySelector(".ui-combobox-option-label")?.textContent === "Sentry",
    ) ?? assert.fail("Sentry is listed");

  // Note that Sentry is said unpickable once the workspace's integrations reach their query.
  await vi.waitFor(() => assert.equal(sentryOption().getAttribute("aria-disabled"), "true"));
  const sentry = sentryOption();
  assert.match(sentry.textContent ?? "", /Not set up on this deployment yet/u);
  act(() => sentry.click());
  assert.equal(picked(page, "Type"), "Schedule");
  act(() => world.root?.unmount());
  document.body.innerHTML = "";

  const saved = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();
  assert.equal(picked(saved, "Type"), "Sentry");
});

test("Sentry chosen before the read says the deployment holds no Sentry integration is held back from saving", async () => {
  world.sentryRead = { configured: false, installations: [] };
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  // Chosen before the read answers.
  pick(page, "Type", "Sentry");
  await settle();

  await vi.waitFor(() => assert.match(page.textContent ?? "", /Sentry isn't available/u));
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  writePrompt(page, "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(world.creates.length, 0);
  assert.match(page.textContent ?? "", /Vespin cannot receive Sentry events here/u);
});

test("on a phone the list is headed by New automation and one ⋯ holding Create with an agent, its title centered between them", async () => {
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const head = page.querySelector<HTMLElement>(".automations-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["New automation", "Automation list actions"],
  );
  assert.equal(head.querySelector("h1")?.textContent, "Automations");
  act(() => button("Automation list actions").click());
  assert.ok(menuItem("Create with an agent"), "the ⋯ holds Create with an agent");
});

test("on a phone an automation's page is headed by the way back to the list, its name a section's gap under it, and one ⋯ holding Save, Run now, its switch, Runs, and the automation's own actions, where the draft stands its heading", async () => {
  // Note that the window's sheets are laid on a phone's root, whose tokens the gap is read in.
  const sheets = layContainersAt({});
  document.documentElement.dataset.uiProfile = PROFILE.WEB;
  document.documentElement.dataset.uiRoom = SHELL_ROOM.NARROW;
  onTestFinished(() => {
    sheets.remove();
    delete document.documentElement.dataset.uiProfile;
    delete document.documentElement.dataset.uiRoom;
  });
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const head = page.querySelector<HTMLElement>(".automation-head");
  assert.ok(head, "the phone's head stands");
  const header = page.querySelector<HTMLElement>(".ui-detail-page-header");
  assert.ok(header, "the page's header stands");
  assert.equal(
    wayBackGap(head, header),
    pixelsOf(header, "var(--ui-section-gap)"),
    "the name stands a section's gap under the way back",
  );
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Automations", "Automation actions"],
  );
  // The page's header names it, and the head picks the name up once that scrolls away, so it is the one h1.
  assert.equal(head.querySelector("h1") === null, true);
  assert.equal(
    page.querySelector<HTMLInputElement>("h1 input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  act(() => button("Automation actions").click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.match(menu?.textContent ?? "", /Saved/, "the draft's standing heads the menu");

  for (const offered of ["Save", "Run now", "Runs", "Copy link", "Delete"]) {
    assert.ok(
      [...(menu?.querySelectorAll(".ui-menu-item-label") ?? [])].some(
        (each) => each.textContent === offered,
      ),
      `the ⋯ offers ${offered}`,
    );
  }

  assert.ok(menu?.querySelector('[role="menuitemcheckbox"]'), "and the automation's switch");
});

test("a model catalog that could not be read says so in the model menu, and Retry reads it again", async () => {
  world.defaultRefused = true;
  world.catalogRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  // Note that the menu is hung from the chip by its laid-out boxes, which jsdom draws none of.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("automation-model-picker"))
      return DOMRect.fromRect({ x: 200, y: 400, width: 120, height: 24 });

    if (this.classList.contains("ui-anchored-popover"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 300 });

    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  // Note that the picker stands once the failed reads reach their queries.
  const choose = await vi.waitFor(() => button("Choose a model"));
  act(() => choose.click());
  await settle();

  const menu = page.querySelector(".ui-searchable-menu") ?? assert.fail("the model menu opens");
  await vi.waitFor(() =>
    assert.equal(
      menu.querySelector("[role=alert]")?.textContent,
      "The models could not be read.Retry",
    ),
  );
  assert.equal(menu.querySelector("[role=status]") === null, true, "it does not read for ever");

  world.catalogRefused = false;
  const readsBefore = world.catalogReads;
  act(() =>
    (menu.querySelector<HTMLButtonElement>("[role=alert] button") ?? assert.fail()).click(),
  );
  await settle();

  assert.equal(world.catalogReads, readsBefore + 1, "Retry reads the catalog again");
  await vi.waitFor(() => assert.equal(menu.querySelector("[role=alert]") === null, true));
  assert.ok(menu.querySelectorAll("[role=option]").length > 0, "the models are listed");
});

test("workspace agents the task list failed to carry say so in the Agent row, and Retry reads the list again", async () => {
  world.agentListRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();

  assert.match(page.textContent ?? "", /The workspace's agents could not be read\./u);

  act(() => button("Retry").click());

  await vi.waitFor(() => assert.doesNotMatch(page.textContent ?? "", /could not be read/u));
  assert.equal(picked(page, "Agent"), "Started by its first run");
});

test("a search of the Agent picker that failed says it failed rather than that no agent matches, and Retry searches again", async () => {
  world.agentSearchRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    "zzz",
  );
  const dialog = document.querySelector('[role="dialog"][aria-label="Agent"]') ?? assert.fail();
  await vi.waitFor(() =>
    assert.equal(
      dialog.querySelector("[role=alert]")?.textContent,
      "The search for agents could not be read.Retry",
    ),
  );
  assert.doesNotMatch(dialog.textContent ?? "", /No agents match/u);

  world.agentSearchRefused = false;
  act(() =>
    (dialog.querySelector<HTMLButtonElement>("[role=alert] button") ?? assert.fail()).click(),
  );
  await vi.waitFor(() => assert.match(dialog.textContent ?? "", /No agents match/u));

  assert.equal(dialog.querySelector("[role=alert]") === null, true);
});

test("the prompt offers what an @ may mention, a pick created into the prompt as its link, and a bare Enter writes a new line where ⌘Enter creates", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  const prompt = page.querySelector(".automation-prompt") ?? assert.fail("no prompt");
  typeInComposer(prompt, "Ask @lin");
  await settle();

  const offered = [...document.querySelectorAll('.mention-menu [role="option"]')].map(
    (row) => row.querySelector(".ui-combobox-option-label")?.textContent,
  );

  pressInComposer(prompt, "Enter");
  await settle();
  pressInComposer(prompt, "Enter");
  typeInComposer(prompt, "Then triage.");
  await settle();
  const created = world.creates.length;
  pressInComposer(prompt, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(offered[0], "Linear");
  assert.equal(created, 0, "Enter wrote a line rather than creating");
  assert.equal(
    world.creates[0]?.action.prompt,
    "Ask [@Linear](mention://mcp/linear) \nThen triage.",
  );
});

test("⌘Enter in the prompt pressed again while its save is out sends no second save, and saves again once the first lands", async () => {
  world.heldChanges = [];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const prompt = page.querySelector(".automation-prompt") ?? assert.fail("no prompt");
  writePrompt(page, "Fix the two flakiest tests.");
  pressInComposer(prompt, "Enter", { metaKey: true });
  await settle();
  // The words move while the save is out, so a second ⌘Enter has a change of its own to send.
  writePrompt(page, "Fix the three flakiest tests.");
  pressInComposer(prompt, "Enter", { metaKey: true });
  await settle();
  const whileOut = world.changes.length;
  world.heldChanges[0]?.();
  await settle();
  pressInComposer(prompt, "Enter", { metaKey: true });
  await settle();

  assert.equal(whileOut, 1, "one save while the first is out");
  assert.equal(world.changes.length, 2, "a save once the first has landed");
});
