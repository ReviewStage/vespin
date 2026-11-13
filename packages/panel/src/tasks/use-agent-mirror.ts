import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Duration, Effect, Schedule } from "effect";
import { useEffect } from "react";
import { tellAct } from "../act.js";
import { rendererFork } from "../renderer-runtime.js";
import { usePageFocused } from "../use-page-focused.js";

/**
 * use-agent-mirror.ts -- asks this Mac for a cloud agent's mirror while the agent is on screen in a focused window, so its worktree is made by the time a Local tab opens.
 *
 * A mirror makes one attempt each time it is asked and never tries again on
 * its own (`@repo/host`'s `compose-mirrors.ts`), so the window asks at once
 * and then every `ASK_EVERY` while the agent stays on screen and the window
 * is visible and focused, and the mirror connects once something else has
 * its sandbox up. The ask never wakes, opens, or holds the sandbox: the
 * mirror follows one that runs. A host that keeps no mirrors, as the
 * web's, refuses it unheard.
 */

/** How often an agent on screen asks for its mirror. */
const ASK_EVERY = Duration.minutes(1);

/** Whether an agent has a mirror to ask for: a cloud agent's, started, and not archived. */
function mirrored(agent: AgentSummary): boolean {
  return (
    agent.machine === undefined &&
    agent.mac === undefined &&
    agent.status !== AGENT_STATUS.STARTING &&
    agent.archivedAt === undefined
  );
}

/** Asks for `agent`'s mirror at once and every minute while it is on screen and the window is visible and focused; nothing for none. */
export function useAgentMirror(agent: AgentSummary | undefined): void {
  const focused = usePageFocused();
  const agentId = focused && agent !== undefined && mirrored(agent) ? agent.id : undefined;
  useEffect(() => {
    if (agentId === undefined) return undefined;

    return rendererFork(
      Effect.repeat(
        Effect.sync(() => tellAct(ACT_KIND.MAC_SHELL_MIRROR, { agentId })),
        Schedule.spaced(ASK_EVERY),
      ).pipe(Effect.asVoid),
    );
  }, [agentId]);
}
