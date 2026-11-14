/**
 * use-warm-agent.ts -- holds a cloud agent's sandbox up and its runner warm while its page stands in focus with the app in the foreground, and lets go the moment it does not, as the panel holds one while its chat is shown.
 *
 * Which agents are kept warm and how often are the panel's
 * (`@repo/features/agent-warm`): the page says its chat is shown through
 * the host (`AGENTS_WARM`) at once and then every minute while it is the
 * screen in focus and the app is in the foreground, as one holder
 * (`HOLDER`, this launch of the app's own id), and says it is hidden at
 * once as the page loses focus or the app goes behind, which lets go of
 * this holder's hold so the sandbox stops where nothing else keeps it up.
 * An app killed in the background says nothing, and its hold lapses on its
 * own a couple of minutes on. A call that does not go is let go: the next
 * minute's tries again, and nothing on screen waits on it.
 */

import { AGENT_WARM_EVERY_MS, agentWarmable } from "@repo/features/agent-warm";
import { AGENT_CHAT, type AgentChat } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import { randomUUID } from "expo-crypto";
import { useIsFocused } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useHostActs } from "../host/host-provider.js";
import { useFollowedAgent } from "./use-agent.js";

/** This launch of the app's own id as a chat's holder. */
const HOLDER = randomUUID();

/** This launch's last word on a chat, which the next waits on, so a hidden never overtakes a newer shown and lets go of the hold it just beat. */
let saying: Promise<unknown> = Promise.resolve();

/** Hears the app come to the foreground or go behind. */
function onAppStateChanged(listener: () => void): () => void {
  const subscription = AppState.addEventListener("change", listener);

  return () => subscription.remove();
}

/** Whether the app is in the foreground, as React Native's `AppState` says it. */
function appActive(): boolean {
  return AppState.currentState === "active";
}

/** Holds the sandbox of the agent `agentId` names while its page is in focus and the app in the foreground, said at once and every minute, and lets go as it stops being; nothing for an agent the service keeps no warm for. */
export function useWarmAgent(agentId: string): void {
  const acts = useHostActs();
  const focused = useIsFocused();
  const active = useSyncExternalStore(onAppStateChanged, appActive);
  const agent = useFollowedAgent(agentId);

  const warmId =
    focused && active && agent !== undefined && agentWarmable(agent) ? agentId : undefined;

  useEffect(() => {
    if (warmId === undefined) return undefined;

    const said = (chat: AgentChat) => {
      saying = saying
        .then(() => acts[ACT_KIND.AGENTS_WARM]({ agentId: warmId, chat, holder: HOLDER }))
        .catch((cause: unknown) => {
          console.warn("The agent's chat was not said to the service.", cause);
        });
    };

    said(AGENT_CHAT.SHOWN);
    const every = setInterval(() => said(AGENT_CHAT.SHOWN), AGENT_WARM_EVERY_MS);

    return () => {
      clearInterval(every);
      said(AGENT_CHAT.HIDDEN);
    };
  }, [warmId, acts]);
}
