/**
 * session-line.tsx -- the quiet lines a coding agent's transcript keeps where its harness's session changed: compacted, or let go for a fresh one.
 *
 * Each is a step (`NoteLine`'s `STEP`): a trail, as a transcript's
 * "Forked to" and "Continued in" are, since it says what followed in the
 * session rather than asking anything, standing among the transcript's
 * rows at a row's height so it keeps their rhythm: where the harness folded the conversation
 * into a summary to free up its context, with the tokens it held before
 * where the harness counted them; where the agent's harness was
 * started on a fresh session (`/clear`), the messages above it no longer
 * the session's; and where the agent moved between the cloud and a Mac.
 */
import type { CompactedNotice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";

/** A token count as the line says it: "148K". */
const TOKENS = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

/** The line where the harness compacted its session. */
export function CompactedLine({ notice }: { notice: CompactedNotice }): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.STEP} glyph={<GLYPH.COMPACT />} data-compacted="">
      {notice.tokensBefore === null
        ? "Compacted the conversation"
        : `Compacted the conversation from ${TOKENS.format(notice.tokensBefore)} tokens`}
    </NoteLine>
  );
}

/** The line where the agent moved between the cloud and one of its starter's Macs, naming where it runs now, as its caller calls that place; the cloud where it names none. */
export function MovedLine({ to }: { to: string | undefined }): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.STEP} glyph={<GLYPH.MOVE />} data-agent-moved="">
      {`Moved to ${to ?? "the cloud"}`}
    </NoteLine>
  );
}

/** The line where the agent's harness was started on a fresh session. */
export function NewSessionLine(): React.JSX.Element {
  return (
    <NoteLine look={NOTE_LINE_LOOK.STEP} glyph={<GLYPH.NEW_SESSION />} data-session-cleared="">
      New session. The agent no longer has the messages above.
    </NoteLine>
  );
}
