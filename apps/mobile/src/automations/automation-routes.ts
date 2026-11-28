// automation-routes.ts -- the Automations tab's routes: an automation's page and every run it made, each named on the tab a press opens it on (`useOnOwnTab`).

/** The Automations tab's root: the workspace's automations. */
export const AUTOMATIONS_ROUTE = "/automations";

/** What New task's sheet starts an agent for, where its route names it: one that makes an automation. */
export const START_PURPOSE = {
  AUTOMATION: "automation",
} as const;

/** Create with an agent: New task's sheet, its agent handed the brief that makes an automation. */
export const CREATE_WITH_AGENT_ROUTE = {
  pathname: "/start-task",
  params: { purpose: START_PURPOSE.AUTOMATION },
} as const;

/** An automation's page. */
export function automationRoute(automationId: string): string {
  return `${AUTOMATIONS_ROUTE}/${encodeURIComponent(automationId)}`;
}

/** Every run an automation made, newest first. */
export function automationRunsRoute(automationId: string): string {
  return `${automationRoute(automationId)}/runs`;
}
