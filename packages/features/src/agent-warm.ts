/**
 * agent-warm.ts -- which agents a client keeps warm while one's chat is shown, and how often it says so, the panel's and the iPhone's alike.
 *
 * A shown chat holds a cloud agent's sandbox up as one beat of its window or
 * device (`AGENTS_WARM`, `@repo/features/agent-wire`'s `AGENT_CHAT`), which
 * lapses a couple of minutes past its last call, so a client calls at once
 * and then every `AGENT_WARM_EVERY_MS` while the chat is shown: the panel's
 * `use-warm-agent.ts` in a visible page, and the iPhone's agent page in
 * focus while the app is in the foreground. Leaving it says the chat is
 * hidden at once, which lets go of that hold. Nothing here draws or calls.
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
