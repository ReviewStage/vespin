import assert from "node:assert/strict";
import { agentTab, fileTab } from "@repo/ui/tab-strip-model";
import { test } from "vitest";
import { MAIN_TAB, SIDE_PANEL_TAB } from "../tasks/task-tab-model.js";
import { STEP_WITHIN, type StepLed, type StepShown, stepWithin } from "./task-step.js";

/**
 * task-step.test.ts -- what a task's step shows within its page written as
 * Back and Forward keep it, by the kind of change it is: a step of its own
 * where it opens what a ‹ goes back from, shows what a door naming it
 * opened in the side panel, or opens a narrow room's pane over another; the
 * standing step taken in place for a sibling tab or anything else; and the
 * standing step itself where only what was not yet known arrived.
 * Synthetic ids.
 */

const OPENED: StepLed = { opened: true };
const NONE_OPENED: StepLed = { opened: false };

const AGENT_A = agentTab("agent-a");
const AGENT_B = agentTab("agent-b");
const NOTES = fileTab("docs/notes.md");

test.each<readonly [string, StepShown, StepShown, StepLed, string]>([
  [
    "another agent's tab chosen in the column takes the standing step in place",
    { column: AGENT_A, side: null },
    { column: AGENT_B, side: null },
    NONE_OPENED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "the task's description opened over an agent is a step of its own",
    { column: AGENT_A, side: null },
    { column: MAIN_TAB.OVERVIEW, side: null },
    NONE_OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "an agent's tab chosen over the description takes the description's step in place",
    { column: MAIN_TAB.OVERVIEW, side: null },
    { column: AGENT_A, side: null },
    NONE_OPENED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "an agent's threads opened over its transcript are a step of their own",
    { column: AGENT_A, side: null },
    { column: AGENT_A, threads: { agentId: "agent-a", itemId: "item-1" }, side: null },
    NONE_OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "another thread chosen in an agent's threads is a step of its own",
    { column: AGENT_A, threads: { agentId: "agent-a", itemId: "item-1" }, side: null },
    { column: AGENT_A, threads: { agentId: "agent-a", itemId: "item-2" }, side: null },
    NONE_OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "an agent's threads closed for its transcript take the standing step in place",
    { column: AGENT_A, threads: { agentId: "agent-a", itemId: "item-1" }, side: null },
    { column: AGENT_A, side: null },
    NONE_OPENED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "another agent's tab chosen, its card showing its threads, takes the standing step in place",
    { column: AGENT_A, side: null },
    { column: AGENT_B, threads: { agentId: "agent-b", itemId: "item-1" }, side: null },
    NONE_OPENED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "a side panel tab chosen in its strip, no door naming a thing opening it, takes the standing step in place",
    { column: AGENT_A, side: SIDE_PANEL_TAB.COMMENTS },
    { column: AGENT_A, side: NOTES },
    NONE_OPENED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "a page a door naming it opened in the side panel is a step of its own",
    { column: AGENT_A, side: null },
    { column: AGENT_A, side: NOTES },
    OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "a task's tabs arriving after it opens fill in the standing step",
    { column: undefined, side: undefined },
    { column: AGENT_A, side: SIDE_PANEL_TAB.COMMENTS },
    NONE_OPENED,
    STEP_WITHIN.SAME,
  ],
  [
    "a narrow room's agent screen opened over the description, its one page, is a step of its own",
    { column: MAIN_TAB.OVERVIEW, panel: { open: false, tab: undefined } },
    { column: AGENT_A, panel: { open: false, tab: undefined } },
    NONE_OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "a narrow room's side panel opened over the plan is a step of its own, though no door named a thing",
    { column: AGENT_A, panel: { open: false, tab: undefined } },
    { column: AGENT_A, panel: { open: true, tab: NOTES } },
    NONE_OPENED,
    STEP_WITHIN.VISIT,
  ],
])("%s", (_rule, standing, next, led, written) => {
  assert.equal(stepWithin(standing, next, led), written);
});
