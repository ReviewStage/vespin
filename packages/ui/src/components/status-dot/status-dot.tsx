import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * status-dot.tsx -- a menu row's glyph wearing a dot in a status tone at its lower end corner, as a chat app marks a face online: a device in Runs on's menu; and words led by such a dot.
 *
 * The dot stands on the glyph rather than at the row's end, so a menu with
 * one row checked keeps its end column for the check alone, and no dot
 * floats a column short of the edge beside an empty check room. The glyph
 * has a hole cut under the dot (`status-dot.css`), so the dot reads apart
 * from its strokes on any ground the row stands on. The glyph and its dot say their words to a
 * reader and on hover, since a color alone says nothing to a reader or an
 * eye that cannot tell the inks apart; a glyph whose press shows its
 * standing in full, as the Cloud chip's popover does, says them to a reader
 * alone (`hinted` false).
 */

/** `children`, a row's glyph, with a dot in `tone` at its corner, called `label`. */
export function StatusGlyph({
  tone = STATUS_TONE.NEUTRAL,
  label,
  hinted = true,
  children,
}: {
  tone?: StatusTone | undefined;
  /** What the dot says: the standing it stands for. */
  label: string;
  /** Whether a rest on the glyph shows `label`; false where the control it stands in says it in full. */
  hinted?: boolean | undefined;
  /** The glyph the dot stands on. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={hinted ? label : undefined}>
      <span
        className="ui-status-glyph relative inline-flex"
        data-tone={tone}
        role="img"
        aria-label={label}
      >
        {children}
        <span className="ui-status-glyph-dot" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

/**
 * Words said in a status tone's dot, the dot first: a sandbox's "Running"
 * beside its green dot, where the words stand as a value of their own
 * rather than on a glyph. The words say what the dot does, so a reader
 * hears them alone.
 */
export function StatusWords({
  tone = STATUS_TONE.NEUTRAL,
  children,
}: {
  tone?: StatusTone | undefined;
  children: string;
}): React.JSX.Element {
  return (
    <span className="ui-status-words inline-flex items-center gap-icon-gap" data-tone={tone}>
      <span className="ui-status-words-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
