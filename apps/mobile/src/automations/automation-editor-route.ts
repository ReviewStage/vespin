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

/** The editor's own params, which a page pushed over it carries and hands back with its pick, since going back to the editor sets its params whole. */
export interface EditorParams {
  readonly automation?: string | undefined;
  readonly preset?: string | undefined;
}

/** What a page pushed over the editor picks, as the editor's params carry it back: a time zone, or the agent a same-agent automation's runs go to (`FIRST_RUN_AGENT` for the one its first run starts). */
export interface EditorPicked {
  readonly zone?: string | undefined;
  readonly agent?: string | undefined;
}

/** The `agent` param naming the agent its first run starts. Note that no agent's id is this word, so it never names one. */
export const FIRST_RUN_AGENT = "first-run";

/** The editor's params with nothing absent, as a route's params are handed. */
function presentParams(
  params: EditorParams & EditorPicked & { readonly workspace?: string },
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Back to the editor under a pushed page, its own params kept and the page's pick laid on them, as expo-router's `dismissTo` hands a route back its params. */
export function pickedRoute(editor: EditorParams, picked: EditorPicked) {
  return {
    pathname: AUTOMATION_EDITOR_ROUTE.EDITOR,
    params: presentParams({ ...editor, ...picked }),
  } as const;
}

/** The time zone pick, pushed in the sheet over the editor, opening on the zone picked so far. */
export function timeZoneRoute(zone: string, editor: EditorParams) {
  return {
    pathname: AUTOMATION_EDITOR_ROUTE.TIME_ZONE,
    params: presentParams({ ...editor, zone }),
  } as const;
}

/** The prompt, edited whole on a page pushed in the sheet over the editor, its mentions as pills. */
export const PROMPT_ROUTE = AUTOMATION_EDITOR_ROUTE.PROMPT;

/** The agent a same-agent automation's runs go to, picked from the workspace's agents on a page pushed in the sheet, opening on the agent picked so far. */
export function runsAgentRoute(agentId: string | null, workspaceId: string, editor: EditorParams) {
  return {
    pathname: AUTOMATION_EDITOR_ROUTE.AGENT,
    params: presentParams({ ...editor, agent: agentId ?? FIRST_RUN_AGENT, workspace: workspaceId }),
  } as const;
}
