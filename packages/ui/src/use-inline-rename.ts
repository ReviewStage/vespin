import { useState } from "react";

/**
 * use-inline-rename.ts -- one surface's in-place rename of the thing it draws: whether its `InlineEdit` is open, and whether the name it last asked for was refused.
 */

/**
 * A rename as its caller's mutation stands (`useMutation`): how a name is
 * asked for, the newest one asked, whether it was refused once answered,
 * and the reset that lets it go. Nothing here keeps a rename's pending or
 * refusal of its own.
 */
export interface RenameWrite {
  readonly run: (subjectId: string, name: string) => void;
  /** The newest name asked, by the subject it was asked for, while out or once answered; none once let go of. */
  readonly asked: { readonly subjectId: string; readonly name: string } | undefined;
  /** Whether the newest name asked is still out, unanswered. */
  readonly pending: boolean;
  /** Whether the newest name asked was refused, once answered. */
  readonly refused: boolean;
  readonly reset: () => void;
}

/**
 * One surface's rename of the subject it draws, by the subject's id: whether
 * its field is open, and the name it asked for while that is out or a
 * refusal left it standing until the next edit. Both are held for the
 * subject they were about, so a surface that moves on to another draws
 * neither over it. Note that the field closes as soon as it ends, because the
 * new name is drawn at once: a surface draws its name as `asked ?? name`, so
 * the name asked stands from the press, whether or not what it reads the
 * name from draws a write still out, and never the old one until the answer
 * lands. A refusal reopens the field over the name that was asked, so it is
 * not lost to a retype. Ending that field on no change, or on Escape, lets
 * the refusal go, as a new edit does, and the old name stands again. The rename is the caller's
 * mutation, whose newest ask alone says whether a refusal stands, so the
 * refusal of a name a later one replaced says nothing of the name drawn now.
 */
export function useInlineRename(subjectId: string | undefined, write: RenameWrite) {
  const [editing, setEditing] = useState<string | undefined>(undefined);

  const begin = () => {
    write.reset();
    setEditing(subjectId);
  };

  const end = (name: string | undefined) => {
    setEditing(undefined);

    if (subjectId === undefined || name === undefined) {
      write.reset();

      return;
    }

    write.run(subjectId, name);
  };

  const shown = subjectId !== undefined;
  const mine = shown && write.asked?.subjectId === subjectId ? write.asked : undefined;
  const refused = mine !== undefined && write.refused;

  return {
    editing: shown && (editing === subjectId || refused),
    begin,
    end,
    refused,
    asked: write.pending || refused ? mine?.name : undefined,
  };
}

/** One surface's in-place rename, as `useInlineRename` answers it. */
export type InlineRename = ReturnType<typeof useInlineRename>;
