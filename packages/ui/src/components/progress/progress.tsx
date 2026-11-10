import { Progress as ShadcnProgress } from "../../shadcn/progress.js";

/**
 * progress.tsx -- how far a known amount of work has come, as a thin bar filling in the working ink: a download, an upload, a count against its whole.
 *
 * The bar is the one meter every wait with a known end is drawn as, so a
 * download in Settings and any other reads as one object. Where words beside
 * it already say the same in numbers ("12 of 40 MB"), the bar is their
 * picture and says nothing to a reader; given a `label`, it is a progress bar
 * of its own, named by it and read as a percentage. A wait with no known end
 * is a spinner's, never an empty bar. A count that needs a person, such as a
 * plan at its usage limit, fills in the attention ink instead
 * (`PROGRESS_TONE.ATTENTION`). A bar under a line of words in a list of
 * them, such as a settings row's meter, is drawn thinner
 * (`PROGRESS_SIZE.THIN`), so it reads as their underline rather than a row
 * of its own.
 *
 * The bar is shadcn/ui's progress over Base UI (`../../shadcn/progress.tsx`),
 * drawn in Tailwind utilities over the theme. Base UI's root would name
 * every bar a progress bar and read its share aloud as text of its own
 * (`aria-valuetext`, "42%") at its exact value; this hands it the reading
 * the bar has always given instead, so a reader hears the same: a labeled
 * bar's role, label, bounds, and share rounded to a whole percent, and no
 * role or value at all on one hidden beside its words.
 */

/** The ink a bar fills in: the working ink, or the attention ink where what it counts needs a person. */
export const PROGRESS_TONE = {
  WORKING: "working",
  ATTENTION: "attention",
} as const;

export type ProgressTone = (typeof PROGRESS_TONE)[keyof typeof PROGRESS_TONE];

/** How thick a bar is drawn: the hairline, or thinner still under a row's words. */
export const PROGRESS_SIZE = {
  REGULAR: "regular",
  THIN: "thin",
} as const;

export type ProgressSize = (typeof PROGRESS_SIZE)[keyof typeof PROGRESS_SIZE];

/** The share of the work done, as a percentage held to 0–100, a value that is not a number read as none. */
function percentOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** A bar filled to `value` percent, read by `label` where given, else the picture of words beside it. */
export function Progress({
  value,
  label,
  tone = PROGRESS_TONE.WORKING,
  size = PROGRESS_SIZE.REGULAR,
}: {
  /** How far the work has come, in percent. */
  value: number;
  /** What the bar measures, where no words beside it say it ("Downloading the update"). */
  label?: string | undefined;
  /** The ink it fills in; the working ink where none is named. */
  tone?: ProgressTone | undefined;
  /** How thick it is drawn; the hairline where none is named. */
  size?: ProgressSize | undefined;
}): React.JSX.Element {
  const percent = percentOf(value);
  // Note that each attribute Base UI's root sets is named here, undefined where the bar never said it, because a prop given overrides the root's own.
  const read =
    label === undefined
      ? ({
          "aria-hidden": true,
          role: undefined,
          "aria-valuemin": undefined,
          "aria-valuemax": undefined,
          "aria-valuenow": undefined,
          "aria-valuetext": undefined,
        } as const)
      : ({
          role: "progressbar",
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(percent),
          "aria-valuetext": undefined,
        } as const);
  return <ShadcnProgress value={percent} data-tone={tone} data-size={size} {...read} />;
}
