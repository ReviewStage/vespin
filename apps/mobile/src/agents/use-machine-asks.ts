/**
 * use-machine-asks.ts -- the asks the developer's machines hold for one agent, on the phone: the panel's read (`@repo/panel`'s `machineAsksQuery`) for the banner over the agent's composer, and the answer.
 *
 * The account's asks are followed while the agent's page stands, with the
 * account's machines beside them for each machine's name
 * (`MACHINE_ASKS_FOLLOW`, `MACHINES_FOLLOW`). The phone holds no ask of its
 * own, so every ask still waiting on an answer is drawn, a timed-out one
 * among them, since an Allow given now lets the agent try again. An answer
 * goes to the service, where the first given on any of the developer's
 * devices stands; the banner goes as the read carries it, and a refusal
 * says why in it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { type MachineAskLine, waitingMachineAsks } from "@repo/features/machine-ask-live";
import type { MachineAskDecision } from "@repo/features/machine-ask-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { BUZZ, type MachineAskSubjectLine } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** What the banner says where an answer did not go, or a machine the account's read no longer names. */
const MACHINE_ASK_SAYS = {
  REFUSED: "Couldn't answer the machine's ask.",
  SOME_MACHINE: "Your machine",
} as const;

/** One ask as the banner draws it, with the answer on its way and why the last did not go. */
export interface MachineAskShown {
  readonly id: string;
  readonly machine: string;
  readonly subject: MachineAskSubjectLine;
  readonly expiresAt: number;
  readonly lapsed: boolean;
  readonly answering: MachineAskDecision | undefined;
  readonly note: string | undefined;
}

/** The asks of one agent, the earliest asked first, and the answer. */
export interface MachineAsks {
  readonly asks: readonly MachineAskShown[];
  readonly answer: (id: string, decision: MachineAskDecision, note?: string) => void;
}

/** No asks, one list for every draw. */
const NO_ASKS: readonly MachineAskLine[] = [];

/** The account's asks the host holds, as a `select`; none until read. */
function heldAsks(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.MACHINE_ASKS][accountId]?.rows;
}

/** The name of each of the account's machines the host holds, by its id, as a `select`. */
function heldMachineNames(accountId: string) {
  return (state: AppStateSnapshot) =>
    state[LIVE_READ.MACHINES][accountId]?.rows?.map(
      (machine) => [machine.id, machine.name] as const,
    );
}

/** What an ask asks, in the banner's terms. */
function subjectLine(ask: MachineAskLine): MachineAskSubjectLine {
  return "command" in ask.subject
    ? { command: ask.subject.command }
    : { app: ask.subject.app.name };
}

/** The asks the developer's machines hold for the agent `agentId` names, followed while the caller is drawn. */
export function useMachineAsks(agentId: string): MachineAsks {
  const acts = useHostActs();
  const write = useWrite();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = account === undefined ? undefined : signedInAccountId(account);
  const key = accountId ?? "";
  useLiveFollow(accountId, () => acts[ACT_KIND.MACHINE_ASKS_FOLLOW]());
  useLiveFollow(accountId, () => acts[ACT_KIND.MACHINES_FOLLOW]());

  const held =
    useQuery({ ...appStateQuery, select: useCallback(heldAsks(key), [key]) }).data ?? NO_ASKS;

  const named = useQuery({
    ...appStateQuery,
    select: useCallback(heldMachineNames(key), [key]),
  }).data;

  const [answering, setAnswering] = useState<ReadonlyMap<string, MachineAskDecision>>(new Map());
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map());

  const settle = useCallback((id: string, note: string | undefined) => {
    setAnswering((was) => {
      const next = new Map(was);
      next.delete(id);

      return next;
    });
    setNotes((was) => {
      const next = new Map(was);

      if (note === undefined) next.delete(id);
      else next.set(id, note);

      return next;
    });
  }, []);

  const answer = useCallback(
    (id: string, decision: MachineAskDecision, note?: string) => {
      settle(id, undefined);
      setAnswering((was) => new Map(was).set(id, decision));
      // Note that an answer refused says why in the banner it came from, rather than in the notice, as a held call's does.
      void write(
        () =>
          acts[ACT_KIND.MACHINE_ASK_ANSWER](
            note === undefined ? { id, decision } : { id, decision, note },
          ),
        {
          refused: (answered) => ("failure" in answered ? MACHINE_ASK_SAYS.REFUSED : undefined),
          inPlace: (words) => settle(id, words),
          went: BUZZ.SUCCESS,
        },
      );
    },
    [acts, write, settle],
  );

  const asks = useMemo(() => {
    const names = new Map(named ?? []);

    return waitingMachineAsks(held)
      .filter((ask) => ask.agentId === agentId)
      .map(
        (ask): MachineAskShown => ({
          id: ask.id,
          machine: names.get(ask.deviceId) ?? MACHINE_ASK_SAYS.SOME_MACHINE,
          subject: subjectLine(ask),
          expiresAt: ask.expiresAt,
          lapsed: ask.lapsed,
          answering: answering.get(ask.id),
          note: notes.get(ask.id),
        }),
      );
  }, [held, named, agentId, answering, notes]);

  return { asks, answer };
}
