/**
 * description-history-words.ts -- what a task description's version history says on the desktop, the web, and the iOS app alike: its title, a revision's writer and what it did, and its restore.
 *
 * The panel draws a revision's writer through `@repo/ui`'s actor model,
 * with their picture; the phone names them in the same words from the
 * revision line alone (`revisionWriterName`), since it draws no actor.
 */

import { PRODUCT_NAME } from "./product-name.js";
import {
  DESCRIPTION_ACTOR,
  type DescriptionLastEdit,
  type DescriptionRevisionLine,
} from "./task-wire.js";
import { dayAndTimeText } from "./time-format.js";

/** What the version history says, wherever it is drawn. */
export const VERSION_HISTORY_WORDS = {
  TITLE: "Version history",
  NONE: "No versions yet.",
  /** What the newest version, the description as it stands, is marked as on the phone's list. */
  CURRENT: "Current",
  RESTORE: "Restore this version",
  /** Why Restore this version stands unavailable over the newest version. */
  ALREADY_CURRENT: "This version is already current",
  RESTORED: "Version restored",
  RESTORE_REFUSED: "The version could not be restored. Try again.",
  /** What a restore's Undo says where the version before it could not be put back. */
  UNDO_REFUSED: "The restore could not be undone. Try again.",
  /** Why the history stands empty where its first read failed. */
  UNREAD: "The history could not be read.",
  OLDER_UNREAD: "Could not read older versions.",
  VERSION_UNREAD: "Could not read this version.",
} as const;

/** What a writer the history cannot name is called, as the panel's actor model names them. */
const UNNAMED_WRITER = {
  YOU: "You",
  SOMEONE: "Someone",
  EARLIER: "Earlier",
  AGENT: "Agent",
} as const;

/** What a revision did, in a few words: the version a restore brought back, the description before history, or how many changes its saves made. */
export function revisionSummary(line: DescriptionRevisionLine): string {
  if (line.restoredFrom !== undefined) {
    return `Restored the version from ${dayAndTimeText(line.restoredFrom.at)}`;
  }

  if (line.lastEdit.actor === DESCRIPTION_ACTOR.EARLIER)
    return "The description before its history began";

  return line.changes === 1 ? "1 change" : `${line.changes} changes`;
}

/** Who wrote a revision, as the panel's row names them: You for the reader's own, a member by name, the app, a coding agent by its title, or Earlier for the description before history. */
export function revisionWriterName(
  lastEdit: Pick<DescriptionLastEdit, "actor" | "by" | "label">,
  readerId: string | undefined,
): string {
  switch (lastEdit.actor) {
    case DESCRIPTION_ACTOR.DEVELOPER:
      if (lastEdit.by === undefined) return UNNAMED_WRITER.SOMEONE;

      return readerId !== undefined && lastEdit.by.userId === readerId
        ? UNNAMED_WRITER.YOU
        : lastEdit.by.name;
    case DESCRIPTION_ACTOR.NOTETAKER:
      return PRODUCT_NAME;
    case DESCRIPTION_ACTOR.AGENT:
      return lastEdit.label ?? UNNAMED_WRITER.AGENT;
    case DESCRIPTION_ACTOR.EARLIER:
      return UNNAMED_WRITER.EARLIER;
  }
}
