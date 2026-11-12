/**
 * use-agent-origin.ts -- the run of an automation that started one agent, on the phone: the panel's read (`@repo/panel`'s `agentOriginQuery`) for the card its transcript opens on.
 *
 * The run is followed while the agent's page stands, and only for an agent
 * an automation started, as the panel's tab asks nothing of any other
 * (`AGENTS_ORIGIN_FOLLOW`). The host writes it into the document, read here
 * by the agent's id. A read our own service couldn't answer is asked again
 * each time the page comes back into view, or the app back to the
 * foreground, as from Safari (`AGENTS_ORIGIN_RETRY`); until then the
 * transcript's first line stands as it was sent.
 */

import type { AgentOrigin } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useEffectEvent, useMemo } from "react";
import { AppState } from "react-native";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** One agent's origin read as the host holds it, by the agent's id. */
function selectOrigin(agentId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.AGENT_ORIGINS][agentId];
}

/**
 * The run that started the agent `agentId` names, followed while the caller
 * is drawn and `automated`, an agent an automation started; none for any
 * other agent, while it's unread, or where it couldn't be read.
 */
export function useAgentOrigin(agentId: string, automated: boolean): AgentOrigin | undefined {
  const acts = useHostActs();
  const followed = automated && agentId !== "" ? agentId : undefined;
  useLiveFollow(followed, (id) => acts[ACT_KIND.AGENTS_ORIGIN_FOLLOW]({ agentId: id }));
  const select = useMemo(() => selectOrigin(agentId), [agentId]);
  const read = useQuery({ ...appStateQuery, select }).data;
  const failed = followed !== undefined && read?.failed === true;

  // Note that the read is asked again only as the page or the app comes into view, never as it fails, so a read that keeps failing isn't asked in a loop.
  const retry = useEffectEvent(() => {
    if (!failed || followed === undefined) return;

    void acts[ACT_KIND.AGENTS_ORIGIN_RETRY]({ agentId: followed }).catch((cause: unknown) =>
      console.error("Reading the run that started the agent again did not go.", cause),
    );
  });

  useFocusEffect(useCallback(() => retry(), []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") retry();
    });

    return () => subscription.remove();
  }, []);

  return read?.rows ?? undefined;
}
