import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  acknowledgedOnOpen,
  type InboxListed,
  isUnread,
  settledOnRead,
} from "@repo/features/inbox-list-model";
import { remindWords } from "@repo/features/inbox-remind-times";
import type { InboxItem } from "@repo/features/inbox-wire";
import { markedNote, REMIND_REFUSED } from "@repo/features/inbox-write-words";
import { FAILURE_SURFACE, type FailureAbout } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { firstRefusal, KEPT, type Kept, notKept, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { afterPaint } from "../after-paint.js";
import { useAppCommand } from "../app-commands.js";
import { useToast } from "../toast.js";
import { useInboxAcknowledger } from "./inbox-acknowledge.js";
import type { InboxReminder, RemindSaying } from "./inbox-remind.js";
import { useInboxPresses } from "./inbox-writes.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * use-inbox-read-marks.ts -- the Inbox's read and unread marks as one control: an item marked read or unread, or every item marked read, its dot flipping at once.
 *
 * A mark goes to the service as an act, which the host draws into every
 * read the window draws the moment it is asked, and holds there until each
 * carries it (`@repo/host`'s `inbox-collections.ts`), so the dot flips at
 * once and never flickers back, and answers once the service takes it; the
 * host sends one item's marks in the order they were asked, so a quick read,
 * unread, read reaches the service as the last, Mark all as read in its turn
 * among them, and marks on other items at once. A mark the
 * service did not take is taken back by the host, the dot standing as the
 * reads hold it, and a toast says so, unless the caller asks for quiet
 * because it says the refusal itself, as the selection bar does for the
 * items it marked together. Marking every item read marks the items the
 * Inbox lists in the one workspace it lists, as the service marks them. A
 * task's items are marked read each on its own instead (`onMarkEach`), since
 * the service marks a whole workspace's at once, and one toast says what it
 * refused.
 *
 * Marking an item read by hand, one or every one, also acknowledges each of
 * the reader's own notices among them that opening would (`settledOnRead`),
 * so a thread that asks nothing stops waiting on them as it does once
 * opened; a question keeps waiting, since only its answer settles it. A
 * notice put away under a reminder still ahead keeps it. The notices go as
 * Got it does, held behind a toast whose Undo has them wait again
 * (`inbox-acknowledge.tsx`).
 *
 * Opening an item marks it read, once each time it is shown
 * (`useReadOnOpen`), so an item the reader marks unread while it is shown
 * stays unread until they open it again, as a mail app keeps it; and a
 * plain U marks the chosen item read or unread, as its row's menu says.
 * Opening the reader's own notice acknowledges it too (`useNodOnOpen`),
 * once each time it is shown, so an update counts as seen once it is opened.
 * Either is sent once the frame that draws the item has painted
 * (`afterPaint`), so the write never holds up the thread being drawn; an
 * item stepped past before then is still marked, as it was opened.
 */

/** How a mark is told: `quiet` where the caller says a refusal itself, so it is never toasted twice. */
export interface MarkSaying {
  readonly quiet?: boolean | undefined;
}

/** What the Inbox's read marks offer: the presses that mark. */
export interface InboxReadMarks {
  /** Marks one item read or unread, a notice marked read acknowledged too (`settledOnRead`); answers, once the mark went, whether the service took it, with what refused it where it did not, as a batch of marks counts what it refused. A refusal is toasted unless `saying` is quiet. */
  readonly onMark: (item: InboxItem, unread: boolean, saying?: MarkSaying) => Promise<Kept>;
  /** Marks an item read as opening it does, acknowledging nothing, since opening acknowledges a notice on its own (`useNodOnOpen`). */
  readonly onOpenRead: (item: InboxItem, unread: boolean) => Promise<Kept>;
  /** Marks every item given that is unread as read, as the service marks the listed workspace's, and acknowledges the notices among them (`settledOnRead`). */
  readonly onMarkAll: (items: readonly InboxItem[]) => void;
  /** Marks every item given that is unread as read, each on its own, as a task's are marked, the rest of the workspace's left as they are, and acknowledges the notices among them (`settledOnRead`). */
  readonly onMarkEach: (items: readonly InboxItem[]) => void;
  /** Sets one item's reminder for an instant, offering Undo, or cancels it where none is given, leaving whether it is read alone; answers whether the service took it, and a refusal is toasted. */
  readonly onRemind: InboxReminder;
}

/** What a mark the act channel refused hears, as the service not answering. */
const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** The Inbox's read marks, each sent on its act's mutation; every item marked read in `workspaceId` where the Inbox lists one, and the notices of `readerId`'s it settles acknowledged. */
export function useInboxReadMarks({
  workspaceId,
  readerId,
}: {
  workspaceId: string | undefined;
  readerId: string | undefined;
}): InboxReadMarks {
  const toast = useToast();
  const { mutateAsync: sendReadState } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_READ_STATE));
  const { mutateAsync: sendReadAll } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_READ_ALL));
  const { mutateAsync: sendRemind } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_REMIND));

  const refused = useCallback(
    (words: string, cause: unknown, about: FailureAbout) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.INBOX_MARK, cause, about },
      }),
    [toast],
  );

  const acknowledge = useInboxAcknowledger();

  const nodAll = useCallback(
    (items: readonly InboxItem[]) => {
      const now = Date.now();
      const nodding = items.filter((item) => settledOnRead(item, readerId, now));

      if (nodding.length > 0) acknowledge(nodding);
    },
    [acknowledge, readerId],
  );

  const sendMark = useCallback(
    (item: InboxItem, unread: boolean, saying?: MarkSaying): Promise<Kept> =>
      sendReadState({ itemId: item.id, unread })
        .catch(unreached)
        .then((answer) => {
          if (!("failure" in answer)) return KEPT;

          if (saying?.quiet !== true) {
            refused(markedNote(unread, 0, 1), answer, { inboxItemId: item.id, workspaceId });
          }

          return notKept(answer);
        }),
    [sendReadState, workspaceId, refused],
  );

  const onMark = useCallback(
    (item: InboxItem, unread: boolean, saying?: MarkSaying): Promise<Kept> => {
      if (!unread) nodAll([item]);

      return sendMark(item, unread, saying);
    },
    [sendMark, nodAll],
  );

  const onMarkAll = useCallback(
    (items: readonly InboxItem[]) => {
      nodAll(items);
      const itemIds = items.flatMap((item) => (isUnread(item) ? [item.id] : []));

      if (itemIds.length === 0) return;
      sendReadAll({
        ...(workspaceId === undefined ? undefined : { workspaceId }),
        itemIds,
      })
        .catch(unreached)
        .then((answer) => {
          if ("failure" in answer)
            refused(markedNote(false, 0, itemIds.length), answer, { workspaceId });
        });
    },
    [sendReadAll, nodAll, workspaceId, refused],
  );

  // Note that each item's mark goes on its own, there being no act marking several but the workspace's whole, and one toast answers them all.
  const onMarkEach = useCallback(
    (items: readonly InboxItem[]) => {
      nodAll(items);
      const marking = items.filter(isUnread);

      if (marking.length === 0) return;
      void Promise.all(marking.map((item) => sendMark(item, false, { quiet: true }))).then(
        (taken) => {
          const landed = taken.filter((each) => each.kept).length;

          if (landed === marking.length) return;
          refused(markedNote(false, landed, marking.length - landed), firstRefusal(taken), {
            workspaceId,
          });
        },
      );
    },
    [sendMark, nodAll, workspaceId, refused],
  );

  const { remind } = useInboxPresses();

  // Note that a reminder reaches the reader alone and is undone by putting back what it replaced, so it asks nothing and offers Undo through the undo stack, as the panel's other such acts do.
  const onRemind = useCallback(
    (item: InboxItem, until: number | null, saying?: RemindSaying): Promise<Kept> => {
      const pressed = until === null || saying?.quiet === true ? undefined : remind([item], until);

      return sendRemind({ itemId: item.id, until })
        .catch(unreached)
        .then((answer) => {
          if ("failure" in answer) {
            refused(until === null ? REMIND_REFUSED.CLEAR : REMIND_REFUSED.SET, answer, {
              inboxItemId: item.id,
              workspaceId,
            });

            return notKept(answer);
          }

          if (pressed !== undefined && until !== null) {
            const words = `Reminder set for ${remindWords(until, Date.now())}`;
            const said = pressed.keep(words);

            if (said !== undefined) toast(said);
          }

          return KEPT;
        });
    },
    [sendRemind, remind, workspaceId, refused, toast],
  );

  return useMemo(
    () => ({ onMark, onMarkAll, onMarkEach, onOpenRead: sendMark, onRemind }),
    [onMark, onMarkAll, onMarkEach, sendMark, onRemind],
  );
}

