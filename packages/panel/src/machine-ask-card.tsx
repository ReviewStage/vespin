import { signedInAccountId } from "@repo/credentials/snapshot";
import type { MachineAskLine } from "@repo/features/machine-ask-live";
import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  type MachineAskDecision,
} from "@repo/features/machine-ask-wire";
import { ACT_KIND } from "@repo/host/acts";
import { AppAsk, CommandAsk, useSecond } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { pressMutation } from "./act-mutations.js";
import { copyThroughShell } from "./copy-feedback.js";
import { machinesQuery } from "./live-reads.js";
import { useOtherMachinesAsks } from "./machine-asks.js";
import { macAppIconAddress } from "./tasks/mac-apps.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";
import { useHeldThroughExit } from "./use-held-through-exit.js";

/**
 * machine-ask-card.tsx -- an ask one of the developer's other machines holds for an agent, put to them over the window whatever it shows, as that machine puts it over its own.
 *
 * A machine of the developer's that claimed an agent's command asks them
 * first, and the ask reaches every device of theirs (`machine-asks.ts`);
 * the machine that holds it asks over its own window
 * (`machine-command-ask.tsx`), so here stand only the asks another machine
 * holds. The same card opens, naming the machine: the earliest ask whose
 * window is still open, one at a time, the next taking its place as it goes.
 * A card already open stays through its window's close, its foot saying
 * Timed out, since an Allow given then still lets the agent try again; an
 * ask already closed opens none. The answer goes to the service, where the
 * first given on any device stands, and the card goes as the read carries
 * it.
 */

/** What the card names a machine the account's read does not, as one removed since. */
const SOME_MACHINE = "your machine";

/** The name of each of the account's machines, by its id. */
function useMachineNames(): ReadonlyMap<string, string> {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const machines = useQuery(machinesQuery(accountId)).data ?? [];

  return new Map(machines.map((machine) => [machine.id, machine.name]));
}

/** The ask the card stands for: the one it opened over while it still waits, else the earliest whose window is open by its machine's word and by the clock. */
function askShown(
  asks: readonly MachineAskLine[],
  opened: string | undefined,
  now: number,
): MachineAskLine | undefined {
  return (
    asks.find((ask) => ask.id === opened) ?? asks.find((ask) => !ask.lapsed && ask.expiresAt > now)
  );
}

/** The asks given, but one the developer took back out of them. */
function without(asks: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(asks);
  next.delete(id);

  return next;
}

export function MachineAskCard(): React.JSX.Element | null {
  const names = useMachineNames();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const chosen = askShown(useOtherMachinesAsks(), opened, useSecond());
  // Note that an ask answered here closes its card at once, but stays the one opened over until the read takes it down, so an answer that did not land opens it again, its window closed or not.
  const shown = chosen !== undefined && answered.has(chosen.id) ? undefined : chosen;
  const press = pressMutation(ACT_KIND.MACHINE_ASK_ANSWER);

  const { mutate: answerAsk } = useMutation({
    ...press,
    onError: (cause, variables, ...rest) => {
      setAnswered((was) => without(was, variables.id));
      press.onError?.(cause, variables, ...rest);
    },
    // Note that a refusal the service answers comes back as an answer, not an error, and puts the card back too.
    onSuccess: (answered, variables) => {
      if ("failure" in answered) setAnswered((was) => without(was, variables.id));
    },
  });

  // Note that the card is drawn for the ask it opened over until its fade has run, so its words do not change under its own exit.
  const { held: ask, onExited } = useHeldThroughExit(shown);

  // Note that the ask opened over is kept, so its card stays through its window's close rather than giving way to none.
  useEffect(() => setOpened(chosen?.id), [chosen?.id]);

  if (ask === undefined) return null;

  const machineName = names.get(ask.deviceId) ?? SOME_MACHINE;
  const open = shown?.id === ask.id;

  // Note that an answer that did not reach the service puts the card back (the mutation's `onError`), so it can be given again.
  const answer = (decision: MachineAskDecision, note?: string) => {
    const { id } = ask;

    setAnswered((was) => new Set(was).add(id));
    answerAsk(note === undefined ? { id, decision } : { id, decision, note });
  };

  const deny = (note: string | undefined) => answer(MACHINE_ASK_DECISION.DENY, note);
  const { subject } = ask;

  if ("command" in subject) {
    return (
      <CommandAsk
        key={ask.id}
        open={open}
        onExited={onExited}
        command={subject.command}
        machineName={machineName}
        onAllowOnce={() => answer(MACHINE_ASK_DECISION.ALLOW_ONCE)}
        onAllowAlways={() => answer(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
        onDeny={deny}
        expiresAt={ask.expiresAt}
        noteMaxLength={MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS}
        copy={copyThroughShell}
      />
    );
  }

  return (
    <AppAsk
      key={ask.id}
      open={open}
      onExited={onExited}
      app={{ ...subject.app, iconSrc: macAppIconAddress(subject.app.iconPng) }}
      machineName={machineName}
      onAllowOnce={() => answer(MACHINE_ASK_DECISION.ALLOW_ONCE)}
      onAllowAlways={() => answer(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
      onDeny={deny}
      expiresAt={ask.expiresAt}
      noteMaxLength={MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS}
    />
  );
}
