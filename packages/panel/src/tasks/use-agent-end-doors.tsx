/**
 * use-agent-end-doors.tsx -- what an agent's conversation offers once its turn ended or the agent was archived or continued: the end line's press, Unarchive, and the notes naming the agents that continued it.
 */

import {
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
  continuedByIds,
  continuedByTitles,
  endLineOffersContinue,
  endLineReason,
} from "@repo/features/agent-continue-model";
import type { AgentSummary } from "@repo/features/agent-wire";
import { CONTINUE_IN_CLOUD_LABEL } from "@repo/features/failure-remedy";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TOOL_TARGET, type ToolTarget } from "@repo/features/tool-call-model";
import { BUTTON_VARIANT, Button, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import type { ReactNode } from "react";
import { useToast } from "../toast.js";
import { TryAgainPress } from "./agent-end-row.js";
import {
  endLineOffersOtherModel,
  endLineOffersTryAgain,
  offersStop,
  tabTurnOf,
} from "./agent-model.js";
import {
  ContinueAgent,
  ContinuedComposerNote,
  ContinuedTrail,
  RefusalContinue,
} from "./continue-agent.js";
import { RETRY_LINE } from "./github-sign-in-card.js";
import type { MoveCarry } from "./move-agent.js";
import type { HeldComposer } from "./use-agent-composer.js";
import type { AgentsControl } from "./use-agents.js";

/** What an agent's conversation is handed to offer at its end, beside its box. */
export interface AgentEndDoors {
  /** Brings the agent back from the archive; present exactly while it is archived, when no message is sent. */
  readonly unarchive: (() => void | Promise<void>) | undefined;
  /** What a failed turn's end line ends on: Continue, Continue in cloud, a continue on another model, or Try again; none where it ends on its words. */
  readonly endPress: ReactNode;
  /** The row under the end line, or at the conversation's end: the agents that continued it, where an archive took the box. */
  readonly endTrail: ReactNode;
  /** What stands in the box's place once another agent continued this one; none while none has. */
  readonly continuedNote: ReactNode;
  /** What mends the box once it closed for good. */
  readonly closedRemedy: ReactNode;
  /** Whether Continue is offered somewhere, or another agent continued this one, so the end line tells no one to start a new one. */
  readonly continuable: boolean;
}

/**
 * The end doors of an agent's conversation, as its tab offers them: its
 * Unarchive, a refusal said in a toast, the press its failed end line holds,
 * Continue again once another agent continued it, and the notes naming
 * those agents, in the box's place or, where an archive took the box,
 * under the end line.
 */
export function useAgentEndDoors({
  agent,
  control,
  composer,
  starter,
  hostLost,
  moveToCloud,
  onOpenTarget,
  shown,
}: {
  agent: AgentSummary;
  control: AgentsControl;
  composer: HeldComposer;
  /** The teammate who started the agent (`teammateStarter`); none for the reader's own. */
  starter: string | undefined;
  /** The machine that dropped the agent's turn, as its transcript says; none where none did. */
  hostLost: { readonly host: string } | undefined;
  /** Moves the agent to the cloud (`useMoveToCloud`); none where Move to would not. */
  moveToCloud: ((carry?: MoveCarry) => void) | undefined;
  /** Opens what a row is about in the tab that draws it; none where nothing opens one. */
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
  shown: boolean;
}): AgentEndDoors {
  const toast = useToast();

  const openAgent =
    onOpenTarget === undefined
      ? undefined
      : (agentId: string) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId });

  // An archived agent's box gives way to its Unarchive: the page's own where it draws the agent
  // alone, else this tab's, as on a task, a refusal said as the page says it.
  const unarchive =
    control.onUnarchive ??
    (agent.archivedAt === undefined
      ? undefined
      : () =>
          control.onArchive(agent.id, false).then(
            (result) => {
              if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
              toast({
                words: result.reason,
                tone: STATUS_TONE.DANGER,
                failure: {
                  surface: FAILURE_SURFACE.AGENT_ARCHIVE,
                  cause: result,
                  about: { agentId: agent.id },
                },
              });
            },
            () => undefined,
          ));

  // The agents that continued this one, as its summary or the task's list names them: a fork is none.
  const continued = continuedByIds(agent, control.agents, control.archived);

  const continuedDoors = {
    agentIds: continued,
    titles: continuedByTitles(agent),
    control,
    onOpenAgent: openAgent,
  };

  // The box's words and files, which a press carries into the continue where it takes the box's place.
  const carry = {
    words: composer.unsent.words,
    attachments: composer.unsent.attachments,
    taskId: agent.taskId,
  };

  // The failed end line holds the press, Continue again once another agent continued this one.
  const { status, failure } = tabTurnOf(agent, composer);

  const ending = {
    status,
    endReason: endLineReason(failure, starter),
    failure,
    continued: continued.length > 0,
    boxClosed: composer.closed !== undefined,
  };

  const pressed = endLineOffersContinue(ending);
  // Where the model refused the turn, the row offers a continue on another model, the box's words going with it.
  const otherModel = endLineOffersOtherModel(ending);
  // Where a message carries the agent on, the row offers it as a line of the developer's own, unless the box is an archived task's note.
  const triesAgain = endLineOffersTryAgain(ending) && control.onUnarchive === undefined;

  const endPress = pressed ? (
    // Note that once continued, the press carries the box's words, which the continued note hides.
    <ContinueAgent
      agentId={agent.id}
      control={control}
      carry={continued.length > 0 ? carry : undefined}
      label={continued.length > 0 ? CONTINUE_AGAIN_LABEL : CONTINUE_LABEL}
    />
  ) : hostLost !== undefined && moveToCloud !== undefined ? (
    // Note that a turn its machine dropped is carried on in the cloud, since a message to the machine waits on it coming back.
    <Button variant={BUTTON_VARIANT.OUTLINE} icon={<GLYPH.CLOUD />} onClick={() => moveToCloud()}>
      {CONTINUE_IN_CLOUD_LABEL}
    </Button>
  ) : otherModel ? (
    <RefusalContinue agent={agent} control={control} carry={carry} />
  ) : triesAgain ? (
    <TryAgainPress onPress={() => control.onRetry(agent.id, RETRY_LINE)} />
  ) : undefined;

  return {
    unarchive,
    endPress,
    // Note that the box's note names them while it stands, so the transcript names them only where an archive took the box.
    endTrail:
      continued.length === 0 || unarchive === undefined ? undefined : (
        <ContinuedTrail {...continuedDoors} />
      ),
    continuedNote:
      continued.length === 0 ? undefined : (
        <ContinuedComposerNote
          agent={agent}
          doors={continuedDoors}
          stop={offersStop(agent) ? () => control.onStop(agent.id) : undefined}
          control={control}
          shown={shown}
        />
      ),
    closedRemedy: <ContinueAgent agentId={agent.id} control={control} carry={carry} />,
    continuable: continued.length > 0 || control.continueAgent !== undefined,
  };
}
