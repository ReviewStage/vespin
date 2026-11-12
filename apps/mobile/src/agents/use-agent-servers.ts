/**
 * use-agent-servers.ts -- the MCP servers an agent is handed, as its page switches them: each connected server with whether the agent has it on, and why the last switch did not take.
 *
 * The panel's servers popover (`@repo/panel`'s `use-agent-servers.ts`) on the
 * phone: the account's integrations are followed while the page stands
 * (`INTEGRATIONS_FOLLOW`), as the popover follows them, and each connected
 * server is listed as the popover names it (`@repo/features/agent-servers-model`).
 * A switch sends the whole list of those off (`AGENTS_SERVERS`), which the
 * host draws on the agent's row the moment it is asked, so the switches read
 * the list off the agent and a refusal the host takes back reads back too.
 * A server not connected is connected in Settings, as the phone offers no
 * sign-in of its own here.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  type HandedServer,
  handedServers,
  switchedServers,
} from "@repo/features/agent-servers-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectIntegrations } from "@repo/host/app-state-reads";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent } from "./use-agent.js";

/** Why a switch did not take, said under the servers. */
const SWITCH_FAILED = "The agent's MCP servers could not be switched.";

/** Nothing switched off, which is what an agent from a service before the switch holds. */
const NONE_OFF: readonly string[] = [];

/** The agent's servers and their switch. */
export interface AgentServers {
  /** The connected servers, in the provider list's order; none before the integrations are read. */
  readonly servers: readonly HandedServer[];
  /** Whether the account's integrations have been read, so an empty list means none is connected. */
  readonly read: boolean;
  /** Why the last switch did not take; none while none failed. */
  readonly note: string | undefined;
  readonly toggle: (connection: string, on: boolean) => void;
}

/** The servers of the agent `agentId` names, followed while the screen that reads them stands. */
export function useAgentServers(agentId: string): AgentServers {
  const acts = useHostActs();
  const send = useWrite();
  const agent = useFollowedAgent(agentId);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  useLiveFollow(signedInAccountId(account), () => acts[ACT_KIND.INTEGRATIONS_FOLLOW]());
  const answer = useQuery({ ...appStateQuery, select: selectIntegrations }).data?.rows;
  const [note, setNote] = useState<string | undefined>(undefined);
  /** How many switches have been sent, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);
  const disabled = agent?.disabledServers ?? NONE_OFF;

  const servers = useMemo(
    () => (answer === undefined ? [] : handedServers(answer, disabled)),
    [answer, disabled],
  );

  return {
    servers,
    read: answer !== undefined,
    note,
    toggle: (connection, on) => {
      if (agent === undefined) return;
      writes.current += 1;
      const write = writes.current;
      setNote(undefined);
      buzz(BUZZ.SELECTION);
      const disabledServers = switchedServers(disabled, connection, on);
      send(
        () => acts[ACT_KIND.AGENTS_SERVERS]({ agentId, disabledServers: [...disabledServers] }),
        {
          refused: (answered) => ("failure" in answered ? SWITCH_FAILED : undefined),
          unanswered: SWITCH_FAILED,
          // Note that only the latest switch's refusal is said.
          inPlace: (words) => {
            if (write === writes.current) setNote(words);
          },
        },
      );
    },
  };
}
