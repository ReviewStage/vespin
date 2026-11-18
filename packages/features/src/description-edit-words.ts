/**
 * description-edit-words.ts -- what a conflict over the developer's own edit of a description says, on the desktop, the web, and the iOS app alike: its note, and the press that takes the other writer's words.
 *
 * The panel names the writer through `@repo/ui`'s actor model, which finds
 * a coding agent among the task's agents; the phone names them from the
 * conflict's last edit alone (`revisionWriterName`). Both say it in these
 * words.
 */

import { revisionWriterName } from "./description-history-words.js";
import { DESCRIPTION_ACTOR, type DescriptionLastEdit } from "./task-wire.js";

/** What a conflict over the developer's edit says, and the press that takes the other writer's words. */
export interface ConflictWords {
  readonly note: string;
  readonly take: string;
}

/** What every conflict offers beside taking the other writer's words: the developer's own laid over them. */
export const KEEP_MINE = "Keep mine";

/** A conflict whose writer the service named nobody for, as a service from before it answers. */
export const UNNAMED_CONFLICT: ConflictWords = {
  note: "This section changed while you were editing.",
  take: "Use theirs",
};

/** A conflict with the reader's own words saved elsewhere, as from another window. */
export const OWN_CONFLICT: ConflictWords = {
  note: "You changed this section elsewhere while you were editing.",
  take: "Use the other",
};

/** A conflict with words someone else wrote, named as the "Edited by" line names them: "Charles Pan changed this section while you were editing." and "Use Charles Pan’s". */
export function namedConflict(name: string): ConflictWords {
  return {
    note: `${name} changed this section while you were editing.`,
    take: `Use ${name}’s`,
  };
}

/**
 * What a conflict says where the writer is named from the conflict's last
 * edit alone, as the phone names one: nobody for a service that named none or
 * the description before history, the reader's own as saved elsewhere, and
 * anyone else as the version history names them (`revisionWriterName`).
 */
export function lastEditConflict(
  edit: DescriptionLastEdit | undefined,
  readerId: string | undefined,
): ConflictWords {
  if (edit === undefined || edit.actor === DESCRIPTION_ACTOR.EARLIER) return UNNAMED_CONFLICT;

  const own =
    edit.actor === DESCRIPTION_ACTOR.DEVELOPER &&
    readerId !== undefined &&
    edit.by?.userId === readerId;

  return own ? OWN_CONFLICT : namedConflict(revisionWriterName(edit, undefined));
}
