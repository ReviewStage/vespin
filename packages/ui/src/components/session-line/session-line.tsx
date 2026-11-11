/**
 * session-line.tsx -- the quiet lines a coding agent's transcript keeps where its harness's session changed: compacted, or let go for a fresh one.
 *
 * Each is a trail (`NoteLine`'s `TRAIL`), as a transcript's "Forked to"
 * and "Continued in" are, since it says what followed in the session
 * rather than asking anything: where the harness folded the conversation
 * into a summary to free up its context, with the tokens it held before
 * where the harness counted them; and where the agent's harness was
 * started on a fresh session (`/clear`), the messages above it no longer
 * the session's.
 */
import type { CompactedNotice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";

/** A token count as the line says it: "148K". */
const TOKENS = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

/** The line where the harness compacted its session. */
export function CompactedLine({ notice }: { notice: CompactedNotice }): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<GLYPH.COMPACT />} data-compacted="">
      {notice.tokensBefore === null
        ? "Compacted the conversation"
        : `Compacted the conversation from ${TOKENS.format(notice.tokensBefore)} tokens`}
    </NoteLine>
  );
}

/** The line where the agent's harness was started on a fresh session. */
export function NewSessionLine(): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<GLYPH.NEW_SESSION />} data-session-cleared="">
      New session. The agent no longer has the messages above.
    </NoteLine>
  );
}
