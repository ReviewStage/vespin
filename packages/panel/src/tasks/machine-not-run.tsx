import { machineName } from "@repo/features/machine-name";
import {
  type CallMachine,
  type MachineNotRun,
  NOT_RUN_OUTCOME,
} from "@repo/features/tool-call-model";
import { NOTE_LINE_LOOK, NoteLine } from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref.js";
import { useThisMac } from "../machine-name.js";
import { useMemberDirectory } from "../member-directory.js";

/**
 * machine-not-run.tsx -- a terminal command or an action on an app that ran nothing on its machine, said quietly on its row rather than as a failure.
 *
 * Nothing ran, so nothing failed: the call's row keeps its icon and its
 * verb, which says what it did not do ("Didn't look at" Notes,
 * `tool-call-model.ts`), and ends on the chip of the machine it was meant
 * for and one muted label for how it came to run nothing
 * (`machineNotRunLabel`). Open, its body says the words the model read,
 * and who answered on which machine where the answer says so.
 */

/** The outcomes whose opened row says who answered on which machine, or that it said nothing back. */
const ANSWERED_ON: ReadonlySet<MachineNotRun["outcome"]> = new Set([
  NOT_RUN_OUTCOME.DECLINED,
  NOT_RUN_OUTCOME.UNANSWERED,
  NOT_RUN_OUTCOME.NO_ANSWER,
]);

/** Who answered the ask, on which machine, or that the machine said nothing back. */
function AnsweredOn({
  notRun,
  machine,
}: {
  notRun: MachineNotRun;
  machine: CallMachine;
}): ReactNode {
  const { members, readerId, former } = useMemberDirectory();
  const thisMac = useThisMac();
  const words = machineName({ deviceId: machine.id, name: machine.name }, [], thisMac);

  switch (notRun.outcome) {
    case NOT_RUN_OUTCOME.DECLINED:
      return (
        <>
          <ActorRef actor={personActor(machine.owner, members, readerId, former)} sentence />{" "}
          declined it on {words}.
        </>
      );
    case NOT_RUN_OUTCOME.UNANSWERED:
      return <>Asked on {words}, and no one answered in time.</>;
    case NOT_RUN_OUTCOME.NO_ANSWER:
      return <>{words} never said what came of it.</>;
    default:
      return null;
  }
}

/** What an opened row of a call that ran nothing says: why, in the words the model read, then who answered on which machine where that is known. */
export function MachineNotRunNote({
  notRun,
  machine,
}: {
  notRun: MachineNotRun;
  machine: CallMachine | undefined;
}): ReactNode {
  return (
    <>
      {notRun.reason === "" ? null : (
        <NoteLine look={NOTE_LINE_LOOK.INSET} selectable data-tool-not-run="">
          {notRun.reason}
        </NoteLine>
      )}
      {machine === undefined || !ANSWERED_ON.has(notRun.outcome) ? null : (
        <NoteLine look={NOTE_LINE_LOOK.INSET}>
          <AnsweredOn notRun={notRun} machine={machine} />
        </NoteLine>
      )}
    </>
  );
}