/**
 * Marks the item an Inbox shows read as it is opened, once each time it is
 * shown, acknowledging nothing, since `useNodOnOpen` acknowledges a notice
 * opened on its own; and offers U, which marks the chosen item read or
 * unread as its row's menu does, while the Inbox stands. `shown` is the item
 * the pane draws, none while the Inbox is hidden or shows its list alone.
 */
export function useReadOnOpen({
  shown,
  chosen,
  active,
  marks,
}: {
  shown: InboxItem | undefined;
  chosen: InboxItem | undefined;
  active: boolean;
  marks: Pick<InboxReadMarks, "onMark" | "onOpenRead">;
}): void {
  const { onMark, onOpenRead } = marks;
  const readOn = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shown === undefined) {
      readOn.current = undefined;

      return;
    }

    if (readOn.current === shown.id) return;
    readOn.current = shown.id;

    if (isUnread(shown)) afterPaint(() => onOpenRead(shown, false));
  }, [shown, onOpenRead]);
  useAppCommand(
    APP_COMMAND.TOGGLE_READ,
    active && chosen !== undefined ? () => onMark(chosen, !isUnread(chosen)) : undefined,
  );
}

/**
 * Acknowledges the notice an Inbox shows as it is opened, as Got it did,
 * once for each revision each time it is shown, where opening it settles it
 * (`inbox-model.ts`'s `acknowledgedOnOpen`): the reader's own, messaging
 * nobody, and its box holding no words or files, which stay a reply to send. `shown` is the item the pane
 * draws, none while the Inbox is hidden or shows its list alone; `control`
 * is its holder's control, which the item is waited on until its board
 * draws it from a read of the service's, the account's feed or the
 * holder's own, so the answer names the revision the service holds. An
 * item opened while it cannot be acknowledged is left as it is until it is
 * opened again, so a box emptied of its draft does not settle it under the
 * reader's hands.
 */
export function useNodOnOpen({
  shown,
  readerId,
  control,
}: {
  shown: InboxListed | undefined;
  readerId: string | undefined;
  control: Pick<TaskInboxControl, "drawn" | "failed" | "draftOf" | "onAcknowledge">;
}): void {
  const nodded = useRef<{ readonly id: string; readonly revision: number } | undefined>(undefined);
  const { drawn, failed, draftOf, onAcknowledge } = control;
  useEffect(() => {
    if (shown === undefined) {
      nodded.current = undefined;

      return;
    }

    // Note that nothing is settled until a read of the holder and the reader's id stand, so neither an older revision nor a teammate's notice is acknowledged.
    if (!drawn || failed || readerId === undefined) return;
    const { item } = shown;
    const was = nodded.current;

    if (was !== undefined && was.id === item.id && was.revision === item.revision) return;
    nodded.current = { id: item.id, revision: item.revision };

    if (!acknowledgedOnOpen(item, readerId)) return;
    const draft = draftOf(item);

    if (draft.note.trim() !== "" || draft.attachments.length > 0) return;
    afterPaint(() => onAcknowledge(item));
  }, [shown, readerId, drawn, failed, draftOf, onAcknowledge]);
}
