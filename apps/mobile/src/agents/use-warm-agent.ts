/**
 * use-warm-agent.ts -- keeps a cloud agent warm while its page stands in focus with the app in the foreground, so a message goes straight into its running session, as the panel keeps one warm while it is on screen in a focused window.
 *
 * Which agents are kept warm and how often are the panel's
 * (`@repo/features/agent-warm`): the page says so through the host
 * (`AGENTS_WARM`) at once and then every minute while it is the screen in
 * focus and the app is in the foreground, and leaving the page, or the app
 * going behind, stops the calls and sends nothing, since the service's
 * window runs out on its own. A call that does not go is let go: the next
 * minute's tries again, and nothing on screen waits on it.
 */

import { AGENT_WARM_EVERY_MS, agentWarmable } from "@repo/features/agent-warm";
import { ACT_KIND } from "@repo/host/acts";
import { useIsFocused } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useHostActs } from "../host/host-provider.js";
import { useFollowedAgent } from "./use-agent.js";

/** Hears the app come to the foreground or go behind. */
function onAppStateChanged(listener: () => void): () => void {
  const subscription = AppState.addEventListener("change", listener);

  return () => subscription.remove();
}

/** Whether the app is in the foreground, as React Native's `AppState` says it. */
function appActive(): boolean {
  return AppState.currentState === "active";
}

/** Calls the service's warm for the agent `agentId` names at once and every minute while its page is in focus and the app in the foreground; nothing for an agent the service keeps no warm for. */
export function useWarmAgent(agentId: string): void {
  const acts = useHostActs();
  const focused = useIsFocused();
  const active = useSyncExternalStore(onAppStateChanged, appActive);
  const agent = useFollowedAgent(agentId);

  const warmId =
    focused && active && agent !== undefined && agentWarmable(agent) ? agentId : undefined;

  useEffect(() => {
    if (warmId === undefined) return undefined;

    const warm = () => {
      acts[ACT_KIND.AGENTS_WARM]({ agentId: warmId }).catch((cause: unknown) => {
        console.warn("The agent was not kept warm.", cause);
      });
    };

    warm();
    const every = setInterval(warm, AGENT_WARM_EVERY_MS);

    return () => clearInterval(every);
  }, [warmId, acts]);
}
