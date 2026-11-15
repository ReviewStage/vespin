import { signedInAccountId } from "@repo/credentials/snapshot";
import type { MachineAskLine } from "@repo/features/machine-ask-live";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { machineAsksQuery } from "./live-reads.js";
import { appStateQuery, selectAccount, selectMachineCommands } from "./use-app-state.js";

/**
 * machine-asks.ts -- the asks the account's machines hold for the developer, every one still waiting on an answer, and those another machine holds, which this window puts over itself.
 *
 * The read is the account's alone (`machineAsksQuery`), held while a window
 * draws an agent's tab or a list that counts what needs the developer. An ask
 * whose window ran out on its machine still waits here, said closed
 * (`lapsed`), since an Allow given now lets the agent try again; it counts
 * as needing the developer no more. The asks this Mac holds itself are
 * counted too, but asked over its window by its own prompt
 * (`machine-command-ask.tsx`), so the card here leaves them out by the device
 * this Mac claims commands as.
 */

/** No asks, one list for every draw. */
const NO_ASKS: readonly MachineAskLine[] = [];

/** The asks still waiting on the developer, whichever machine holds them, the earliest asked first. */
export function useMachineAsks(): readonly MachineAskLine[] {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const asks = useQuery(machineAsksQuery(accountId)).data ?? NO_ASKS;

  return useMemo(() => asks.filter((ask) => ask.answer === undefined), [asks]);
}

/** The asks still waiting on the developer that another of their machines holds, which this window answers over itself. */
export function useOtherMachinesAsks(): readonly MachineAskLine[] {
  const asks = useMachineAsks();
  const here = useQuery({ ...appStateQuery, select: selectMachineCommands }).data?.deviceId;

  return useMemo(() => asks.filter((ask) => ask.deviceId !== here), [asks, here]);
}
