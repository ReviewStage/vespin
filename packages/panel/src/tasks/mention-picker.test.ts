// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { LINK_DESTINATION, readLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { decodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { holdExits } from "@repo/ui/testing/held-exits";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import type { ComposerTrigger, MentionNode } from "../description-editor/contract.js";
import { fakeActPort } from "../testing/app-bridge.js";
import {
  handHostReads,
  handState,
  holdAutomations,
  holdMembers,
  withExperiments,
} from "../testing/app-state.js";
import { MentionNodeChip } from "./mention-chip.js";
import { MENTION_MENU_SIDE, type MentionPicker, useMentionPicker } from "./mention-picker.js";

/**
 * mention-picker.test.ts -- the `@` list as the editor's reports drive it: a list closed with Escape, which fades out before it goes; a highlight kept on its row as rows read late land above it; on a plan, the workspace's other tasks found by their keys, its Inbox threads by their titles, and its automations by their names; and in New task's box, which no member directory stands around, the workspace's people.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

/** The list drawn as a plan's box draws it, over a description whose one section is Margins, each mention picked recorded and the latest it answered kept for the test to drive. */
function mounted(chosen: MentionNode[] = []) {
  let latest: MentionPicker | undefined;

  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        holder: { taskId: "plan-1" },
        taskName: "Ship the palette",
        workspace: "acme",
        repository: null,
        text: () => "## Margins\n",
      },
      room,
      side: MENTION_MENU_SIDE.ABOVE,
      onChoose: (mention) => chosen.push(mention),
    });

    return createElement("div", { ref: room }, latest.menu);
  }

  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(withExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS), createElement(Picker))),
  );

  return {
    picker: (): MentionPicker => {
      assert.ok(latest, "the picker is drawn");

      return latest;
    },
    page,
  };
}

/** A word the editor reports at the start of the words, typed as far as `query`. */
function word(query: string): ComposerTrigger {
  return { start: 0, query, rect: { left: 0, top: 0, bottom: 0 } };
}

/** The rows the open list draws, by name. */
const rows = (page: HTMLElement) =>
  [...page.querySelectorAll(".ui-combobox-option-label")].map((row) => row.textContent);

test("an @ list closed with Escape stays closed in its word, and opens again once the word is left and written anew", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Margins"]);
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  assert.deepEqual(rows(page), []);
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), [], "the closed word stays closed");
  act(() => picker().onTrigger(undefined));
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Margins"]);
});

test("an @ list closed with Escape stays drawn, inert, with its rows while it fades, and goes once the fade has run", () => {
  const exits = holdExits();
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  const fading = page.querySelector<HTMLElement>(".ui-rect-float");
  const fadingRows = rows(page);
  const expanded = picker().aria["aria-expanded"];
  act(() => exits.finish());

  assert.ok(fading, "the list stands while it fades");
  assert.equal(fading.hasAttribute("inert"), true, "the fading list takes nothing");
  assert.deepEqual(fadingRows, ["Margins"], "the fading list keeps the rows it closed with");
  assert.equal(expanded, "false", "the field reads the list closed as it starts to fade");
  assert.equal(page.querySelector(".ui-rect-float"), null, "the list goes once it has faded");
});

test("a row read late above the highlighted one moves it down, and Enter still writes the row that was highlighted", async () => {
  handState(experimentsOn(EXPERIMENT.DESCRIPTIONS), {
    tasks: {
      ...IDLE_TASKS_VIEW,
      workspaces: [workspace("workspace-acme", "Acme", "acme")],
      tasks: [task("plan-1", "workspace-acme", 1, "Ship the palette")],
    },
  });
  const reads = handHostReads({});
  // The workspace's people are held unread, then laid on once the list stands.
  holdMembers(reads.deliverMembers, () => undefined);
  const chosen: MentionNode[] = [];
  const { picker, page } = mounted(chosen);
  await act(async () => {
    picker().onTrigger(word("mar"));

    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.deepEqual(rows(page), ["Margins"]);

  await act(async () => {
    reads.deliverMembers({
      "workspace-acme": {
        rows: {
          members: [
            {
              userId: "user-mara",
              name: "Mara Lind",
              email: "mara@example.com",
              role: WORKSPACE_ROLE.ADMIN,
            },
          ],
        },
      },
    });

    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await vi.waitFor(() => assert.deepEqual(rows(page), ["Mara Lind", "Margins"]));
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });

  const [picked] = chosen;
  assert.ok(picked, "Enter writes a mention");
  assert.deepEqual(decodeMention(picked.target, null), {
    kind: MENTION_KIND.SECTION,
    taskId: "plan-1",
    anchor: "margins",
  });
});

/** The list drawn as a description's editor draws it, on `plan-1` of the Stage workspace, each mention picked recorded. */
async function mountedOnDescription(chosen: MentionNode[]) {
  let latest: MentionPicker | undefined;

  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        holder: { taskId: "plan-1" },
        taskName: "Ship the palette",
        workspace: "stage",
        repository: null,
        text: () => "",
      },
      room,
      side: MENTION_MENU_SIDE.BELOW,
      onChoose: (mention) => chosen.push(mention),
    });

    return createElement("div", { ref: room }, latest.menu);
  }

  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root?.render(withExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS), createElement(Picker))),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  return {
    picker: (): MentionPicker => {
      assert.ok(latest, "the picker is drawn");

      return latest;
    },
    page,
  };
}

