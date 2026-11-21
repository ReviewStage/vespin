import { RESTORE_FILES_WORDS, REWIND_WORDS, revertAsk } from "@repo/features/agent-rewind-model";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  Checkbox,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  HeldMessageAction,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext, useState } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { confirmFailure } from "../failure-report.js";
import type { EditComposerDoors } from "./edit-composer.js";

/**
 * rewind-action.tsx -- a coding agent taken back to an earlier point of its transcript: a line of the developer's Edit, which writes it again where it stands, and a reply's Rewind conversation to here.
 *
 * An agent's tab hands its messages what a rewind takes (`RewindProvider`):
 * Edit opens a line for writing again in its own place, in the agent's own
 * message box (`edit-composer.tsx`), leaving the foot's box as it is, and its Send takes the agent
 * back to just before it, so the new words go in its place, asked first where
 * anything follows the line, since what it drops is gone; Rewind conversation to here, asked
 * first for the same reason, takes the agent back to just after a
 * reply, dropping the developer's next line and everything after it. Only a
 * line that opened a turn is written again, and a reply is reverted to only
 * where such a line follows it, since a line a turn took in while it ran sits
 * inside that turn's work. Only the conversation goes back unless the
 * developer ticks the files back too: where the agent's runner recorded the
 * checkout before the turn the line opened (`filesRestorable` on the line),
 * either rewind offers "Also restore the agent's files to this point", off
 * each time it is offered, which puts the working tree back to that point
 * and moves no commit; the checkout stays as it is otherwise. A worker's
 * tab hands none.
 */

/** What Rewind conversation to here asks before it drops anything, in `revertAsk`'s words. */
function revertQuestion(takes: string | undefined, restoring: boolean): DialogQuestion {
  return {
    ...revertAsk(takes, restoring),
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    // Note that `takes` names the members whose messages go.
    bodyReplayMasked: takes !== undefined,
  };
}

/** What an agent's tab hands its messages: Edit of a line, and Rewind conversation to here of a reply. */
interface RewindDoors {
  /** The line open for writing again where it stands, by its message id; none while none is. */
  readonly editing: string | undefined;
  /** Opens one of the developer's lines for writing again where it stands. */
  readonly onEdit: (messageId: string) => void;
  /** Closes the line open for writing again, sending nothing. */
  readonly onCancelEdit: () => void;
  /** Sends the words and files in place of the line named, the agent's files put back too where `restoreFiles`. */
  readonly onSendEdit: (
    messageId: string,
    words: string,
    attachments: readonly AgentAttachment[],
    restoreFiles: boolean,
  ) => void;
  /** What the line's box is drawn with beside the tab's own box, read as it opens, so what it reads stands as it was while the tab's props change. */
  readonly editor: () => Omit<
    EditComposerDoors,
    "cuts" | "takes" | "restorable" | "onCancel" | "onSend"
  >;
  /** Takes the agent back to just before the line named, sending nothing, its files put back too where `restoreFiles`. */
  readonly onRevert: (lineId: string, restoreFiles: boolean) => void;
  /** The line a reply's Rewind conversation to here drops from, by the reply's id: the developer's next line that opened a turn; none where none follows it. */
  readonly revertsAt: ReadonlyMap<string, string>;
  /** The lines Edit writes again, by their ids: the developer's lines that opened a turn. */
  readonly editable: ReadonlySet<string>;
  /** The messages something follows, by their ids, so the send of a line written again drops them and asks first. */
  readonly followed: ReadonlySet<string>;
  /** What a reply's Rewind conversation to here drops of other members' messages, by the reply's id, as "2 messages from Sam"; none where it drops none of theirs. */
  readonly revertTakes: ReadonlyMap<string, string>;
  /** What the send of a line written again drops of other members' messages, by the line's id, said as `revertTakes` does; none where it drops none of theirs. */
  readonly editTakes: ReadonlyMap<string, string>;
  /** The lines a rewind to just before can put the agent's files back at, by their ids: those whose turn the runner recorded the checkout before, while the workspace's experiment is on. */
  readonly restorable: ReadonlySet<string>;
}

const RewindContext = createContext<RewindDoors | undefined>(undefined);

/** Hands an agent's messages what a rewind takes. */
export function RewindProvider({
  value,
  children,
}: {
  value: RewindDoors | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return <RewindContext value={value}>{children}</RewindContext>;
}

/** A line's Edit, after its Copy and Copy link; nothing where its tab offers no rewind, or the line opened no turn. */
export function EditMessageAction({ messageId }: { messageId: string }): ReactNode {
  const doors = useContext(RewindContext);

  if (doors === undefined || !doors.editable.has(messageId)) return null;

  return (
    <MessageAction
      label={REWIND_WORDS.EDIT}
      tooltip={REWIND_WORDS.EDIT}
      onClick={() => doors.onEdit(messageId)}
    >
      <GLYPH.RENAME />
    </MessageAction>
  );
}

/** A reply's Rewind conversation to here, asked first, the files offered back too where the point allows; nothing where its tab offers no rewind, or no line of the developer's follows it. */
export function RevertMessageAction({ messageId }: { messageId: string }): ReactNode {
  const doors = useContext(RewindContext);
  const lineId = doors?.revertsAt.get(messageId);
  const restorable = lineId !== undefined && doors?.restorable.has(lineId) === true;
  // Note that the choice is off each time the question is asked, so a rewind never puts the files back unasked.
  const [restoring, setRestoring] = useState(false);

  // Note that the revert answers at once: the box takes it in turn behind any send, and says there if it did not go.
  const confirm = useConfirmDialog(
    { subject: lineId !== undefined, surfaceOpen: true },
    neverBusyAct(() => {
      if (lineId !== undefined) doors?.onRevert(lineId, restorable && restoring);
    }),
    confirmFailure(FAILURE_SURFACE.AGENT_REWIND),
  );

  if (doors === undefined || lineId === undefined) return null;

  // Note that its question waits with its button until the turn's actions are drawn (`HeldMessageAction`).
  return (
    <HeldMessageAction>
      <MessageAction
        label={REWIND_WORDS.REVERT}
        tooltip={REWIND_WORDS.REVERT}
        onClick={() => {
          setRestoring(false);
          confirm.ask();
        }}
      >
        <GLYPH.GO_BACK />
      </MessageAction>
      <ConfirmDialog
        open
        confirm={confirm}
        question={revertQuestion(doors.revertTakes.get(messageId), restorable && restoring)}
      >
        {restorable ? (
          <Checkbox checked={restoring} onChange={setRestoring}>
            {RESTORE_FILES_WORDS}
          </Checkbox>
        ) : undefined}
      </ConfirmDialog>
    </HeldMessageAction>
  );
}

/** What the line named is written again with, where it is open for writing; none while it is not open, or its tab offers no rewind. */
export function useMessageEdit(messageId: string): EditComposerDoors | undefined {
  const doors = useContext(RewindContext);

  if (doors === undefined || doors.editing !== messageId) return undefined;

  return {
    ...doors.editor(),
    onCancel: doors.onCancelEdit,
    cuts: doors.followed.has(messageId),
    takes: doors.editTakes.get(messageId),
    restorable: doors.restorable.has(messageId),
    onSend: (words, attachments, restoreFiles) =>
      doors.onSendEdit(messageId, words, attachments, restoreFiles),
  };
}
