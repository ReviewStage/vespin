/**
 * voice-call.tsx -- what a call into an agent leaves in its transcript: the mark on a line the caller said aloud, the voice's own lines, and the rules a call begins and ends at.
 *
 * A call is two speakers talking beside an agent: the caller, whose lines
 * are their own messages, and the voice, which answers them, hands their
 * asks to the agent, and retells its replies. The caller's line keeps a
 * message's bubble, its line led by the voice's waveform in the voice's
 * blue (`SpokenMark`), named "Said aloud" for a reader. The voice's line
 * stands at the column's left on no ground, flush with an agent's words,
 * but named "Voice" over it beside the waveform (`VoiceSpeaker`) and set in
 * the muted ink (`VoiceWords`), so it reads quieter than the agent's
 * replies and never as the agent's words. Either line says when into the
 * call it began (`CallOffset`) among its actions, so only while it is
 * hovered. A finished turn a spoken ask opened stands folded closed
 * (`RetoldTurn`), one press opening it, since the voice retells it. A
 * call's lines stand between two rules across the column
 * (`CallMark`), each carrying a caption in its middle: where the call
 * began, led by the waveform, and where it ended, led by the hang-up glyph,
 * each with the words its caller hands it, such as when the call began and
 * how long it ran, which wrap under each other where the column is too
 * narrow for them on one line.
 *
 * It is drawn in the Tailwind theme's utilities, at the caption's size for
 * the marks and the body's for the voice's words.
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
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/** What the marks say for a reader, and the name the voice speaks under. */
export const VOICE_CALL_WORDS = {
  SAID_ALOUD: "Said aloud",
  VOICE: "Voice",
  INTO_CALL: "into the call",
} as const;

/** Which end of a call a rule stands at. */
export const CALL_MARK_END = {
  START: "start",
  END: "end",
} as const;

export type CallMarkEnd = (typeof CALL_MARK_END)[keyof typeof CALL_MARK_END];

/** A rule's hairline, running from the caption to the column's edge. */
const RULE = "ui-call-mark-rule h-px min-w-ui-24 flex-1 border-0 bg-border";

/** The mark a line said aloud on a call is led by on its line: the voice's waveform, in the voice's blue, named for a reader. */
export function SpokenMark(): React.JSX.Element {
  return (
    <GlyphSlot size={ICON_SIZE.SMALL} ink={GLYPH_INK.VOICE} label={VOICE_CALL_WORDS.SAID_ALOUD}>
      <GLYPH.CALL />
    </GlyphSlot>
  );
}

/** The voice named over its line, flush with its words: the waveform, then "Voice", at the caption's size in the muted ink. */
export function VoiceSpeaker(): React.JSX.Element {
  return (
    <div className="ui-voice-speaker flex min-w-0 items-center gap-ui-4 text-caption-inline text-muted-foreground">
      <GlyphSlot size={ICON_SIZE.SMALL} ink={GLYPH_INK.VOICE}>
        <GLYPH.CALL />
      </GlyphSlot>
      {VOICE_CALL_WORDS.VOICE}
    </div>
  );
}

/** The voice's words on a call, on no ground and flush with an agent's words, in the muted ink, quieter than an agent's reply. */
export function VoiceWords({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-voice-words min-w-0 max-w-full text-body leading-reading text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * A finished turn a spoken ask opened, folded closed until pressed open,
 * since the voice retells it on the call: its summary, such as how long it
 * worked, over the turn itself.
 */
export function RetoldTurn({
  summary,
  children,
}: {
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
 * When into the call a line began, as the call's clock says it ("0:42"),
 * set in its message's actions bar (`MessageActions`) so it shows only
 * while the line is hovered, as its Copy does, never at rest on every line.
 */
export function CallOffset({ clock }: { clock: string }): React.JSX.Element {
  return (
    <span className="ui-call-offset px-ui-4 text-caption-inline text-muted-foreground tabular-nums">
      {clock}
      <VisuallyHidden> {VOICE_CALL_WORDS.INTO_CALL}</VisuallyHidden>
    </span>
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