/** The rows the open list draws, by name, the detail beside it, and what stands at its end, as a task's key does. */
const detailedRows = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="option"]')].map((row) =>
    [".ui-combobox-option-label", ".ui-combobox-option-detail", ".ui-combobox-option-hint"]
      .map((part) => row.querySelector(part)?.textContent)
      .filter((words) => words !== undefined)
      .join(" · "),
  );

/** A workspace the reader owns, as the window lists it. */
const workspace = (id: string, name: string, slug: string) => ({
  id,
  name,
  slug,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
});

/** A task of a workspace, as the window lists it. */
const task = (id: string, workspaceId: string, number: number, name: string) => ({
  id,
  workspaceId,
  number,
  name,
  createdAt: 1,
  updatedAt: 1,
  repository: null,
});

test("on a plan, a task's key typed whole leads the @ list with that task, its key beside it, a pick written as its mention; the plan's own key leads with the plan, and another workspace's tasks are not offered", async () => {
  handState(experimentsOn(EXPERIMENT.DESCRIPTIONS), {
    tasks: {
      ...IDLE_TASKS_VIEW,
      workspaces: [
        workspace("workspace-stage", "Stage", "stage"),
        workspace("workspace-acme", "Acme", "acme"),
      ],
      tasks: [
        task("plan-1", "workspace-stage", 1, "Ship the palette"),
        task("plan-421", "workspace-stage", 421, "Cut the release"),
        task("plan-42", "workspace-stage", 42, "Billing usage alerts from the meter"),
        task("plan-acme", "workspace-acme", 42, "Acme's own task"),
      ],
    },
  });
  const chosen: MentionNode[] = [];
  const { picker, page } = await mountedOnDescription(chosen);

  act(() => picker().onTrigger(word("stag-42")));
  assert.deepEqual(detailedRows(page).slice(0, 2), [
    "Billing usage alerts from the meter · STAG-42",
    "Cut the release · STAG-421",
  ]);
  act(() => picker().onTrigger(word("STAG-1")));
  assert.deepEqual(
    detailedRows(page)[0],
    "Ship the palette · The whole description",
    "the plan's own key leads with the plan's own row, not another task's",
  );
  act(() => picker().onTrigger(word("acme")));
  assert.ok(!rows(page).includes("Acme's own task"), "another workspace's task is not offered");

  act(() => picker().onTrigger(word("stag-421")));
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });
  const [picked] = chosen;
  assert.ok(picked, "the highlighted task is written");
  assert.equal(picked.name, "Cut the release");
  assert.deepEqual(decodeMention(picked.target, null), {
    kind: MENTION_KIND.TASK,
    taskId: "plan-421",
  });
});

/** An open Inbox thread an agent posted, changed last at `updatedAt`. */
const thread = (id: string, title: string, updatedAt: number): InboxItem => ({
  id,
  agentId: "agent-1",
  key: id,
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title,
  needsReply: false,
  status: INBOX_STATUS.OPEN,
  postedAt: 1,
  updatedAt,
});

test("on a plan, the workspace's Inbox threads are found by their title, the plan's own first, a pick written as the thread's link and drawn as its chip; another workspace's are not offered", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          workspace("workspace-stage", "Stage", "stage"),
          workspace("workspace-acme", "Acme", "acme"),
        ],
        tasks: [
          task("plan-1", "workspace-stage", 1, "Ship the palette"),
          task("plan-42", "workspace-stage", 42, "Billing usage alerts"),
          task("plan-acme", "workspace-acme", 7, "Acme's own task"),
        ],
      },
      [LIVE_READ.INBOX_ITEMS]: {
        rows: {
          [INBOX_SCOPE_KIND.PLAN]: {
            "plan-42": [thread("item-billing", "Keep the meter's old alerts?", 30)],
            "plan-1": [thread("item-palette", "Keep the palette's margins?", 10)],
            "plan-acme": [thread("item-acme", "Keep Acme's links?", 50)],
          },
        },
      },
    },
  );
  const chosen: MentionNode[] = [];
  const { picker, page } = await mountedOnDescription(chosen);

  act(() => picker().onTrigger(word("threads:keep")));
  assert.deepEqual(detailedRows(page), [
    "Keep the palette's margins? · Ship the palette",
    "Keep the meter's old alerts? · Billing usage alerts",
  ]);

  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
  });
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });
  const [picked] = chosen;
  assert.ok(picked, "the highlighted thread is written");
  assert.equal(picked.name, "Keep the meter's old alerts?");
  assert.deepEqual(readLink(picked.target), {
    workspace: "stage",
    place: { kind: LINK_DESTINATION.INBOX_ITEM, itemId: "item-billing" },
  });

  // The box draws the thread's link as the thread's chip, not as its words.
  const box = document.body.appendChild(document.createElement("div"));
  const boxRoot = createRoot(box);
  act(() =>
    boxRoot.render(
      withExperiments(
        experimentsOn(EXPERIMENT.DESCRIPTIONS),
        createElement(MentionNodeChip, {
          mention: picked,
          doors: {
            holder: { taskId: "plan-1" },
            place: { workspace: "stage", repository: null },
            anchors: new Set<string>(),
            onOpenTask: () => undefined,
            onOpenFile: undefined,
          },
        }),
      ),
    ),
  );
  const chip = box.querySelector("[data-mention-ref]");
  act(() => boxRoot.unmount());
  assert.ok(chip, "the thread is drawn as a chip");
  assert.match(chip.textContent ?? "", /Keep the meter's old alerts\?/u);
});

