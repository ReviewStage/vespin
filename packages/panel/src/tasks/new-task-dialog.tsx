import { DIALOG_SIZE, Dialog, type DialogHandle } from "@repo/ui";
import { type RefObject, useId, useMemo, useRef, useState } from "react";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { usePhoneRoom } from "../stage-room.js";
import { useDrawnThroughExit } from "../use-held-through-exit.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer, PURPOSE_HEADING } from "./new-task-composer.js";
import { NEW_TASK_PURPOSE } from "./new-task-purpose.js";
import { type NewTaskPreset, useNewTaskShown } from "./use-new-task.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-dialog.tsx -- New task as a small modal over the window: the title, and the composer card whose words start a coding agent, or a plan with the app.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds New task's composer
 * (`new-task-composer.tsx`), which takes focus, the card named by the
 * composer's own head row: "New task", named to a reader alone, and the
 * repository chip after it, as Home draws it too. The task starts in the workspace the
 * window lists, and the dialog offers no other; the composer lists that
 * workspace's repositories.
 *
 * What the composer starts is its own to say: in Agent mode a task with an
 * empty description and a coding agent on the words, opened on the agent's tab; in
 * Plan mode an empty description and a call with the app. Tab stays inside the
 * card, and focus goes back to whatever opened it. Escape, with no menu or
 * dictation standing in the card, and a press on the dimmed window put the
 * card away with nothing started, its words and files kept as New task's
 * draft for the next opening (`../composer-drafts.ts`). A start under way
 * holds the card. A refusal keeps the card with the reason under the
 * composer, and Start can be pressed again; a task started closes the card
 * and opens as the host's open task.
 *
 * On a phone the card is a sheet the screen's whole height instead
 * (`DIALOG_SIZE.PAGE_SHEET`), as a phone's own compose sheet stands: "New
 * task" centered at its head with a close in its start corner, which puts
 * it away as Escape does, its draft kept, and the composer at its foot, on
 * the keyboard, the room over it empty. What it starts, and how, is the
 * card's.
 *
 * The add menu's New task, and a task's menu and ⌘K's New sub-task, open
 * this same card with that task's relation as a row over it (New task's preset's
 * `relation`), started in that task's workspace rather than the one listed.
 *
 * The Automations page's Create with an agent opens this same card for the
 * agent that makes an automation (New task's preset's `purpose`), so it is
 * asked as New task asks.
 */

/** What a phone's sheet's close is called, which puts it away as Escape does. */
const CLOSE_LABEL = "Close";

/** The composer's words field, the editor's own root, which the card hands focus to. */
const FIELD_SELECTOR = EDITOR_ROOT_SELECTOR;

/** The dialog's own card, which holds focus while the field has not landed. */
const CARD_SELECTOR = '[aria-modal="true"]';

/**
 * The card with its own state, mounted afresh on each opening so its picks
 * start over, and whether a start is under way, which holds the card. Its
 * words are the draft's, which the opening brings back.
 */
function NewTaskCard({
  open,
  preset,
  newTask,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  /** What the press that opened the card chose (`NewTaskShown.preset`). */
  preset: NewTaskPreset | undefined;
  newTask: TasksControl["newTask"];
  onExited: () => void;
}): React.JSX.Element {
  const [starting, setStarting] = useState(false);
  // The Automations page's Create with an agent opens this card for an automation's agent, and a refusal opens it again for the same.
  const purpose = preset?.purpose ?? NEW_TASK_PURPOSE.TASK;
  // A relation's New task opens it related to a task, whose workspace the new task starts in, as does a refused card opened again on its relations.
  const related = preset?.relation ?? preset?.refused?.card.relations[0];
  const workspaceId = related?.task.workspaceId ?? newTask.workspaceId;
  const dialog = useRef<DialogHandle>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);

  // Note that the field is the editor the composer mounts once its bundle
  // has landed, so the card hands focus to it by where it stands rather than
  // by a ref of its own; before it lands the card holds focus, and the field
  // takes the caret itself as it lands.
  const field = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        const card = body.current?.closest<HTMLElement>(CARD_SELECTOR) ?? null;

        return body.current?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? card;
      },
    }),
    [],
  );

  // A phone's sheet names itself in its own head; the card is named by the composer's head row.
  const phone = usePhoneRoom();

  const name = phone
    ? { size: DIALOG_SIZE.PAGE_SHEET, title: PURPOSE_HEADING[purpose], closeLabel: CLOSE_LABEL }
    : { size: DIALOG_SIZE.COMPOSER, labelledBy: titleId };

  const close = () => {
    if (!starting) newTask.onClose();
  };

  return (
    <Dialog
      open={open}
      {...name}
      ref={dialog}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
      onExited={onExited}
    >
      <div className="new-task flex min-h-0 flex-col gap-block-gap" ref={body}>
        <NewTaskComposer
          newTask={newTask}
          preset={preset}
          workspaceId={workspaceId}
          onStarting={setStarting}
          // Note that the field's Escape goes through the dialog, so a start under way holds it back as it holds the card's own.
          onLeave={() => dialog.current?.dismiss()}
          focusedByOwner
          titleId={phone ? undefined : titleId}
          titledByOwner={phone}
          purpose={purpose}
          // Note that the dialog's card is not at a page's top, so a list rises over the line as an agent's box's does.
          listSide={MENTION_MENU_SIDE.ABOVE}
        />
      </div>
    </Dialog>
  );
}

/** The card over the window while New task is asked, in `@repo/ui`'s shared `Dialog`, and through its fade as it goes; nothing otherwise. */
export function NewTaskDialog({
  newTask,
}: {
  newTask: TasksControl["newTask"];
}): React.JSX.Element | null {
  const { open, preset } = useNewTaskShown();
  // Note that the card is drawn from its opening until its fade has run, because its picks are its own and start over each time it opens.
  const { drawn, onExited } = useDrawnThroughExit(open);
  // Each opening is a card of its own, so one asked while the last still fades, as ⌘N right after
  // a start is, opens afresh rather than bringing back the closing card and the start it holds;
  // so is a card opened on another preset over one standing, as a refused start's Open does.
  const [openings, setOpenings] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const [wasPreset, setWasPreset] = useState(preset);

  if (wasOpen !== open || wasPreset !== preset) {
    if (open && (!wasOpen || wasPreset !== preset)) {
      setOpenings((count) => count + 1);
    }

    setWasOpen(open);
    setWasPreset(preset);
  }

  if (!drawn) return null;

  return (
    <NewTaskCard key={openings} open={open} preset={preset} newTask={newTask} onExited={onExited} />
  );
}
