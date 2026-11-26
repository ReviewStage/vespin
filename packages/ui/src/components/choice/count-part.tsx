import { CHECK_SUMMARY, type CheckSummary } from "@repo/features/agent-wire";
import { formatCount } from "@repo/features/number-format";
import { CHECK_SUMMARY_WORDS } from "@repo/features/pull-request-model";
import { Fragment, type ReactNode } from "react";
import { CheckIcon, XIcon } from "../../icons/icons.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { SPINNER_SIZE, SpinnerRing } from "../spinner/spinner.js";

/**
 * count-part.tsx -- what an option of a row where you choose one counts, as parts each in its own tone, which every such row draws alike.
 *
 * A count is one part or several: a pull request's checks are one, "9/9" in
 * the complete tone with a glyph before it, and its lines are two, the lines
 * it adds and the lines it removes. A part is quiet unless it says a state,
 * and a glyph that says one carries the words a reader who cannot see it
 * hears, so a state is never color and shape alone. A diff's line counts
 * always carry color, its additions in the complete tone and its deletions
 * in the danger tone, chosen or not and in every look, so they are built
 * one way (`linesCount`) and no caller can draw them gray. A part that
 * `folds` is words a bar leaves unseen once it folds its options to their
 * glyphs, on every option glyphed, the chosen one too, so the counts read
 * alike: "viewed" after "1/4", still read aloud. A pull request's checks
 * are counted one way too (`checksCount`), as its Checks tab and the Merge
 * queue page both count them.
 */

/** A part's glyph and the words that say it, required beside one. */
type CountGlyph =
  | { glyph?: undefined; glyphLabel?: undefined }
  | { glyph: ReactNode; glyphLabel: string };

/** One part of a count: what it says, its tone, and a glyph before it. */
export type CountPart = {
  readonly text: string;
  readonly tone?: StatusTone | undefined;
  /** Whether a bar folding its options to their glyphs leaves it unseen, still read aloud. */
  readonly folds?: boolean | undefined;
} & Readonly<CountGlyph>;

/**
 * A part laid out as a row of its glyph and words, in its tone, which holds
 * whether its option is chosen or not; quiet, it takes its count's ink. Its
 * glyph stands at the caption's size.
 */
const PART =
  "ui-count-part inline-flex items-center gap-icon-gap-compact [&:not([data-tone=neutral])]:text-tone-ink";

const GLYPH = "ui-count-glyph inline-flex [&>svg]:size-caption-glyph";

/** One part, its glyph named for a reader who cannot see it. */
function CountPartView({ part }: { part: CountPart }): React.JSX.Element {
  return (
    <span
      className={PART}
      data-tone={part.tone ?? STATUS_TONE.NEUTRAL}
      data-folds={part.folds === true ? "" : undefined}
    >
      {part.glyph === undefined ? null : (
        <span className={GLYPH} role="img" aria-label={part.glyphLabel}>
          {part.glyph}
        </span>
      )}
      {part.text}
    </span>
  );
}

/** A count's `parts`, a space between each. */
export function CountParts({ parts }: { parts: readonly CountPart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((part, at) => (
        <Fragment key={at}>
          {at === 0 ? null : " "}
          <CountPartView part={part} />
        </Fragment>
      ))}
    </>
  );
}

/** The parts of a diff's line count: `+additions` in the complete tone and `−deletions` in the danger tone. */
export function linesCount(additions: number, deletions: number): readonly CountPart[] {
  return [
    { text: `+${formatCount(additions)}`, tone: STATUS_TONE.COMPLETE },
    { text: `−${formatCount(deletions)}`, tone: STATUS_TONE.DANGER },
  ];
}

/** The glyph a pull request's checks count wears for how they went, as its mark tells it; none where there are none. */
const SUMMARY_GLYPHS = {
  [CHECK_SUMMARY.FAILING]: <XIcon />,
  [CHECK_SUMMARY.PENDING]: <SpinnerRing size={SPINNER_SIZE.SMALL} />,
  [CHECK_SUMMARY.PASSING]: <CheckIcon />,
  [CHECK_SUMMARY.NONE]: null,
} as const satisfies Record<CheckSummary, ReactNode>;

/** The tone a pull request's checks count takes for how they went, as its glyph does: a wait quiet, under the ring every wait turns. */
const SUMMARY_TONES = {
  [CHECK_SUMMARY.FAILING]: STATUS_TONE.DANGER,
  [CHECK_SUMMARY.PENDING]: STATUS_TONE.NEUTRAL,
  [CHECK_SUMMARY.PASSING]: STATUS_TONE.COMPLETE,
  [CHECK_SUMMARY.NONE]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<CheckSummary, StatusTone>;

/**
 * A pull request's checks as one part: how they went, in its color and by
 * its glyph from the first frame, and how many once read (`count`: those
 * that failed, those still running, or all of them once they passed);
 * nothing where neither stands.
 */
export function checksCount(
  summary: CheckSummary,
  count: number | undefined,
): readonly CountPart[] | undefined {
  const glyph = SUMMARY_GLYPHS[summary];

  if (glyph === null && count === undefined) return undefined;
  const text = count === undefined ? "" : formatCount(count);
  const tone = SUMMARY_TONES[summary];

  return [
    glyph === null
      ? { text, tone }
      : { text, tone, glyph, glyphLabel: CHECK_SUMMARY_WORDS[summary] },
  ];
}
