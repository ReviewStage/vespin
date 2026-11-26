/**
 * session-line.tsx -- the quiet lines a coding agent's transcript keeps where its harness's session changed: compacted, let go for a fresh one, moved, or carried on after a turn was cut off.
 *
 * Each is a step (`NoteLine`'s `STEP`): a trail, as a transcript's
 * "Forked to" and "Continued in" are, since it says what followed in the
 * session rather than asking anything, standing among the transcript's
 * rows at a row's height so it keeps their rhythm: where the harness folded the conversation
 * into a summary to free up its context, with the tokens it held before
 * where the harness counted them; where the agent's harness was
 * started on a fresh session (`/clear`), the messages above it no longer
 * the session's; and where the agent moved between the cloud and a Mac.
 *
 * A carry-on is the one step that folds: where a turn was cut off before it
 * ended and the agent carried on by itself, it says what cut the turn off
 * on the same line, at a call's row's height and in its columns, and the
 * words the agent was sent to carry on stand folded under it, as a
 * thought's do, since they are the app's word to the model rather than
 * anything the reader asked for. Closed, it reads as the steps around it;
 * open, the words stand where the line's do, past its glyph, keeping their
 * breaks.
 */
import type { CompactedNotice } from "@repo/wire/ui-messages";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { GLYPH } from "../../icons/icons.js";
import {
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  useDisclosureState,
} from "../disclosure/disclosure.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { LineSummary } from "../line-button/line-button.js";
import { NOTE_LINE_LOOK, NoteLine } from "../note-line/note-line.js";
import { Tooltip } from "../tooltip/hint.js";

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

/** What a carry-on's line hints a press does. */
const CARRY_ON_HINT = {
  SHOW: "Show what the agent was sent",
  HIDE: "Hide what the agent was sent",
} as const;

/** The marks a caller finds its line by, as `data-` attributes. */
type DataMarks = { [mark: `data-${string}`]: string | undefined };

/** A carry-on's line, which opens and closes the words under it, hanging the hint that says so. */
function CarryOnSummary({ line }: { line: string }): React.JSX.Element {
  const { open } = useDisclosureState();

  return (
    <Tooltip label={open ? CARRY_ON_HINT.HIDE : CARRY_ON_HINT.SHOW}>
      <LineSummary brightens>
        <GlyphSlot size={ICON_SIZE.MEDIUM} ink={GLYPH_INK.INHERIT}>
          <GLYPH.CARRY_ON />
        </GlyphSlot>
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{line}</span>
      </LineSummary>
    </Tooltip>
  );
}

/** The line where a turn was cut off and carried on by itself: `line` says what cut it off, and the words the agent was sent (`sent`) fold under it. */
export function CarryOnLine({
  line,
  sent,
  ...marks
}: DataMarks & {
  /** What cut the turn off and that it went on, in the transcript's words. */
  line: string;
  /** The words the agent was sent to carry on, folded under the line. */
  sent: string;
}): React.JSX.Element {
  return (
    <Disclosure {...marks} data-carry-on="">
      <CarryOnSummary line={line} />
      <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
        <p className="ui-carry-on-words">{sent}</p>
      </DisclosureBody>
    </Disclosure>
  );
}
