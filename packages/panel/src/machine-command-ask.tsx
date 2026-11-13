import { ACT_KIND } from "@repo/host/acts";
import { isMachineShellAsk, type MachineCommandAsk } from "@repo/host/app-state";
import { MACHINE_COMMAND_DECISION, type MachineCommandDecision } from "@repo/host/contract";
import { AppAsk, CommandAsk } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { pressMutation } from "./act-mutations.js";
import { copyThroughShell } from "./copy-feedback.js";
import { appStateQuery, selectMachineCommands } from "./use-app-state.js";
import { useHeldThroughExit } from "./use-held-through-exit.js";

/**
 * machine-command-ask.tsx -- the command an agent asks to run on this Mac, or the app it asks to use, put to the developer over the window while main holds it.
 *
 * Main holds each command it claimed under This Mac's Ask every
 * time, and each action on an app not yet allowed, drawn as the app's own
 * card (`AppAsk`), until the developer answers or the command's own timeout passes
 * (`@repo/host`'s `compose-machine-commands.ts`), and the document carries the
 * asks waiting. The earliest is drawn, and the next takes its place as it
 * goes; the answer goes back by the ask's id, and the card goes as main
 * drops the ask, so one answered elsewhere or timed out leaves no card
 * standing once it has faded out. An answer main refuses says why in a toast, as every press does.
 */

/** The ask drawn: the earliest waiting, which main lists first. */
function firstAsk(asks: readonly MachineCommandAsk[] | undefined): MachineCommandAsk | undefined {
  return asks?.[0];
}

/** An app's icon as the Mac sent it, a PNG's base64, as an address the card draws; none where it sent none. */
function iconAddress(iconPng: string | undefined): string | undefined {
  return iconPng === undefined ? undefined : `data:image/png;base64,${iconPng}`;
}

export function MachineCommandAskDialog(): React.JSX.Element | null {
  const waiting = firstAsk(
    useQuery({ ...appStateQuery, select: selectMachineCommands }).data?.asks,
  );

  const { mutate: answerAsk } = useMutation(pressMutation(ACT_KIND.MACHINE_COMMAND_ANSWER));
  // Note that the card is drawn for the ask it was opened over until its fade has run, so its words do not change under its own exit.
  const { held: ask, onExited } = useHeldThroughExit(waiting);

  if (ask === undefined) return null;
  const answer = (decision: MachineCommandDecision) => answerAsk({ id: ask.id, decision });

  if (!isMachineShellAsk(ask)) {
    return (
      <AppAsk
        key={ask.id}
        open={waiting !== undefined}
        onExited={onExited}
        app={{ ...ask.app, iconSrc: iconAddress(ask.app.iconPng) }}
        onAllowOnce={() => answer(MACHINE_COMMAND_DECISION.ALLOW_ONCE)}
        onAllowAlways={() => answer(MACHINE_COMMAND_DECISION.ALLOW_ALWAYS)}
        onDeny={() => answer(MACHINE_COMMAND_DECISION.DENY)}
      />
    );
  }

  return (
    <CommandAsk
      key={ask.id}
      open={waiting !== undefined}
      onExited={onExited}
      command={ask.command}
      onAllowOnce={() => answer(MACHINE_COMMAND_DECISION.ALLOW_ONCE)}
      onAllowAlways={() => answer(MACHINE_COMMAND_DECISION.ALLOW_ALWAYS)}
      onDeny={() => answer(MACHINE_COMMAND_DECISION.DENY)}
      copy={copyThroughShell}
    />
  );
}
