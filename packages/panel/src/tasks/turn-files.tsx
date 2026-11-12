/**
 * turn-files.tsx -- the files a turn changed, drawn on its Worked for line: the first few as chips with their own counts, then how many more, each opening the turn's changes standing on the file, or the file as any file chip does where no such tab opens from here.
 *
 * The chips stand on the turn's Worked for line (`agent-tab.tsx`'s
 * `TurnFoot`) only while the reader has Turn changes on, an experiment of
 * their own account, which the tab reads once and hands every turn with the
 * line that opened it (`TurnFilesOn`): off, no turn draws them, and so no
 * Turn changes tab opens from one. What they name is what the turn's runner
 * diffed when the turn ended, kept on the turn's row and carried on its
 * reply (`changedFiles`, `@repo/features/turn-files-wire`), the same diff
 * the Turn changes tab draws, so the two name the same files; a turn with
 * none kept, as one from before the summary or a Mac's host older than it,
 * draws none. The first `SHOWN_FILES` are each the chip the transcript draws
 * a file by everywhere (`mention-chip.tsx`'s `fileChip`), its type's icon
 * and its name, with the lines the turn added and removed after it in the
 * tones the pull request card counts in; a count of zero is not written, so
 * a file only added reads as its added lines alone. The rest are said as
 * how many more, which opens the turn's changes on the first of them.
 */

import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { CountParts, linesCount, TextButton } from "@repo/ui";
import { createContext, useContext } from "react";
import { TranscriptAgent } from "./line-cards.js";
import { fileChip, type MentionDoors } from "./mention-chip.js";
import { useMentionDoors } from "./task-mentions.js";

/** The developer's line that opened each reply's turn, by the reply's id, while the tab reads the experiment on; none where it is off, or no tab says. */
const TurnFilesOnContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);

/** Hands the turns under it the lines that opened them, which says they draw their files; none says they draw none. */
export const TurnFilesOn = TurnFilesOnContext.Provider;

/** How many of a turn's files stand as chips; the rest are said as how many more. */
const SHOWN_FILES = 3;

/** The words after the chips, for the files past them. */
const MORE = (count: number) => `+${count} more`;

/** The parts of a count: `+added` and `−removed`, each left out where it is zero. */
function changedCount(added: number, removed: number) {
  return linesCount(added, removed).filter((_, index) => (index === 0 ? added > 0 : removed > 0));
}

/** The files the turn changed, the first as chips with their counts and the rest as how many more; nothing where it kept none, or the experiment is off. */
export function TurnFilesRow({
  message,
}: {
  message: AgentTranscriptMessage;
}): React.JSX.Element | null {
  const doors = useMentionDoors();
  const lines = useContext(TurnFilesOnContext);
  const agentId = useContext(TranscriptAgent);
  const changed = message.changedFiles;
  const first = changed?.files[0];

  if (lines === undefined || changed === undefined || first === undefined) return null;
  // A chip opens the turn's own changes where a tab of them opens from here, and the file as any file chip does otherwise.
  const line = lines.get(message.id);
  const openTurn = doors.onOpenTurnChanges;

  const opens =
    openTurn === undefined || agentId === undefined || line === undefined
      ? undefined
      : (path: string) => openTurn(agentId, line, path);

  const chipDoors: MentionDoors = opens === undefined ? doors : { ...doors, onOpenFile: opens };
  const shown = changed.files.slice(0, SHOWN_FILES);
  const more = changed.total - shown.length;
  const next = changed.files[SHOWN_FILES]?.path ?? first.path;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-icon-gap" data-turn-files="">
      <span aria-hidden="true">·</span>
      {shown.map((file) => (
        <span key={file.path} className="inline-flex min-w-0 max-w-full">
          {fileChip(
            file.path,
            chipDoors,
            <span className="tabular-nums">
              <CountParts parts={changedCount(file.additions, file.deletions)} />
            </span>,
          ) ?? file.path}
        </span>
      ))}
      {more <= 0 ? null : opens === undefined ? (
        <span className="tabular-nums">{MORE(more)}</span>
      ) : (
        <TextButton onClick={() => opens(next)}>{MORE(more)}</TextButton>
      )}
    </span>
  );
}
