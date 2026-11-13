/**
 * failed-lines.ts -- the marks the agents and tasks holding a message the service refused wear: their tabs and their rows, read from the one record of the member's messages on their way the host holds.
 *
 * A message the service refused stands in its transcript where it went,
 * marked as not delivered, until the member sends it again, takes it back
 * into the box, or deletes it (`@repo/host`'s `agent-queue-writes.ts`), as a
 * chat app keeps a message that did not go. Its tab is not the only place
 * that shows it: the task's row, the agent's row, and its tab wear the failed
 * mark in the draft pencil's place while one waits (`draft-mark.tsx`), read
 * from the same record every window draws the line from.
 */

import { useQuery } from "@tanstack/react-query";
import { appStateQuery, selectRefusedAgents, selectTaskSendRefused } from "../use-app-state.js";

/** No agent holding a refused message. */
const NONE: readonly string[] = [];

/** The agents holding a message the service refused. */
export function useFailedAgents(): readonly string[] {
  return useQuery({ ...appStateQuery, select: selectRefusedAgents }).data ?? NONE;
}

/** Whether a task holds a message the service refused to one of its agents, which its row marks. */
export function useTaskSendFailed(taskId: string): boolean {
  return useQuery({ ...appStateQuery, select: selectTaskSendRefused(taskId) }).data === true;
}
