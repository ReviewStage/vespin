// automation-editor-route.ts -- the routes of the automation editor's sheet: New automation, an automation's Edit, and the time zone its schedule is picked in, pushed inside the sheet.

import type { AutomationPresetName } from "@repo/features/automation-presets";

/** The sheet's routes, from the root stack. */
const AUTOMATION_EDITOR_ROUTE = {
  EDITOR: "/automation-editor",
  TIME_ZONE: "/automation-editor/time-zone",
  PROMPT: "/automation-editor/prompt",
  AGENT: "/automation-editor/agent",
} as const;

/** New automation, in the workspace the app works in, filled in from the suggestion's `preset` where one is named. */
export function newAutomationRoute(preset?: AutomationPresetName) {
  return {
    pathname: AUTOMATION_EDITOR_ROUTE.EDITOR,
    params: preset === undefined ? {} : { preset },
  } as const;
}

/** An automation's Edit, by its id. */
export function editAutomationRoute(automationId: string) {
  return {
    pathname: AUTOMATION_EDITOR_ROUTE.EDITOR,
    params: { automation: automationId },
  } as const;
}

/** The time zone pick, pushed in the sheet over the editor, opening on the zone picked so far. */
export function timeZoneRoute(zone: string) {
  return { pathname: AUTOMATION_EDITOR_ROUTE.TIME_ZONE, params: { zone } } as const;
}

/** The prompt, edited whole on a page pushed in the sheet over the editor, its mentions as pills. */
export const PROMPT_ROUTE = AUTOMATION_EDITOR_ROUTE.PROMPT;

/** The agent a same-agent automation's runs go to, picked from the workspace's agents on a page pushed in the sheet. */
export const RUNS_AGENT_ROUTE = AUTOMATION_EDITOR_ROUTE.AGENT;
