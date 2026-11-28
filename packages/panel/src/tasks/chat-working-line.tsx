/**
 * chat-working-line.tsx -- the line a Manager's chat ends on while a turn runs: its face typing beside "Release manager is working…", and Show work where the turn did work.
 *
 * A chat holds only what was said, so a turn under way draws no row of the
 * Manager's: its chat ends on one quiet line in its messages' column
 * instead, with no name or picture of a message's, as an agent's transcript
 * ends on its working line (`managerWorkingLine`). The Manager's face leads
 * it, typing while it works and at rest while it waits on the reader's
 * answer. Show work opens the turn's work so far above the line, still
 * moving, and folds it again; it stands open only for the turn it was opened
 * in, so the next turn's work opens folded. The line stands in the chat's
 * log, which a reader hears it land in, as a message is heard.
 */

import { ENTITY_KIND } from "@repo/features/entity-kind";
import type { ManagerWorkingLine } from "@repo/features/manager-chat-view";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { GAP, GlyphSlot, Inline } from "@repo/ui";
import { ICON_SIZE } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { type ReactNode, useState } from "react";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { type ChatWorkToggle, WorkingWorkAction } from "./chat-work.js";
import { WorkingLine } from "./working-time.js";

/** Whether the turn under way's work stands open above the working line, for `turnId`'s turn alone, closed until Show work opens it. */
export function useLiveWorkToggle(turnId: string | undefined): ChatWorkToggle {
  const [openFor, setOpenFor] = useState<string | undefined>(undefined);
  const shown = turnId !== undefined && openFor === turnId;

  return {
    shown,
    onToggle: () => setOpenFor(shown ? undefined : turnId),
    onShow: () => setOpenFor(turnId),
  };
}

/** The Manager's face leading the line, typing while it works, or the agent's glyph where a service older than faces names none. */
function LineFace({
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

/** The line a chat ends on while a turn runs, Show work after it where the turn did work. */
export function ChatWorkingLine({
  line,
  face,
  toggle,
}: {
  line: ManagerWorkingLine;
  face: ManagerFaceValue | undefined;
  toggle: ChatWorkToggle;
}): ReactNode {
  return (
    <div data-manager-working="">
      <Inline gap={GAP.ICON} wrap={false}>
        <LineFace face={face} working={!line.waiting} />
        <WorkingLine startedAt={undefined} words={line.words} />
        {line.work ? <WorkingWorkAction toggle={toggle} /> : null}
      </Inline>
    </div>
  );
}