test("on a plan, an Inbox feed that could not be read is said with Retry, never that no thread matches", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [workspace("workspace-stage", "Stage", "stage")],
        tasks: [task("plan-1", "workspace-stage", 1, "Ship the palette")],
      },
      [LIVE_READ.INBOX_ITEMS]: { failed: true },
    },
  );
  const { picker, page } = await mountedOnDescription([]);

  act(() => picker().onTrigger(word("keep")));
  assert.match(page.textContent ?? "", /Inbox threads could not be read\./u);
});

test("on a plan, the workspace's automations are found by their name, a pick written as the automation's link", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [workspace("workspace-stage", "Stage", "stage")],
        tasks: [task("plan-1", "workspace-stage", 1, "Ship the palette")],
      },
    },
  );

  const automation = (id: string, name: string) => ({
    id,
    planId: null,
    planName: null,
    workspaceId: "workspace-stage",
    name,
    enabled: true,
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Write it." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
  });

  fakeActPort({});

  const { asked } = holdAutomations(handHostReads({}).deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: () => ({
      rows: [
        automation("automation-notes", "Deploy notes"),
        automation("automation-triage", "Triage Sentry"),
      ],
    }),
  });

  const chosen: MentionNode[] = [];
  const { picker, page } = await mountedOnDescription(chosen);

  await act(async () => {
    picker().onTrigger(word("automations:deploy"));

    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.deepEqual(asked, [{ kind: AUTOMATION_FOLLOW.WORKSPACE, id: "workspace-stage" }]);
  await vi.waitFor(() => assert.deepEqual(rows(page), ["Deploy notes"]));

  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });
  const [picked] = chosen;
  assert.ok(picked, "the highlighted automation is written");
  assert.equal(picked.name, "Deploy notes");
  assert.deepEqual(readLink(picked.target), {
    workspace: "stage",
    place: { kind: LINK_DESTINATION.AUTOMATION, automationId: "automation-notes" },
  });
});

test("in New task's box, which no member directory stands around, the @ list offers the people of the workspace the task starts in, the reader as You", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [workspace("workspace-stage", "Stage", "stage")],
      },
    },
  );
  const reads = handHostReads({});

  const held = holdMembers(reads.deliverMembers, (workspaceId) =>
    workspaceId === "workspace-stage"
      ? {
          rows: {
            members: [
              {
                userId: "user-dana",
                name: "Dana Reyes",
                email: "dana@example.com",
                role: WORKSPACE_ROLE.ADMIN,
              },
              // The document's signed-in account, as the host holds its reads by it.
              {
                userId: "user-held",
                name: "Dev",
                email: "dev@example.com",
                role: WORKSPACE_ROLE.OWNER,
              },
            ],
          },
        }
      : undefined,
  );

  let latest: MentionPicker | undefined;

  // The list as New task's box draws it: the workspace given by its id, no task holding the words.
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        holder: undefined,
        taskName: "",
        workspace: "stage",
        workspaceId: "workspace-stage",
        repository: null,
        text: () => "",
      },
      room,
      side: MENTION_MENU_SIDE.BELOW,
      onChoose: () => undefined,
    });

    return createElement("div", { ref: room }, latest.menu);
  }

  const page = document.body.appendChild(document.createElement("div"));
  root = createRoot(page);
  await act(async () => {
    root?.render(withExperiments({}, createElement(Picker)));

    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  await act(async () => {
    latest?.onTrigger(word("people:"));

    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await vi.waitFor(() =>
    assert.deepEqual(detailedRows(page), ["Dev · You", "Dana Reyes · dana@example.com"]),
  );
  assert.deepEqual(held, ["workspace-stage"], "the workspace's people are read as the list opens");
});
