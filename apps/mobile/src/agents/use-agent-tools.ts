/**
 * use-agent-tools.ts -- where an agent's terminal commands and computer use go: the machines its default may be set to, followed while its page stands, and the pick that sets it.
 *
 * The agent's tools as the service answers them (`LIVE_READ.WORKSPACE_TOOLS`,
 * followed through `AGENTS_WORKSPACE_TOOLS_FOLLOW` as the panel's place chip
 * follows them) say where a call naming no machine goes now
 * (`runOnMac.machine`) and the machines its default may be set to: those of
 * the people who let the task's agents use theirs, online or not. A pick
 * sets the agent's default on the service (`AGENTS_SET_DEFAULT_MACHINE`),
 * which answers the tools as they then stand; a refusal is said in the
 * failure notice with Try again, in the panel's words. An agent offered no
 * `run_on_mac` has none of it.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import type { DefaultMachine } from "@repo/features/workspace-tools-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { BUZZ } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** What a default the service refused says, as the panel's place chip says it. */
const DEFAULT_MACHINE_REFUSED = "The default machine could not be changed.";

/** Where an agent's terminal commands and computer use go, and the machines they may be set to go to. */
export interface AgentCommandsPlace {
  /** The machine a call naming none goes to now; none where it would go to none, or to the member's Macs from before machines were named. */
  readonly machine: { readonly id: string; readonly name: string } | undefined;
  readonly machines: readonly DefaultMachine[];
  /** Sets the agent's default to the machine `machineId` names. */
  readonly choose: (machineId: string) => void;
}

/** No machines, held as one value so a read with none reads the same each time. */
const NO_MACHINES: readonly DefaultMachine[] = [];

/** Where the agent `agentId` names sends its terminal commands and computer use, followed while the screen that reads it stands; none before its tools are read, and for an agent offered no `run_on_mac`. */
export function useAgentCommandsPlace(agentId: string): AgentCommandsPlace | undefined {
  const acts = useHostActs();
  const write = useWrite();
  useLiveFollow(agentId === "" ? undefined : agentId, (key) =>
    acts[ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW]({ agentId: key }),
  );

  const select = useMemo(
    () => (state: AppStateSnapshot) => state[LIVE_READ.WORKSPACE_TOOLS][agentId]?.rows,
    [agentId],
  );

  const tools = useQuery({ ...appStateQuery, select }).data;
  const standing = tools?.runOnMac;

  if (standing === undefined) return undefined;

  return {
    machine: standing.machine,
    machines: tools?.machines ?? NO_MACHINES,
    choose: (machineId) => {
      if (machineId === standing.machine?.id) return;
      void write(() => acts[ACT_KIND.AGENTS_SET_DEFAULT_MACHINE]({ agentId, machineId }), {
        refused: (answer) => ("failure" in answer ? DEFAULT_MACHINE_REFUSED : undefined),
        unanswered: DEFAULT_MACHINE_REFUSED,
        // Note that the default is its agent's subject, so a later pick holds off a stale Try again.
        subject: { kind: WRITE_SUBJECT.AGENT_DEFAULT_MACHINE, id: agentId },
        retry: true,
        went: BUZZ.SELECTION,
      });
    },
  };
}
