import { QUEUE_PAUSE, type QueuedMessage, type QueuePaused } from "@repo/features/agent-queue-wire";
import { pausedWords, QUEUE_WORDS } from "@repo/features/agent-queue-words";
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
import { ACTOR_KIND, type Actor, personActor, SOMEONE_REASON } from "@repo/ui/actor-model";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import type { ActionResult } from "@repo/wire";
import { useState } from "react";
import { ActorRef } from "../actor-ref.js";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { confirmFailure } from "../failure-report.js";
import { type Directory, useMemberDirectory } from "../member-directory.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { KeptFileChips, WordFilesOf } from "./agent-pictures.js";
import { SentWords } from "./skill-chip.js";

/**
 * agent-queue-dock.tsx -- the messages queued behind an agent's running turn, docked over its message box, under its to-do list and its pull request.
 *
 * One row a message, its words drawn as its bubble draws them once sent
 * (`SentWords`), chips and all, on one line, fading out where they run
 * past it, and its files under them as the bubble draws its own
 * (`KeptFileChips`), an image as its thumbnail, and at its end the face of
 * whoever queued it where that is not the reader (`queuerOf`), as a line
 * someone else sent stands under its sender, leading with the queue's
 * glyph, which gives way to the handle it is dragged by as the row is
 * hovered (`tasks.css`) where another row stands to move it past; on
 * hover, Steer sends it into the turn now, the pencil takes it into the
 * message box to edit (`agent-composer.tsx`), and
 * the trash deletes it, asking first, since nothing brings its words and
 * files back. A message being edited stays in its place, muted, the queue
 * stopping at it, with Cancel on its row in every window that may change
 * the queue, so one left standing by a window gone is canceled from any
 * other. Any member who may message the agent changes every message in
 * it, whoever queued it; a reader who may not finds no press.
 * A queue standing paused says why
 * over its rows, after a Stop in the quiet tone and after a refusal in the
 * danger one, with Resume. Nothing is drawn while none is queued.
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

/** Someone the directory names nobody for, whose message it still is not the reader's. */
const UNNAMED_QUEUER: Actor = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };

/**
 * Who queued a message, where it is someone other than the reader: a member
 * by their face, one who left grayed, and anyone else as someone. Nobody for
 * the reader's own, as their own sent line names nobody; for a line that
 * went as an automation, GitHub, or another agent (`from`), whose sender the
 * queue names by name alone; for a row that names no queuer; and while the
 * directory has not read the members, so no face stands in for one it
 * would name.
 */
function queuerOf(message: QueuedMessage, directory: Directory): Actor | undefined {
  const { queuedBy } = message;
  const { members, readerId, former } = directory;

  if (queuedBy === "" || message.from !== undefined || members === undefined) return undefined;

  if (readerId === undefined || queuedBy === readerId) return undefined;

  const known =
    members.find((each) => each.userId === queuedBy) ??
    former?.find((each) => each.userId === queuedBy);

  return known === undefined
    ? UNNAMED_QUEUER
    : personActor({ userId: queuedBy, name: known.name }, members, readerId, former);
}

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
}: {
  messages: readonly QueuedMessage[];
  /** Whether the reader may change the queue, every message in it whoever queued it: any member who may message the agent. */
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
}): React.JSX.Element | null {
  const drag = useRowDrag(onMove, { handle: "[data-queue-handle]" });
  const directory = useMemberDirectory();
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

  if (messages.length === 0) return null;
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
            const queuer = queuerOf(message, directory);

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
                meta={queuer === undefined ? undefined : <ActorRef actor={queuer} faceOnly />}
                muted={edited}
                actionsAt={edited ? LIST_ROW_ACTIONS.ALWAYS : LIST_ROW_ACTIONS.HOVER}
                actions={
                  // Note that a reader who may not message the agent may change nothing of its queue.
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
                        variant={BUTTON_VARIANT.DANGER_QUIET}
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
        </List>
      </div>
      <ConfirmDialog open confirm={confirm} question={DELETE_QUESTION} />
    </div>
  );
}
