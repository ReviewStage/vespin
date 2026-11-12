/**
 * turn-files.tsx -- the files a turn changed, drawn under its words: how many and the lines added and removed, then each file's chip with its own counts, which opens the turn's changes standing on the file, or the file as any file chip does where no such tab opens from here.
 *
 * The row stands in the turn's foot, over its Worked for line
 * (`agent-tab.tsx`'s `TurnFoot`), only while the task's workspace has
 * Rewind restores files on, the experiment a turn's files are offered back
 * under, which the tab reads once and hands every turn with the line that
 * opened it (`TurnFilesOn`): off, no turn draws it. A chip opens the turn's
 * Changes tab standing on the file, the diff of the turn's checkouts read
 * on the agent's machine (`agent-changes-tab.tsx`'s `TurnChangesTab`). What it lists is read from the turn's own
 * edits (`@repo/features/turn-files`), nothing from the checkout, so it
 * stands as soon as the turn's parts do. Each file is the chip the
 * transcript draws a file by everywhere (`mention-chip.tsx`'s `fileChip`),
 * its type's icon and its name, with the lines the turn added and removed
 * after it in the tones the pull request card counts in; a count of zero is
 * not written, so a file only added reads as its added lines alone.
 */

import { agentParts } from "@repo/features/agent-parts";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { turnFiles } from "@repo/features/turn-files";
import { countWords, TERM } from "@repo/features/words";
import { CountParts, linesCount } from "@repo/ui";
import { createContext, useContext, useMemo } from "react";
import { TranscriptAgent } from "./line-cards.js";
import { fileChip, type MentionDoors } from "./mention-chip.js";
import { useMentionDoors } from "./task-mentions.js";

/** The developer's line that opened each reply's turn, by the reply's id, while the tab reads the experiment on; none where it is off, or no tab says. */
const TurnFilesOnContext = createContext<ReadonlyMap<string, string> | undefined>(undefined);

/** Hands the turns under it the lines that opened them, which says they draw their files; none says they draw none. */
export const TurnFilesOn = TurnFilesOnContext.Provider;

/** The words after the count: what the lines did. */
const CHANGED = "changed";

/** The parts of a count: `+added` and `−removed`, each left out where it is zero. */
function changedCount(added: number, removed: number) {
  return linesCount(added, removed).filter((_, index) => (index === 0 ? added > 0 : removed > 0));
}

/** The files the turn changed, each as its chip with its counts, led by how many and the turn's totals; nothing where the turn changed none, or the experiment is off. */
export function TurnFilesRow({
  message,
}: {
  message: AgentTranscriptMessage;
}): React.JSX.Element | null {
  const doors = useMentionDoors();
  const lines = useContext(TurnFilesOnContext);
  const agentId = useContext(TranscriptAgent);

  const changed = useMemo(
    () => (lines === undefined ? undefined : turnFiles(agentParts(message))),
    [lines, message],
  );

  if (lines === undefined || changed === undefined) return null;
  // A chip opens the turn's own changes where a tab of them opens from here, and the file as any file chip does otherwise.
  const line = lines.get(message.id);
  const openTurn = doors.onOpenTurnChanges;

  const chipDoors: MentionDoors =
    openTurn === undefined || agentId === undefined || line === undefined
      ? doors
      : { ...doors, onOpenFile: (path) => openTurn(agentId, line, path) };

  return (
    <div className="mt-tight-gap flex flex-wrap items-center gap-icon-gap" data-turn-files="">
      <span className="text-caption text-muted-foreground tabular-nums">
        {countWords(changed.files.length, TERM.FILE)} {CHANGED}{" "}
        <CountParts parts={changedCount(changed.added, changed.removed)} />
      </span>
      {changed.files.map((file) => (
        <span key={file.path} className="inline-flex min-w-0 max-w-full">
          {fileChip(
            file.path,
            chipDoors,
            <span className="tabular-nums">
              <CountParts parts={changedCount(file.added, file.removed)} />
            </span>,
          ) ?? file.path}
        </span>
      ))}
    </div>
  );
}
