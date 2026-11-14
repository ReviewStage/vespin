/**
 * machine-ask-alert.tsx -- an ask one of the developer's machines holds for an agent, put to them on the phone in the system's alert over whatever screen stands, as that machine puts it over its own window.
 *
 * The account's asks are followed while it is signed in, with its
 * machines beside them for each machine's name (`MACHINE_ASKS_FOLLOW`,
 * `MACHINES_FOLLOW`), as the panel's card follows them
 * (`@repo/panel`'s `machine-ask-card.tsx`). The phone holds no ask of its
 * own, so the earliest whose window is still open is put to the developer,
 * one at a time; an alert already open stays through its window's close,
 * since an Allow given then still lets the agent try again. Its field holds
 * the words a Deny hands the agent, and Cancel puts the ask aside on this
 * phone, leaving it to the developer's other devices. An answer goes to the
 * service, where the first given on any device stands, and the alert goes
 * as the read carries it.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { type MachineAskLine, waitingMachineAsks } from "@repo/features/machine-ask-live";
import { MACHINE_ASK_DECISION, type MachineAskDecision } from "@repo/features/machine-ask-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import { BUZZ, WORDS_ASK_KIND, WordsAsk } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** What the alert says, in the words of the card the panel and the machine ask with. */
const MACHINE_ASK_WORDS = {
  shell: (machine: string) => `Run on ${machine}?`,
  app: (app: string, machine: string) => `Let agents use ${app} on ${machine}?`,
  SHELL_ASKS: "An agent wants to run a command.",
  APP_ASKS: "An agent wants to see and control an app.",
  NOTE: "Tell the agent why (optional)",
  ALWAYS: "Always allow",
  ONCE: "Just this once",
  DENY: "Deny",
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

/** The alert's title and message for one ask, naming its machine. */
function askWords(ask: MachineAskLine, machine: string): { title: string; message: string } {
  const { subject } = ask;

  return "command" in subject
    ? {
        title: MACHINE_ASK_WORDS.shell(machine),
        message: `${MACHINE_ASK_WORDS.SHELL_ASKS}\n\n${subject.command}`,
      }
    : {
        title: MACHINE_ASK_WORDS.app(subject.app.name, machine),
        message: MACHINE_ASK_WORDS.APP_ASKS,
      };
}

/** The asks of the signed-in account's machines, put to the developer one at a time; nothing while signed out. */
export function MachineAskAlert({ signedIn }: { readonly signedIn: boolean }) {
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
  const shown = asks.find((ask) => ask.id === opened) ?? asks.find((ask) => !ask.lapsed);
  useEffect(() => setOpened(shown?.id), [shown?.id]);

  if (shown === undefined) return null;

  const settle = () => setSettled((was) => new Set(was).add(shown.id));

  const answer = (decision: MachineAskDecision, note?: string) => {
    settle();
    const id = shown.id;
    void write(
      () =>
        acts[ACT_KIND.MACHINE_ASK_ANSWER](
          note === undefined ? { id, decision } : { id, decision, note },
        ),
      {
        refused: (answered) => ("failure" in answered ? MACHINE_ASK_WORDS.REFUSED : undefined),
        went: BUZZ.SUCCESS,
      },
    );
  };

  const words = askWords(shown, names.get(shown.deviceId) ?? MACHINE_ASK_WORDS.SOME_MACHINE);

  return (
    <WordsAsk
      key={shown.id}
      title={words.title}
      message={words.message}
      placeholder={MACHINE_ASK_WORDS.NOTE}
      kind={WORDS_ASK_KIND.NAME}
      optional
      acts={[
        {
          label: MACHINE_ASK_WORDS.ALWAYS,
          onAct: () => answer(MACHINE_ASK_DECISION.ALLOW_ALWAYS),
        },
        { label: MACHINE_ASK_WORDS.ONCE, onAct: () => answer(MACHINE_ASK_DECISION.ALLOW_ONCE) },
        {
          label: MACHINE_ASK_WORDS.DENY,
          onAct: (note) => answer(MACHINE_ASK_DECISION.DENY, note === "" ? undefined : note),
        },
      ]}
      presented
      onDismiss={settle}
    />
  );
}
