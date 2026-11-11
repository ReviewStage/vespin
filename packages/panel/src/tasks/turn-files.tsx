/**
 * turn-files.tsx -- the files a turn changed, drawn under its words: how many and the lines added and removed, then each file's chip with its own counts, which opens the file as any file chip does.
 *
 * The row stands in the turn's foot, over its Worked for line
 * (`agent-tab.tsx`'s `TurnFoot`), only while the task's workspace has
 * Rewind restores files on, the experiment a turn's files are offered back
 * under, which the tab reads once and hands every turn (`TurnFilesOn`):
 * off, no turn draws it. What it lists is read from the turn's own
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
import { fileChip } from "./mention-chip.js";
import { useMentionDoors } from "./task-mentions.js";

/** Whether the turns under it draw their files: the tab's reading of the experiment, off where no tab says. */
const TurnFilesOnContext = createContext(false);

/** Says whether the turns under it draw their files. */
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
  const on = useContext(TurnFilesOnContext);
  const changed = useMemo(() => (on ? turnFiles(agentParts(message)) : undefined), [on, message]);
  if (changed === undefined) return null;
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
            doors,
            <span className="tabular-nums">
              <CountParts parts={changedCount(file.added, file.removed)} />
            </span>,
          ) ?? file.path}
        </span>
      ))}
    </div>
  );
}
