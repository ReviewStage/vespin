/**
 * agent-warm.ts -- which agents a client keeps warm while one stands on screen, and how often it says so, the panel's and the iPhone's alike.
 *
 * The service keeps a cloud agent's sandbox and runner warm for five minutes
 * past its last warm call (`AGENTS_WARM`), so a client calls at once and
 * then every `AGENT_WARM_EVERY_MS` while the agent stands on screen in a
 * window in front: the panel's `use-warm-agent.ts` in a focused window, and
 * the iPhone's agent page in focus while the app is in the foreground.
 * Leaving it stops the calls and sends nothing; the service's window runs
 * out on its own. Nothing here draws or calls.
 */

import { AGENT_STATUS, type AgentSummary } from "./agent-wire.js";

/** How often an agent on screen is said to be there. */
export const AGENT_WARM_EVERY_MS = 60_000;

/** Whether an agent is one the service keeps warm: a cloud agent's, started, and not archived. */
export function agentWarmable(
  agent: Pick<AgentSummary, "machine" | "mac" | "status" | "archivedAt">,
): boolean {
  return (
    agent.machine === undefined &&
    agent.mac === undefined &&
    agent.status !== AGENT_STATUS.STARTING &&
    agent.archivedAt === undefined
  );
}
