import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Duration, Effect, Schedule } from "effect";
import { useEffect } from "react";
import { tellAct } from "../act.js";
import { rendererFork } from "../renderer-runtime.js";
import { usePageVisible } from "../use-page-visible.js";

/**
 * use-warm-agent.ts -- keeps a cloud agent warm while it is on screen, so a message goes straight into its running session.
 *
 * The service keeps a cloud agent's sandbox and runner warm for five minutes
 * past its last warm call (`agentWarmAnswerSchema`), so the window calls at
 * once and then every `WARM_EVERY` while the agent stays on screen and the
 * page is visible. Each call also asks this Mac for the agent's mirror,
 * which makes one attempt where none runs, so the mirror follows the agent
 * on screen and connects once its sandbox is up. Leaving it, or hiding or
 * closing the window, stops the calls and sends nothing: the service's
 * window runs out on its own.
 */

/** How often an agent on screen is said to be there. */
const WARM_EVERY = Duration.minutes(1);

/** Whether an agent is one the service keeps warm: a cloud agent's, started, and not archived. */
function warmable(agent: AgentSummary): boolean {
  return (
    agent.machine === undefined &&
    agent.mac === undefined &&
    agent.status !== AGENT_STATUS.STARTING &&
    agent.archivedAt === undefined
  );
}

/** Calls the service's warm, and asks for the mirror, for `agent` at once and every minute while it is on screen and the page is visible; nothing for none. */
export function useWarmAgent(agent: AgentSummary | undefined): void {
  const visible = usePageVisible();
  const warmId = visible && agent !== undefined && warmable(agent) ? agent.id : undefined;
  useEffect(() => {
    if (warmId === undefined) return undefined;
    return rendererFork(
      Effect.repeat(
        Effect.sync(() => {
          tellAct(ACT_KIND.AGENTS_WARM, { agentId: warmId });
          // Note that the mirror is asked beside the warm, so its worktree is made by the time a Local tab opens; a host that keeps no mirrors, as the web's, refuses it unheard.
          tellAct(ACT_KIND.MAC_SHELL_MIRROR, { agentId: warmId });
        }),
        Schedule.spaced(WARM_EVERY),
      ).pipe(Effect.asVoid),
    );
  }, [warmId]);
}
