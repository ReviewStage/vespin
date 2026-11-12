/**
 * agent-failures.ts -- a coding agent's failure classes as a breakdown draws them, for Reliability and Agents alike, and how a breakdown sets its retired rows apart.
 */

import { AGENT_FAILURE, type AgentFailure } from "@repo/features/agent-wire";
import { retiredTitle } from "../chrome/notes.js";
import type { BreakdownRow, BreakdownSeries } from "./breakdown-chart.js";

/** A coding agent's failure class, as the breakdown names it. */
const AGENT_FAILURE_LABEL = {
  [AGENT_FAILURE.MODEL]: "Model call",
  [AGENT_FAILURE.SANDBOX]: "Sandbox or checkout",
  [AGENT_FAILURE.GITHUB]: "GitHub",
  [AGENT_FAILURE.ABANDONED]: "Abandoned by the sweep",
  [AGENT_FAILURE.PROVIDER_KEY]: "Account's own API key",
  [AGENT_FAILURE.MACHINE_SIGN_IN]: "Machine not signed in",
  [AGENT_FAILURE.NOT_STARTED]: "Never started",
  [AGENT_FAILURE.FAST_ON_OWN_KEY]: "Fast on own key",
  [AGENT_FAILURE.FAST_NOT_ENABLED]: "Fast not enabled",
  [AGENT_FAILURE.CONTEXT_OVERFLOW]: "Context too long",
  [AGENT_FAILURE.SESSION_ENDED]: "Session ended",
  [AGENT_FAILURE.RUNNER_LOST]: "Runner lost",
  [AGENT_FAILURE.NO_PROGRESS]: "No progress",
  [AGENT_FAILURE.LINE_UNTAKEN]: "Never picked up",
  [AGENT_FAILURE.PLAN_LIMIT]: "Plan limit, never relaunched",
  [AGENT_FAILURE.REFUSAL]: "Model refused",
  [AGENT_FAILURE.CONNECTION_LOST]: "Provider connection lost, never back",
  [AGENT_FAILURE.OTHER]: "Other",
} as const satisfies Record<AgentFailure, string>;

/** The failure classes no agent fails with now, which only older rows still hold. */
const RETIRED_AGENT_FAILURES: readonly AgentFailure[] = [AGENT_FAILURE.FAST_ON_OWN_KEY];

/** A breakdown of failed agent runs: one series, in the failure ink. */
export const AGENT_FAILURES_SERIES: readonly BreakdownSeries[] = [
  { key: "count", label: "Failed runs", color: "var(--ui-color-danger)" },
];

/**
 * A breakdown's rows with the retired ones moved under every live one, each
 * marked retired, the answer's order otherwise kept.
 */
export function retiredLast<Row>(
  rows: readonly Row[],
  retired: (row: Row) => boolean,
  toBreakdown: (row: Row) => BreakdownRow,
): BreakdownRow[] {
  const live = rows.flatMap((row) => (retired(row) ? [] : [toBreakdown(row)]));

  const old = rows.flatMap((row) => {
    if (!retired(row)) return [];

    const breakdown = toBreakdown(row);

    return [{ ...breakdown, label: retiredTitle(breakdown.label) }];
  });

  return [...live, ...old];
}

/** Failed agent runs by class as a breakdown's rows, the answer's order kept and the retired classes last. */
export function agentFailureRows(
  failures: readonly { failure: AgentFailure; count: number }[],
): BreakdownRow[] {
  return retiredLast(
    failures,
    (row) => RETIRED_AGENT_FAILURES.includes(row.failure),
    (row) => ({ label: AGENT_FAILURE_LABEL[row.failure], counts: { count: row.count } }),
  );
}
