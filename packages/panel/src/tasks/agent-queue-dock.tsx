import { QUEUE_PAUSE, type QueuedMessage, type QueuePaused } from "@repo/features/agent-queue-wire";
import { pausedWords, QUEUE_REFUSED_WORDS, QUEUE_WORDS } from "@repo/features/agent-queue-words";
import { hasWordsOrFiles, QUEUE_CHANGE } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_VARIANT,
  List,
  ListRow,
  OneLine,
  PauseIcon,
  PlayIcon,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { confirmFailure } from "../failure-report.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { KeptFileChips, WordFilesOf } from "./agent-pictures.js";
import { attachmentChips } from "./attached-file-chips.js";
import { SentWords } from "./skill-chip.js";
import { QueuedUnsentMark } from "./undelivered-mark.js";
import type { UnsentQueued } from "./use-agent-queue.js";

/**
 * agent-queue-dock.tsx -- the messages queued behind an agent's running turn, docked over its message box, under its to-do list and its pull request.
 *
 * One row a message, its words drawn as its bubble draws them once sent
 * (`SentWords`), chips and all, on one line, fading out where they run
 * past it, and its files under them as the bubble draws its own
 * (`KeptFileChips`), an image as its thumbnail, leading with the queue's
 * glyph, which gives way to the handle it is dragged by as the row is
 * hovered (`tasks.css`) where another row stands to move it past; on
 * hover, Steer sends it into the turn now, the pencil takes it into the
 * message box to edit (`agent-composer.tsx`), and
 * the trash deletes it, asking first, since nothing brings its words and
 * files back. A message being edited stays in its place, muted, the queue
 * stopping at it, with Cancel on its row in every window of the agent's
 * starter, so one left standing by a window gone is canceled from any
 * other. A reader who did not start the agent finds no press.
 * A queue standing paused says why
 * over its rows, after a Stop in the quiet tone and after a refusal in the
 * danger one, with Resume. A message the queue did not take stays at its
 * end, muted, wearing the not-delivered alert (`QueuedUnsentMark`), whose
 * menu offers Retry, Edit, and Delete. Nothing is drawn while none is queued
 * and none waits so.
 */

/** A queued message's files as a line's chips: each by its name, read by the id the queue names it under where it names one. */
function queuedFileChips(message: QueuedMessage) {
  return (message.files ?? []).map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: "",
    ...(file.id === undefined ? undefined : { pictureId: file.id }),
  }));
}

/** Why a message not delivered did not go, which heads its alert's menu. */
const UNSENT_REASON = QUEUE_REFUSED_WORDS[QUEUE_CHANGE.ADD];

