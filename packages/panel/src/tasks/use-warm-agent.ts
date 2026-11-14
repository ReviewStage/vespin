import { AGENT_WARM_EVERY_MS, agentWarmable } from "@repo/features/agent-warm";
import { AGENT_CHAT, type AgentChat, type AgentSummary } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Duration, Effect, Schedule } from "effect";
import { useEffect } from "react";
import { askAct, tellAct } from "../act.js";
import { rendererFork } from "../renderer-runtime.js";
import { usePageVisible } from "../use-page-visible.js";

/**
 * use-warm-agent.ts -- holds a cloud agent's sandbox up and its runner warm while its chat is shown, and lets go the moment it is not, so a message goes straight into its running session.
 *
 * Shown is the agent on screen in a page the document says is visible,
 * focused or not: a window on a second display still holds while the
 * developer types elsewhere. The window says so at once and then every
 * `WARM_EVERY`, as one holder (`HOLDER`, this page's own id): the service
 * beats that holder's hold on the sandbox, wakes it where it stopped, and
 * launches its runner with no message where none runs
 * (`@repo/features/agent-warm`). Leaving the agent, hiding or minimizing
 * the window, a tab going to the background, and the page going away each
 * say it is hidden at once, which lets go of this holder's hold, and the
 * sandbox stops where nothing else keeps it up. A page that crashed or a
 * Mac that slept says nothing, and its hold lapses on its own a couple of
 * minutes on. Each call also asks this Mac for the agent's mirror, which
 * makes one attempt where none runs, so the mirror follows the agent on
 * screen and connects once its sandbox is up.
 */

/** How often a shown chat is said to be there (`@repo/features/agent-warm`). */
const WARM_EVERY = Duration.millis(AGENT_WARM_EVERY_MS);

/** This page's own id as a chat's holder, so each window holds and lets go of its own. */
const HOLDER = crypto.randomUUID();

/** This window's last word on a chat, which the next waits on. */
let saying: Promise<unknown> = Promise.resolve();

/**
 * Says the agent's chat stands as `chat` in this window. Note that each
 * word goes only once the one before it was answered, because a hidden
 * that overtook a newer shown would let go of the hold the shown just
 * beat; a word that fails is let go, and the next minute's tries again.
 */
function said(agentId: string, chat: AgentChat): void {
  saying = saying
    .then(() => askAct(ACT_KIND.AGENTS_WARM, { agentId, chat, holder: HOLDER }))
    .catch(() => undefined);
}

/** Holds `agent`'s sandbox while its chat is shown in a visible page, said at once and every minute, and lets go as it stops being; nothing for none. */
export function useWarmAgent(agent: AgentSummary | undefined): void {
  const visible = usePageVisible();
  const warmId = visible && agent !== undefined && agentWarmable(agent) ? agent.id : undefined;
  useEffect(() => {
    if (warmId === undefined) return undefined;
    const hidden = () => said(warmId, AGENT_CHAT.HIDDEN);
    // Note that a page going away says so before its effects could, since a closed window runs none.
    window.addEventListener("pagehide", hidden);

    const beating = rendererFork(
      Effect.repeat(
        Effect.sync(() => {
          said(warmId, AGENT_CHAT.SHOWN);
          // Note that the mirror is asked beside the warm, so its worktree is made by the time a Local tab opens; a host that keeps no mirrors, as the web's, refuses it unheard.
          tellAct(ACT_KIND.MAC_SHELL_MIRROR, { agentId: warmId });
        }),
        Schedule.spaced(WARM_EVERY),
      ).pipe(Effect.asVoid),
    );

    return () => {
      window.removeEventListener("pagehide", hidden);
      beating();
      hidden();
    };
  }, [warmId]);
}
