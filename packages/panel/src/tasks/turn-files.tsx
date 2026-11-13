/**
 * turn-files.tsx -- the files a turn changed, drawn on its Worked for line: how many and the lines added and removed over all of them, opening the turn's changes.
 *
 * The count stands on the turn's Worked for line (`agent-tab.tsx`'s
 * `TurnFoot`) only while the reader has Turn changes on, an experiment of
 * their own account, which the tab reads once and hands every turn with the
 * line that opened it (`TurnFilesOn`): off, no turn draws it, and so no
 * Turn changes tab opens from one. What it counts is what the turn's runner
 * diffed when the turn ended, kept on the turn's row and carried on its
 * reply (`changedFiles`, `@repo/features/turn-files-wire`), the same diff
 * the Turn changes tab draws, so the two agree; a turn with none kept, as
 * one from before the summary or a Mac's host older than it, draws none.
 * The count names no file: a press on it opens the turn's changes on its
 * first file, where the Turn changes tab names them all, and it stands as
 * words where no such tab opens from here. A line count of zero is not
 * written, so a turn that only added reads as its added lines alone.
 */

import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { WORKED_SEPARATOR } from "@repo/features/time-format";
import { countWords, TERM } from "@repo/features/words";
import { CountParts, linesCount, TextButton } from "@repo/ui";
import { createContext, useContext } from "react";
import { TranscriptAgent } from "./line-cards.js";
import { useMentionDoors } from "./task-mentions.js";

/** The developer's line that opened each reply's turn, by the reply's id, while the tab reads the experiment on; none where it is off, or no tab says. */
const TurnFilesOnContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);

/** Hands the turns under it the lines that opened them, which says they draw their files; none says they draw none. */
export const TurnFilesOn = TurnFilesOnContext.Provider;

/** The parts of a count: `+added` and `−removed`, each left out where it is zero. */
function changedCount(added: number, removed: number) {
  return linesCount(added, removed).filter((_, index) => (index === 0 ? added > 0 : removed > 0));
}

/** How many files the turn changed and its lines over them, opening its changes; nothing where it kept none, or the experiment is off. */
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
  const line = lines.get(message.id);
  const openTurn = doors.onOpenTurnChanges;

  const totals = (
    <span className="inline-flex items-center gap-icon-gap tabular-nums">
      {countWords(changed.total, TERM.FILE)}
      <CountParts parts={changedCount(changed.additions, changed.deletions)} />
    </span>
  );

  return (
    // Note that the dot is the Worked for line's own, spaces and all, so it stands as far from the words on either side as the line's dot does.
    <span className="flex min-w-0 items-center" data-turn-files="">
      <span aria-hidden="true" className="whitespace-pre">
        {WORKED_SEPARATOR}
      </span>
      {openTurn === undefined || agentId === undefined || line === undefined ? (
        totals
      ) : (
        <TextButton onClick={() => openTurn(agentId, line, first.path)}>{totals}</TextButton>
      )}
    </span>
  );
}
