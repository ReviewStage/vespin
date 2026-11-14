import { signedInAccountId } from "@repo/credentials/snapshot";
import type { MachineAskLine } from "@repo/features/machine-ask-live";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { machineAsksQuery } from "./live-reads.js";
import { appStateQuery, selectAccount, selectMachineCommands } from "./use-app-state.js";

/**
 * machine-asks.ts -- the asks the account's machines hold for the developer, as a window answers them: every one still waiting on an answer, but those this Mac holds itself, whose own prompt asks over the window (`machine-command-ask.tsx`).
 *
 * The read is the account's alone (`machineAsksQuery`), held while a window
 * draws an agent's tab or a list that counts what needs the developer. An ask
 * whose window ran out on its machine still waits here, said closed
 * (`lapsed`), since an Allow given now lets the agent try again; it counts
 * as needing the developer no more.
 */

/** No asks, one list for every draw. */
const NO_ASKS: readonly MachineAskLine[] = [];

/** The asks still waiting on the developer that this window answers, the earliest asked first. */
export function useMachineAsks(): readonly MachineAskLine[] {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const asks = useQuery(machineAsksQuery(accountId)).data ?? NO_ASKS;
  const held = useQuery({ ...appStateQuery, select: selectMachineCommands }).data?.asks;

  return useMemo(() => {
    const here = new Set((held ?? []).map((ask) => ask.id));

    return asks.filter((ask) => ask.answer === undefined && !here.has(ask.id));
  }, [asks, held]);
}

/** How many of the asks given need the developer now, by the agent each is for: those whose window has not run out. */
export function machineAsksByAgent(asks: readonly MachineAskLine[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const ask of asks) {
    if (ask.lapsed || ask.agentId === undefined) continue;
    counts.set(ask.agentId, (counts.get(ask.agentId) ?? 0) + 1);
  }

  return counts;
}
