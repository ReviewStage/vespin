import type { AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, IRREVERSIBLE_WORDS, TERM } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  type SelectionAct,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { agentStillWriting, teammateStarter } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { type ChosenRows, useChosen, useChosenOf } from "./tasks-selection.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * agents-selection.tsx -- the agents chosen together in a list of them, a task's Agents at the head of its description and a person's agents alike, and what a chosen row's menu does to them all.
 *
 * Each list keeps its own selection (`useAgentsSelection`), chosen as the
 * task lists choose theirs (`tasks-selection.tsx`'s `useChosen`), only the
 * agents it still draws, and offers no bar: a row chosen among several
 * offers the acts from its ⋯, a right-click, a long press, and the menu
 * key, under how many it acts on (`chosenRowMenu`), as a task's related
 * tasks do. Archive, or Unarchive where every agent chosen is archived,
 * keeps one agent's rules (`agent-archive.tsx`): the reader's own are
 * archived at once; a teammate's drawn at rest is read again first; and a
 * teammate's still working, or one whose read did not land, asks one
 * question for them all first, in the accent, naming how many. However many
 * it takes, one toast says them all and its one Undo brings them all back,
 * on the toast alone where a question was asked (`use-agents.ts`).
 * Permanently delete always asks first, naming how many. A question holds
 * the agents it was asked of, so a selection changed meanwhile acts on none
 * it never named, and a refusal leaves only the agents refused asked of.
 */

/** What a confirmed act on every agent chosen answers once the service took them all. */
const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** The first refusal of `answers`, or that every one was taken. */
function firstRefusal(answers: readonly ActionResult[]): ActionResult {
  return answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED;
}

/**
 * The question archiving the agents chosen asks where a teammate's still
 * works, or could not be read again, naming how many. Unarchive brings them
 * back, so the act is never red: it asks in the accent, as an act that
 * reaches someone else, whose turn it stops.
 */
function archiveChosenQuestion(count: number): DialogQuestion {
  const one = count === 1;
  return {
    title: `Stop and archive ${countWords(count, TERM.AGENT)}?`,
    body: one
      ? "Its transcript and pull request are kept."
      : "Their transcripts and pull requests are kept.",
    verb: `Stop and archive ${one ? TERM.AGENT.one : TERM.AGENT.many}`,
    running: "Stopping and archiving",
    loss: CONFIRM_LOSS.AFFECTS_OTHERS,
    replayUnmasked: true,
  };
}

/**
 * The question Permanently delete asks of the agents chosen, naming how
 * many, and, where one is not archived, the archive that keeps them out of
 * the way instead.
 */
function deleteChosenQuestion(count: number, archived: boolean): DialogQuestion {
  const one = count === 1;
  const named = countWords(count, TERM.AGENT);
  const lost = `${one ? "The agent and its transcript" : `The ${named} and their transcripts`} will be deleted. ${IRREVERSIBLE_WORDS}`;
  return {
    title: `Permanently delete ${named}?`,
    body: archived
      ? lost
      : `${lost} To keep ${one ? "it" : "them"} out of the way instead, archive ${one ? "it" : "them"}.`,
    verb: `Permanently delete ${one ? TERM.AGENT.one : TERM.AGENT.many}`,
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

/** The agents a Permanently delete was asked of, and whether every one was archived, as its question names them. */
interface Doomed {
  readonly agentIds: readonly string[];
  readonly archived: boolean;
}

/** No agent asked of. */
const NONE_DOOMED: Doomed = { agentIds: [], archived: true };

/** A list's selection of its agents, as `useAgentsSelection` keeps it. */
export interface AgentsSelection {
  /** The id its `SelectionRegion` stands under. */
  readonly regionId: string;
  /** The agents chosen, only those the list draws. */
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** The selection a row of the agent stands in, where it is one of several chosen; none otherwise. */
  readonly chosenOf: (agentId: string) => ChosenRows | undefined;
  /** The questions its acts ask, Archive and Permanently delete, which the list draws beside its rows. */
  readonly dialog: React.JSX.Element;
}

/**
 * The agents a list has chosen of those it draws (`listed`), and what a
 * chosen row's menu does to them all; see the module's head. `agents` acts
 * on them and reads a teammate's again, and `shown` says whether the list is
 * on screen, which its questions ask on.
 */
export function useAgentsSelection(
  agents: AgentsControl,
  listed: readonly AgentSummary[],
  shown: boolean,
): AgentsSelection {
  const toast = useToast();
  const { regionId, selected, setChosen, onClear } = useChosen(
    new Set(listed.map((agent) => agent.id)),
  );
  const chosen = listed.filter((agent) => selected.has(agent.id));

  // An archive asking nothing, a refusal said in a toast since no question stands to say it.
  const { mutateAsync: archiveAtOnce } = useMutation(agents.archiveAgents);
  const pressArchive = (agentIds: readonly string[], archived: boolean) =>
    void archiveAtOnce({ agentIds, archived }).then((answers) => {
      const refusal = firstRefusal(answers);
      if (refusal.status === ACTION_RESULT_STATUS.ACCEPTED) return;
      toast({
        words: refusal.reason,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.AGENT_ARCHIVE, cause: refusal },
      });
    });

  // The agents Stop and archive was asked of, held as it asks.
  const [stopping, setStopping] = useState<readonly string[]>([]);
  // Note that an archive asked about is drawn at once, which may take the rows the dialog stands over with it.
  const archiveHeard = useRefusalHeard(stopping.length > 0 && shown, {
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
  });
  const asking = useMutation(agents.archiveAgents);
  const archiveAct = useConfirmAct(asking, {
    send: async () => {
      const answers = await asking.mutateAsync({
        agentIds: stopping,
        archived: true,
        asked: true,
      });
      const refused = stopping.filter(
        (_, at) => answers[at]?.status !== ACTION_RESULT_STATUS.ACCEPTED,
      );
      if (refused.length === 0) {
        onClear();
        return ACCEPTED;
      }
      setStopping(refused);
      return archiveHeard(firstRefusal(answers));
    },
    answered: firstRefusal,
  });
  const archiveConfirm = useConfirmDialog(
    { subject: stopping.length > 0, surfaceOpen: shown },
    archiveAct,
    confirmFailure(FAILURE_SURFACE.AGENT_ARCHIVE),
  );
  const askArchive = (agentIds: readonly string[]) => {
    setStopping(agentIds);
    archiveConfirm.ask();
  };

  // Note that a teammate's agent drawn at rest is read again first, because nothing follows an agent whose tab is not shown, and a read that did not land asks rather than stop a turn it could not see.
  const [reading, setReading] = useState(false);
  const archive = () => {
    if (reading) return;
    const agentIds = chosen.map((agent) => agent.id);
    const teammates = chosen.filter(
      (agent) => teammateStarter(agent.startedBy, agents.me) !== undefined,
    );
    if (teammates.some((agent) => agentStillWriting(agent.status))) {
      askArchive(agentIds);
      return;
    }
    if (teammates.length === 0) {
      pressArchive(agentIds, true);
      onClear();
      return;
    }
    setReading(true);
    void Promise.all(teammates.map((agent) => agents.readAgent(agent.id))).then((now) => {
      setReading(false);
      if (now.some((read) => read === undefined || agentStillWriting(read.status))) {
        askArchive(agentIds);
        return;
      }
      pressArchive(agentIds, true);
      onClear();
    });
  };

  // The agents Permanently delete was asked of, held as it asks.
  const [doomed, setDoomed] = useState<Doomed>(NONE_DOOMED);
  const deleteHeard = useRefusalHeard(doomed.agentIds.length > 0 && shown, {
    surface: FAILURE_SURFACE.AGENT_DELETE,
  });
  const { mutateAsync: deleteOne } = useMutation(agents.deleteAgent);
  const deleting = useMutation({
    mutationFn: (agentIds: readonly string[]) =>
      Promise.all(agentIds.map((agentId) => deleteOne(agentId))),
  });
  const deleteAct = useConfirmAct(deleting, {
    send: async () => {
      const answers = await deleting.mutateAsync(doomed.agentIds);
      const refused = doomed.agentIds.filter(
        (_, at) => answers[at]?.status !== ACTION_RESULT_STATUS.ACCEPTED,
      );
      if (refused.length === 0) {
        onClear();
        return ACCEPTED;
      }
      setDoomed({ ...doomed, agentIds: refused });
      // Note that the agents refused are chosen again, since each left the selection as the host drew it gone, and the deleted stay out.
      setChosen(
        (held) => new Set([...[...held].filter((id) => !doomed.agentIds.includes(id)), ...refused]),
      );
      return deleteHeard(firstRefusal(answers));
    },
    answered: firstRefusal,
  });
  const deleteConfirm = useConfirmDialog(
    { subject: doomed.agentIds.length > 0, surfaceOpen: shown },
    deleteAct,
    confirmFailure(FAILURE_SURFACE.AGENT_DELETE),
  );

  const archivedAll = chosen.length > 0 && chosen.every((agent) => agent.archivedAt !== undefined);
  const acts: SelectionAct[] = [
    archivedAll
      ? {
          ...commandHead(PANEL_COMMAND.UNARCHIVE_AGENT),
          onAct: () => {
            pressArchive(
              chosen.map((agent) => agent.id),
              false,
            );
            onClear();
          },
        }
      : { ...commandHead(PANEL_COMMAND.ARCHIVE_AGENT), onAct: archive },
    {
      ...commandHead(PANEL_COMMAND.DELETE_AGENT),
      danger: true,
      onAct: () => {
        setDoomed({ agentIds: chosen.map((agent) => agent.id), archived: archivedAll });
        deleteConfirm.ask();
      },
    },
  ];
  const chosenOf = useChosenOf(selected, TERM.AGENT, acts);
  return {
    regionId,
    selected,
    onChange: setChosen,
    chosenOf,
    dialog: (
      <>
        <ConfirmDialog
          open
          confirm={archiveConfirm}
          question={archiveChosenQuestion(stopping.length)}
          restoreTo={nextRowOrHead}
        />
        <ConfirmDialog
          open
          confirm={deleteConfirm}
          question={deleteChosenQuestion(doomed.agentIds.length, doomed.archived)}
          restoreTo={nextRowOrHead}
        />
      </>
    ),
  };
}