/** What asking to delete a queued message says. */
const DELETE_QUESTION: DialogQuestion = {
  title: "Delete queued message?",
  body: `It will not be sent, and any files it carries go with it. ${IRREVERSIBLE_WORDS}`,
  verb: "Delete message",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** The dock: the paused header where the queue stands paused, then a row per queued message. */
export function AgentQueueDock({
  messages,
  controls,
  paused,
  editing,
  onMove,
  onSteer,
  onEdit,
  onCancelEdit,
  onDelete,
  onResume,
  unsent,
  onRetry,
  onTakeBack,
  onDrop,
}: {
  messages: readonly QueuedMessage[];
  /** Whether the reader may change the queue: the agent's starter alone may. */
  controls: boolean;
  paused: QueuePaused | undefined;
  /** The message the box is editing, by its id; none while none is. */
  editing: string | undefined;
  /** Gives up the edit of the message on its row, this box's own or one another window left standing. */
  onCancelEdit: (message: QueuedMessage) => void;
  onMove: (from: number, to: number) => void;
  /** Steers a queued message into the turn under way or as the next; none while the agent's first launch boots, which takes no line until its machine is up. */
  onSteer: ((message: QueuedMessage) => void) | undefined;
  onEdit: (message: QueuedMessage) => void;
  /** Deletes the message once the dialog's Delete is pressed, answering how that went. */
  onDelete: (message: QueuedMessage) => Promise<ActionResult>;
  onResume: () => void;
  /** The messages queued from this window that did not go, drawn after the queue's own. */
  unsent: readonly UnsentQueued[];
  /** Sends one again, and takes one back into the box; none while the box takes no message, as when the agent is archived. */
  onRetry: ((id: string) => void) | undefined;
  onTakeBack: ((id: string) => void) | undefined;
  onDrop: (id: string) => void;
}): React.JSX.Element | null {
  const drag = useRowDrag(onMove, { handle: "[data-queue-handle]" });
  const [doomed, setDoomed] = useState<QueuedMessage>();
  // The question goes with its message, which a hand-off may send while it is asked.
  const asked = doomed !== undefined && messages.some((message) => message.id === doomed.id);

  const confirm = useConfirmDialog(
    { subject: asked, surfaceOpen: true },
    neverBusyAct(() => {
      if (doomed !== undefined) void onDelete(doomed);
    }),
    confirmFailure(FAILURE_SURFACE.AGENT_QUEUE_DELETE),
  );

  if (messages.length === 0 && unsent.length === 0) return null;
  // Note that a lone message has nowhere to move, so it offers no handle.
  const movable = controls && messages.length > 1;

  return (
    <div className={`agent-queue-dock ${COMPOSER_DOCK_CLASS}`}>
      {/* Note that a first launch's failed boot is said in the empty transcript, whose Retry lifts the pause. */}
      {paused === undefined || paused.because === QUEUE_PAUSE.BOOT_FAILED ? null : (
        <Banner
          look={BANNER_LOOK.INSET}
          tone={paused.because === QUEUE_PAUSE.REFUSED ? STATUS_TONE.DANGER : STATUS_TONE.NEUTRAL}
          glyph={<PauseIcon />}
          actions={
            controls ? (
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.QUIET}
                icon={<PlayIcon />}
                onClick={onResume}
              >
                {QUEUE_WORDS.RESUME}
              </Button>
            ) : undefined
          }
        >
          {pausedWords(paused)}
        </Banner>
      )}
      <div className="agent-queue-rows">
        <List
          label={QUEUE_WORDS.LIST}
          variant={LIST_VARIANT.CARD}
          fingerTall
          moves
          onPointerDown={drag}
        >
          {messages.map((message) => {
            const edited = message.id === editing || message.editing === true;

            return (
              <ListRow
                key={message.id}
                leading={
                  <span
                    className="agent-queue-lead"
                    {...(movable && !edited ? { "data-queue-handle": "" } : undefined)}
                  >
                    <GLYPH.QUEUED />
                    <GLYPH.DRAG_HANDLE />
                  </span>
                }
                title={
                  <WordFilesOf files={queuedFileChips(message)} words={message.text}>
                    <OneLine words={message.text}>
                      <SentWords text={message.text} line />
                    </OneLine>
                  </WordFilesOf>
                }
                attachments={
                  message.files === undefined ? undefined : (
                    // Note that the row holds the files the words do not name: one sent before markers, or named in code.
                    <WordFilesOf files={queuedFileChips(message)} words={message.text}>
                      <KeptFileChips files={queuedFileChips(message)} />
                    </WordFilesOf>
                  )
                }
                attachmentsOpen
                muted={edited}
                actionsAt={edited ? LIST_ROW_ACTIONS.ALWAYS : LIST_ROW_ACTIONS.HOVER}
                actions={
                  // Note that a reader who did not start the agent may change nothing of its queue.
                  !controls ? undefined : edited ? (
                    <Button
                      size={BUTTON_SIZE.COMPACT}
                      variant={BUTTON_VARIANT.QUIET}
                      onClick={() => onCancelEdit(message)}
                    >
                      {QUEUE_WORDS.CANCEL}
                    </Button>
                  ) : (
                    <>
                      {onSteer === undefined ? null : (
                        <Button
                          size={BUTTON_SIZE.COMPACT}
                          variant={BUTTON_VARIANT.QUIET}
                          icon={<GLYPH.STEER />}
                          onClick={() => onSteer(message)}
                        >
                          {QUEUE_WORDS.STEER}
                        </Button>
                      )}
                      <IconButton
                        size={BUTTON_SIZE.COMPACT}
                        label={QUEUE_WORDS.EDIT}
                        icon={<GLYPH.RENAME />}
                        onClick={() => onEdit(message)}
                      />
                      <IconButton
                        size={BUTTON_SIZE.COMPACT}
                        label={QUEUE_WORDS.DELETE}
                        icon={<GLYPH.DELETE />}
                        onClick={() => {
                          setDoomed(message);
                          confirm.ask();
                        }}
                      />
                    </>
                  )
                }
              />
            );
          })}
          {unsent.map((each) => {
            const chips = attachmentChips(each.attachments);

            return (
              <ListRow
                key={each.id}
                leading={
                  <span className="agent-queue-lead">
                    <GLYPH.QUEUED />
                  </span>
                }
                title={
                  <WordFilesOf files={chips} words={each.text}>
                    <OneLine words={each.text}>
                      <SentWords text={each.text} line />
                    </OneLine>
                  </WordFilesOf>
                }
                attachments={
                  chips.length === 0 ? undefined : (
                    <WordFilesOf files={chips} words={each.text}>
                      <KeptFileChips files={chips} />
                    </WordFilesOf>
                  )
                }
                attachmentsOpen
                muted
                actionsAt={LIST_ROW_ACTIONS.ALWAYS}
                actions={
                  <QueuedUnsentMark
                    reason={UNSENT_REASON}
                    // Note that one whose files' bytes did not outlast a relaunch is not sent again without them.
                    retry={
                      onRetry !== undefined && each.attachments.length === each.files
                        ? () => onRetry(each.id)
                        : undefined
                    }
                    takeBack={
                      onTakeBack !== undefined && hasWordsOrFiles(each.text, each.attachments)
                        ? () => onTakeBack(each.id)
                        : undefined
                    }
                    drop={() => onDrop(each.id)}
                  />
                }
              />
            );
          })}
        </List>
      </div>
      <ConfirmDialog open confirm={confirm} question={DELETE_QUESTION} />
    </div>
  );
}
