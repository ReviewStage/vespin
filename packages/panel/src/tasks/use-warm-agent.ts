import { AGENT_WARM_EVERY_MS, agentWarmable } from "@repo/features/agent-warm";
import type { AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Duration, Effect, Schedule } from "effect";
import { useEffect } from "react";
import { tellAct } from "../act.js";
import { rendererFork } from "../renderer-runtime.js";
import { usePageFocused } from "../use-page-focused.js";

/**
 * use-warm-agent.ts -- keeps a cloud agent warm while it is on screen in a focused window, so a message goes straight into its running session.
 *
 * The service keeps a cloud agent's sandbox and runner warm for five minutes
 * past its last warm call (`agentWarmAnswerSchema`), so the window calls at
 * once and then every `WARM_EVERY` while the agent stays on screen and the
 * window is visible and focused: an agent open in a focused window is
 * activity, as a turn or a terminal in use is (`@repo/sandbox`'s
 * `SANDBOX_IDLE`), and nothing else is. Each call also asks this Mac for the agent's mirror,
 * which makes one attempt where none runs, so the mirror follows the agent
 * on screen and connects once its sandbox is up. Leaving it, or leaving,
 * hiding, or closing the window, stops the calls and sends nothing: the service's
 * window runs out on its own.
 */

/** How often an agent on screen is said to be there (`@repo/features/agent-warm`). */
const WARM_EVERY = Duration.millis(AGENT_WARM_EVERY_MS);

/** Calls the service's warm, and asks for the mirror, for `agent` at once and every minute while it is on screen and the window is visible and focused; nothing for none. */
export function useWarmAgent(agent: AgentSummary | undefined): void {
  const focused = usePageFocused();
  const warmId = focused && agent !== undefined && agentWarmable(agent) ? agent.id : undefined;
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
