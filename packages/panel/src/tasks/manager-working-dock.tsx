/**
 * manager-working-dock.tsx -- the line a Manager's chat stands just over its box while a turn runs: its face typing beside "Release manager is working…", and Show work where the turn did work.
 *
 * A chat holds only what was said, so a turn under way draws no row of the
 * Manager's in it: the line stands over the box instead, as a channel says
 * who is typing by its box (`managerWorkingLine`). The Manager's face types
 * while it works and rests while it waits on the reader's answer. Show work
 * opens the turn's work so far at the chat's end, still moving, and folds
 * it again; it stands open only for the turn it was opened in, so the next
 * turn's work opens folded. Note that the line is said aloud as it comes,
 * since it stands outside the chat's live log, where the row it replaced was
 * heard landing, and its own words are said only as they change.
 */

import { ENTITY_KIND } from "@repo/features/entity-kind";
import type { ManagerWorkingLine } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { ANNOUNCE, announce, GAP, GlyphSlot, Inline } from "@repo/ui";
import { ICON_SIZE } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { type ChatWorkToggle, WorkingWorkAction } from "./chat-work.js";
import { WorkingLine } from "./working-time.js";

/** Whether the turn under way's work stands open at the chat's end, for `turnId`'s turn alone, closed until Show work opens it. */
export function useLiveWorkToggle(turnId: string | undefined): ChatWorkToggle {
  const [openFor, setOpenFor] = useState<string | undefined>(undefined);
  const shown = turnId !== undefined && openFor === turnId;

  return {
    shown,
    onToggle: () => setOpenFor(shown ? undefined : turnId),
    onShow: () => setOpenFor(turnId),
  };
}

/** Says the line's words as it comes, not as the page opens on it, and takes them back once they change or it goes, where its own words take over. */
function useArrivalSaid(words: string | undefined): void {
  const shown = words !== undefined;
  const was = useRef(shown);

  useEffect(() => {
    const arrived = shown && !was.current;
    was.current = shown;

    if (!arrived || words === undefined) return;

    return announce(ANNOUNCE.POLITE, words);
  }, [shown, words]);
}

/** The Manager's face beside the line, typing while it works, or the agent's glyph where a service older than faces names none. */
function DockFace({
  face,
  working,
}: {
  face: ManagerFaceValue | undefined;
  working: boolean;
}): ReactNode {
  return face === undefined ? (
    <GlyphSlot size={ICON_SIZE.MEDIUM}>
      <EntityGlyph kind={ENTITY_KIND.AGENT} />
    </GlyphSlot>
  ) : (
    <ManagerFace face={face} size={MANAGER_FACE_SIZE.ROW} working={working} />
  );
}

/** The line over the box while a turn runs, Show work beside it where the turn did work; nothing while none runs. */
export function ManagerWorkingDock({
  line,
  face,
  toggle,
}: {
  line: ManagerWorkingLine | undefined;
  face: ManagerFaceValue | undefined;
  toggle: ChatWorkToggle;
}): ReactNode {
  useArrivalSaid(line?.words);

  if (line === undefined) return null;

  return (
    <div className={`agent-working-dock ${COMPOSER_DOCK_CLASS}`} data-manager-working="">
      <Inline gap={GAP.ICON} wrap={false}>
        <DockFace face={face} working={!line.waiting} />
        <WorkingLine startedAt={undefined} words={line.words} />
        {line.work ? <WorkingWorkAction toggle={toggle} /> : null}
      </Inline>
    </div>
  );
}
