import { signedInAccountId } from "@repo/credentials/snapshot";
import type { MachineAskLine } from "@repo/features/machine-ask-live";
import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  type MachineAskDecision,
} from "@repo/features/machine-ask-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_ICON_SIZE,
  AppAsk,
  AppIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CommandAsk,
  LIST_VARIANT,
  List,
  ListRow,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { pressMutation } from "../act-mutations.js";
import { copyThroughShell } from "../copy-feedback.js";
import { machinesQuery } from "../live-reads.js";
import { useMachineAsks } from "../machine-asks.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { macAppIconAddress } from "./mac-apps.js";

/**
 * machine-ask-dock.tsx -- the asks one of the developer's other machines holds for this agent, docked over its box: what it wants to run or use, and where, the time the ask has left, and Review.
 *
 * A machine of the developer's that claimed this agent's command asks them
 * first, and the ask reaches every device of theirs (`machine-asks.ts`);
 * the machine that holds it asks over its own window, so here stand only
 * the asks another machine holds. Each is one row, as the docks beside it
 * are: the app's icon or the terminal's glyph, what it asks and on which
 * machine, and how long the ask has left, or that it timed out, which an
 * Allow still lets the agent try again after. Review opens the same card
 * the machine itself asks with, naming the machine, and its answer goes to
 * the service, where the first answer given on any device stands; the row
 * goes as the read carries the answer.
 */

/** What the dock says. */
const ASK_DOCK_WORDS = {
  LABEL: "Machine asks",
  REVIEW: "Review",
  TIMED_OUT: "Timed out",
  /** A machine the account's read does not name, as one removed since. */
  SOME_MACHINE: "your machine",
  shell: (machine: string) => `Run a command on ${machine}`,
  app: (app: string, machine: string) => `Use ${app} on ${machine}`,
} as const;

/** The name of each of the account's machines, by its id. */
function useMachineNames(): ReadonlyMap<string, string> {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const machines = useQuery(machinesQuery(accountId)).data ?? [];

  return new Map(machines.map((machine) => [machine.id, machine.name]));
}

/** One ask's row: its mark, what it asks and where, and the time it has left. */
function AskRow({
  ask,
  machine,
  onReview,
}: {
  ask: MachineAskLine;
  machine: string;
  onReview: () => void;
}): ReactNode {
  const { subject } = ask;
  const shell = "command" in subject;

  return (
    <ListRow
      leading={
        shell ? (
          <GLYPH.TERMINAL aria-hidden="true" />
        ) : (
          <AppIcon src={macAppIconAddress(subject.app.iconPng)} size={APP_ICON_SIZE.LEAD} />
        )
      }
      title={shell ? ASK_DOCK_WORDS.shell(machine) : ASK_DOCK_WORDS.app(subject.app.name, machine)}
      description={shell ? subject.command : undefined}
      descriptionReplayMasked={shell}
      meta={
        ask.lapsed ? ASK_DOCK_WORDS.TIMED_OUT : <Time at={ask.expiresAt} look={TIME_LOOK.LEFT} />
      }
      actions={
        <Button size={BUTTON_SIZE.COMPACT} variant={BUTTON_VARIANT.OUTLINE} onClick={onReview}>
          {ASK_DOCK_WORDS.REVIEW}
        </Button>
      }
    />
  );
}

/** The asks another of the developer's machines holds for the agent, docked over its box; nothing where none waits. */
export function MachineAskDock({ agentId }: { agentId: string }): ReactNode {
  const asks = useMachineAsks().filter((ask) => ask.agentId === agentId);
  const names = useMachineNames();
  const [reviewing, setReviewing] = useState<string | undefined>(undefined);
  const { mutate: answerAsk } = useMutation(pressMutation(ACT_KIND.MACHINE_ASK_ANSWER));
  // Note that the card is drawn for the ask it opened over until its fade has run, so its words do not change under its own exit, as one answered on another device goes.
  const { held, onExited } = useHeldThroughExit(asks.find((ask) => ask.id === reviewing));
  const machineOf = (ask: MachineAskLine) => names.get(ask.deviceId) ?? ASK_DOCK_WORDS.SOME_MACHINE;

  const answered = (ask: MachineAskLine, decision: MachineAskDecision, note?: string) => {
    answerAsk(note === undefined ? { id: ask.id, decision } : { id: ask.id, decision, note });
    setReviewing(undefined);
  };

  if (asks.length === 0 && held === undefined) return null;

  return (
    <div className={`machine-ask-dock ${COMPOSER_DOCK_CLASS}`}>
      {asks.length === 0 ? null : (
        <List label={ASK_DOCK_WORDS.LABEL} variant={LIST_VARIANT.CARD} fingerTall>
          {asks.map((ask) => (
            <AskRow
              key={ask.id}
              ask={ask}
              machine={machineOf(ask)}
              onReview={() => setReviewing(ask.id)}
            />
          ))}
        </List>
      )}
      {held === undefined ? null : (
        <AskCard
          ask={held}
          open={reviewing === held.id && asks.some((ask) => ask.id === held.id)}
          machine={machineOf(held)}
          onAnswer={(decision, note) => answered(held, decision, note)}
          onExited={onExited}
        />
      )}
    </div>
  );
}

/** The card one ask is answered on, the same the machine itself asks with, naming the machine. */
function AskCard({
  ask,
  open,
  machine,
  onAnswer,
  onExited,
}: {
  ask: MachineAskLine;
  open: boolean;
  machine: string;
  onAnswer: (decision: MachineAskDecision, note?: string) => void;
  onExited: () => void;
}): ReactNode {
  const { subject } = ask;
  const deny = (note: string | undefined) => onAnswer(MACHINE_ASK_DECISION.DENY, note);
  const answer = (decision: MachineAskDecision) => () => onAnswer(decision);

  if ("command" in subject) {
    return (
      <CommandAsk
        open={open}
        onExited={onExited}
        command={subject.command}
        machineName={machine}
        onAllowOnce={answer(MACHINE_ASK_DECISION.ALLOW_ONCE)}
        onAllowAlways={answer(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
        onDeny={deny}
        expiresAt={ask.expiresAt}
        noteMaxLength={MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS}
        copy={copyThroughShell}
      />
    );
  }

  return (
    <AppAsk
      open={open}
      onExited={onExited}
      app={{ ...subject.app, iconSrc: macAppIconAddress(subject.app.iconPng) }}
      machineName={machine}
      onAllowOnce={answer(MACHINE_ASK_DECISION.ALLOW_ONCE)}
      onAllowAlways={answer(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
      onDeny={deny}
      expiresAt={ask.expiresAt}
      noteMaxLength={MACHINE_ASK_BOUNDS.MAX_NOTE_CHARS}
    />
  );
}
