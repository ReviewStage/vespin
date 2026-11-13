/**
 * voice-call.tsx -- what a call into an agent adds to its transcript: the rules a call begins and ends at, and the turn a spoken ask opened folded closed.
 *
 * A call's lines are drawn as any other: the caller's as that member's
 * messages, and the voice's as the agent's own replies are, with no mark,
 * label, or tone of their own. A call is marked only where it begins and
 * ends, by a rule across the column (`CallMark`) carrying a caption in its
 * middle, led by the call's glyph or the hang-up's: the words its caller
 * hands it, such as who started the call and when, or how long it ran,
 * which wrap under each other where the column is too narrow for them on
 * one line. A finished turn a spoken ask opened stands folded closed under
 * its summary (`RetoldTurn`), one press opening it, since the voice retells
 * it on the call.
 *
 * It is drawn in the Tailwind theme's utilities, at the caption's size for
 * the rules.
 */

import type { ReactNode } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { GLYPH } from "../../icons/icons.js";
import {
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
} from "../disclosure/disclosure.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";

/** Which end of a call a rule stands at. */
export const CALL_MARK_END = {
  START: "start",
  END: "end",
} as const;

export type CallMarkEnd = (typeof CALL_MARK_END)[keyof typeof CALL_MARK_END];

/** A rule's hairline, running from the caption to the column's edge. */
const RULE = "ui-call-mark-rule h-px min-w-ui-24 flex-1 border-0 bg-border";

/**
 * A finished turn a spoken ask opened, folded closed until pressed open,
 * since the voice retells it on the call: its summary over the turn itself.
 */
export function RetoldTurn({
  summary,
  children,
}: {
  /** What the closed fold says of the turn, as a finished turn's own line says it. */
  summary: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Disclosure data-retold-turn="">
      <DisclosureSummary>{summary}</DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.NONE}>{children}</DisclosureBody>
    </Disclosure>
  );
}

/**
 * A rule across the column where a call began or ended, its caption in the
 * middle led by the call's glyph or the hang-up's: `children`, such as
 * "Call started · Today, 3:02 PM" or "Call ended · 4m 12s".
 */
export function CallMark({
  end,
  children,
}: {
  end: CallMarkEnd;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="ui-call-mark flex w-full min-w-0 items-center gap-control-gap py-row-inset text-caption-inline text-muted-foreground"
      data-call-mark={end}
    >
      <hr aria-hidden className={RULE} />
      <span className="ui-call-mark-words flex min-w-0 flex-initial items-center gap-ui-4">
        <GlyphSlot size={ICON_SIZE.SMALL} ink={GLYPH_INK.MUTED}>
          {end === CALL_MARK_END.START ? <GLYPH.CALL /> : <GLYPH.END_CALL />}
        </GlyphSlot>
        <span className="flex min-w-0 flex-wrap items-center gap-x-ui-4">{children}</span>
      </span>
      <hr aria-hidden className={RULE} />
    </div>
  );
}
