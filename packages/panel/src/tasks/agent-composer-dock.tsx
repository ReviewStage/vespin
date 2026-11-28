/**
 * agent-composer-dock.tsx -- the box at the foot of an agent's conversation: its message box with the queue its words go through, or, once the agent is archived or continued, the note that stands in its place.
 */

import type { ComputerApps } from "@repo/features/agent-parts";
import type { AgentSummary } from "@repo/features/agent-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { AGENT_ENTER } from "@repo/settings";
import type { Actor } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactNode, type RefObject } from "react";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";
import type { AgentBox } from "./agent-box.js";
import { AgentComposer, type ComposerWords } from "./agent-composer.js";
import type { CallRoute } from "./agent-machines.js";
import { offersStop } from "./agent-model.js";
import {
  type AgentPictureDoor,
  AgentPicturesProvider,
  ComputerAppsProvider,
} from "./agent-pictures.js";
import type { TranscriptCards } from "./agent-tab.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { SuggestionChip } from "./fork-action.js";
import type { MoveCarry } from "./move-agent.js";
import type { SkillSource } from "./skill-picker.js";
import { CallPlaceProvider } from "./transcript-blocks.js";
import type { HeldComposer } from "./use-agent-composer.js";
import type { QueueEditing } from "./use-agent-queue.js";
import type { AgentTranscriptControl } from "./use-agent-transcript.js";

/** Whether Enter queues a message while the agent works, as Settings say; until the first document arrives it sends. */
const selectEnterQueues = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE;

/** Whether the agent's box stands and takes words: the agent is not archived, no other agent continued it, and its box has not closed for good. */
export function boxTakesWords(stands: {
  readonly archived: boolean;
  readonly continued: boolean;
  readonly closed: string | undefined;
}): boolean {
  return !stands.archived && !stands.continued && stands.closed === undefined;
}

/**
 * The box at the foot of an agent's conversation. While the agent is
 * archived, the note offering Unarchive, with the Stop of a turn still
 * running; once another agent continued it, that note (`continuedNote`);
 * otherwise the suggestion it was filled in from, where it was, over the
 * message box, whose `@` reads whose Mac the agent uses, and whose words
 * queue while the agent works where the reader controls its queue.
 */
function DrawnComposerDock({
  agent,
  box,
  composer,
  transcript,
  approvalsWaiting,
  onStop,
  onUnarchive,
  continuedNote,
  cards,
  keywords,
  skills,
  replyDoor,
  closedRemedy,
  onMoveToCloud,
  queue,
  place,
  wording,
  talks = true,
}: {
  agent: AgentSummary;
  /** What the agent's box reads off the agent (`agent-box.tsx`). */
  box: AgentBox;
  composer: HeldComposer;
  transcript: Pick<AgentTranscriptControl, "usage" | "payer" | "payerSubscriptionId" | "context">;
  /** How many of the agent's asks wait, as the conversation's own cards hold them. */
  approvalsWaiting: number;
  onStop: () => Promise<boolean>;
  /** Brings the agent back from the archive; present exactly while it is archived, when no message is sent. */
  onUnarchive: (() => void | Promise<void>) | undefined;
  /** What stands in the box's place once another agent continued this one; none while none has. */
  continuedNote: ReactNode;
  /** The cards the suggestion's chip hangs; none where it hangs its hint. */
  cards: TranscriptCards | undefined;
  /** The words a dictation into the box is likely to say. */
  keywords: readonly string[] | undefined;
  /** Where the skills a `/` in the box offers are read from; nothing where it offers none. */
  skills: SkillSource | undefined;
  /** The door the box hands Reply, which lays a quote in at its caret (`useBoxReplyDoor`); none where nothing quotes into the box, as a Manager's chat. */
  replyDoor?: RefObject<((words: string) => void) | undefined> | undefined;
  /** What mends the box once it closed for good. */
  closedRemedy: ReactNode;
  /** Moves the agent to the cloud, carrying the message its Mac did not take; none where Move to would not. */
  onMoveToCloud: ((carry?: MoveCarry) => void) | undefined;
  /** The agent's queue: whether the reader changes it, whether the agent works, and the box's edit of a queued message; none where the box queues nothing, as a Manager's chat's thread's does. */
  queue:
    | { readonly controls: boolean; readonly working: boolean; readonly editing: QueueEditing }
    | undefined;
  /** Whose Mac the agent uses, the pictures its lines hold, and the apps its calls used, which the box's `@` and files read. */
  place: {
    readonly owner: Actor | undefined;
    readonly route: CallRoute;
    readonly pictures: AgentPictureDoor;
    readonly computerApps: ComputerApps;
  };
  /** What the box asks for, calls its field, and calls its round button, where it says other than an agent's box does, as a thread's reply box does. */
  wording?: ComposerWords | undefined;
  /** Whether the box offers Talk, a call into the agent; a Manager's chat's thread's does not, since a call's lines land in the chat rather than the thread. */
  talks?: boolean | undefined;
}): ReactNode {
  const enterQueues = useQuery({ ...appStateQuery, select: selectEnterQueues }).data === true;
  const queueEditing = queue?.editing;

  if (onUnarchive !== undefined) {
    return (
      <ArchivedComposerNote
        onUnarchive={onUnarchive}
        stop={offersStop(agent) ? onStop : undefined}
      />
    );
  }

  if (continuedNote !== undefined) return continuedNote;

  return (
    <>
      {composer.suggestion === undefined ? null : (
        <SuggestionChip
          suggestion={composer.suggestion}
          source={undefined}
          cards={cards}
          onDrop={composer.dropSuggestion}
        />
      )}
      {/* Note that the box's `@` reads whose Mac the agent uses, to list that Mac's apps or else the ones the reader's machines allow, named and drawn as the agent's calls kept them. */}
      <CallPlaceProvider owner={place.owner} route={place.route}>
        <AgentPicturesProvider value={place.pictures}>
          <ComputerAppsProvider value={place.computerApps}>
            <AgentComposer
              {...box}
              talksIn={talks ? agent.taskId : undefined}
              composer={composer}
              usage={transcript.usage}
              payer={transcript.payer}
              payerSubscriptionId={transcript.payerSubscriptionId}
              // Note that the tab counts the asks its own cards hold, which drop the moment one is answered here, before the row says so.
              approvalsWaiting={approvalsWaiting}
              context={transcript.context}
              brief={agent.brief}
              onStop={onStop}
              // Note that a started agent's conversation always opens on its description or
              // task, so the box takes a follow up even before the transcript is read.
              followsUp
              keywords={keywords}
              skills={skills}
              replyDoor={replyDoor}
              closedRemedy={closedRemedy}
              onContinueInCloud={onMoveToCloud}
              // Note that a box filled in from a suggestion queues nothing, because its words go once, through the suggestion.
              wording={wording}
              queueing={
                queue === undefined ||
                queueEditing === undefined ||
                agent.runtime === undefined ||
                !queue.controls ||
                composer.suggestion !== undefined
                  ? undefined
                  : {
                      working: queue.working,
                      enterQueues,
                      onQueue: queueEditing.queue,
                      editing: queueEditing.editing !== undefined,
                      onSave: queueEditing.save,
                      onSteer: queueEditing.steer,
                      onCancel: queueEditing.cancel,
                    }
              }
            />
          </ComputerAppsProvider>
        </AgentPicturesProvider>
      </CallPlaceProvider>
    </>
  );
}

/**
 * The dock, drawn again only as what it is handed changes: the tab draws
 * again on every write to the transcript, which moves nothing the box draws.
 */
export const AgentComposerDock = memo(DrawnComposerDock);
