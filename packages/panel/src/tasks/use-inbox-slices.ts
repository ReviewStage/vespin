import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import type { AppInboxAgentHolding, AppInboxTasklessItem } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import {
  appStateQuery,
  selectFailedRuns,
  selectInboxAgents,
  selectInboxTaskless,
} from "../use-app-state.js";

/**
 * use-inbox-slices.ts -- what main's inbox read last answered beside the tasks' items, as each surface that draws from it reads it.
 *
 * Each reads its own slice of the document's `inbox`, so a patch to one
 * draws only its readers, and each reads none before the first document
 * arrives.
 */

/** No items of agents with no task, before the first document arrives. */
const NOTHING_TASKLESS: readonly AppInboxTasklessItem[] = [];

/** No agents with no task holding items, before the first document arrives. */
const NO_AGENTS_HOLDING: readonly AppInboxAgentHolding[] = [];

/** No failed runs, before the first document arrives. */
const NO_FAILED_RUNS: readonly AccountFailedRun[] = [];

/** What waits on the developer from agents with no task, as main's read last answered: what the window's Inbox counts beside the tasks'. */
export function useInboxTaskless(): readonly AppInboxTasklessItem[] {
  return useQuery({ ...appStateQuery, select: selectInboxTaskless }).data ?? NOTHING_TASKLESS;
}

/** Every agent with no task holding an inbox item, waiting or settled, the agent whose item changed latest first: what the window's Inbox lists beside the tasks. */
export function useInboxAgents(): readonly AppInboxAgentHolding[] {
  return useQuery({ ...appStateQuery, select: selectInboxAgents }).data ?? NO_AGENTS_HOLDING;
}

/** The newest run of each of the account's own automations that failed to start lately, every workspace's, which marks the sidebar's Automations of the run's workspace until that automation is opened. */
export function useFailedRuns(): readonly AccountFailedRun[] {
  return useQuery({ ...appStateQuery, select: selectFailedRuns }).data ?? NO_FAILED_RUNS;
}
