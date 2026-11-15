/**
 * machine-asks.tsx -- an ask one of the developer's machines holds for an agent, put to them on the phone in a sheet over whatever screen stands, as that machine puts it over its own window.
 *
 * The account's asks are followed while it is signed in, with its
 * machines beside them for each machine's name (`MACHINE_ASKS_FOLLOW`,
 * `MACHINES_FOLLOW`), as the panel's card follows them
 * (`@repo/panel`'s `machine-ask-card.tsx`). The phone holds no ask of its
 * own, so the earliest whose window is still open is put to the developer,
 * one at a time; a sheet already open stays through its window's close,
 * since an Allow given then still lets the agent try again. Deny… asks for
 * the words a Deny hands the agent, and dragging the sheet away puts the ask
 * aside on this phone, leaving it to the developer's other devices. An
 * answer goes to the service, where the first given on any device stands,
 * and the sheet goes as the read carries it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { type MachineAskLine, waitingMachineAsks } from "@repo/features/machine-ask-live";
import { MACHINE_ASK_DECISION, type MachineAskDecision } from "@repo/features/machine-ask-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { BUZZ, MachineAskSheet } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** What the sheet says beyond the card's own words. */
const MACHINE_ASK_WORDS = {
  REFUSED: "Couldn't answer the machine's ask.",
  SOME_MACHINE: "your machine",
} as const;

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

/** The asks of the signed-in account's machines, put to the developer one at a time; nothing while signed out. */
export function MachineAsks({ signedIn }: { readonly signedIn: boolean }) {
  const acts = useHostActs();
  const write = useWrite();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const accountId = signedIn && account !== undefined ? signedInAccountId(account) : undefined;
  const key = accountId ?? "";
  useLiveFollow(accountId, () => acts[ACT_KIND.MACHINE_ASKS_FOLLOW]());
  useLiveFollow(accountId, () => acts[ACT_KIND.MACHINES_FOLLOW]());

  const held =
    useQuery({ ...appStateQuery, select: useCallback(heldAsks(key), [key]) }).data ?? NO_ASKS;

  const names = new Map(
    useQuery({ ...appStateQuery, select: useCallback(heldMachineNames(key), [key]) }).data ?? [],
  );

  // Note that an ask answered or put aside here leaves at once, rather than standing until the read carries its answer.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const asks = waitingMachineAsks(held).filter((ask) => !settled.has(ask.id));

  const shown =
    asks.find((ask) => ask.id === opened) ??
    asks.find((ask) => !ask.lapsed && ask.expiresAt > Date.now());

  useEffect(() => setOpened(shown?.id), [shown?.id]);

  if (shown === undefined) return null;

  const settle = () => setSettled((was) => new Set(was).add(shown.id));

  // Note that an answer that did not go puts the ask back, so it can be given again; one set aside by a drag stays aside.
  const answer = async (decision: MachineAskDecision, note?: string) => {
    settle();
    const id = shown.id;

    const went = await write(
      () =>
        acts[ACT_KIND.MACHINE_ASK_ANSWER](
          note === undefined ? { id, decision } : { id, decision, note },
        ),
      {
        refused: (answered) => ("failure" in answered ? MACHINE_ASK_WORDS.REFUSED : undefined),
        went: BUZZ.SUCCESS,
      },
    );

    if (!went) {
      setSettled((was) => {
        const next = new Set(was);
        next.delete(id);

        return next;
      });
    }
  };

  const { subject } = shown;

  return (
    <MachineAskSheet
      key={shown.id}
      presented
      machine={names.get(shown.deviceId) ?? MACHINE_ASK_WORDS.SOME_MACHINE}
      subject={"command" in subject ? { command: subject.command } : { app: subject.app.name }}
      expiresAt={shown.expiresAt}
      onAllow={(decision) => void answer(decision)}
      onDeny={(note) => void answer(MACHINE_ASK_DECISION.DENY, note)}
      onDismiss={settle}
    />
  );
}
