import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/**
 * working-count.tsx -- how many of the things a row holds are at work: the working mark, then "2 working" in the muted ink, nothing at none.
 *
 * It stands where a count of things done stands (`ProgressCount`), in the
 * caption's size and tabular figures, its mark at a control's glyph size
 * as the ring is, so a row of agents and a row of tasks line up. It counts
 * no share done, because work at rest may start again. The mark and the
 * words are a picture of `label`, which a reader hears whole in their
 * place ("2 agents it started are working").
 */

/** `words` led by the working mark, heard as `label`; nothing at a `count` of none. */
export function WorkingCount({
  count,
  words,
  label,
}: {
  readonly count: number;
  /** What the eye reads beside the mark ("2 working"). */
  readonly words: string;
  /** What a reader hears in place of the mark and the words. */
  readonly label: string;
}): React.JSX.Element | null {
  if (count === 0) return null;

  return (
    <span className="ui-working-count inline-flex flex-none items-center gap-icon-gap text-caption-inline text-muted-foreground tabular-nums [--ui-working-mark-size:var(--spacing-control-icon)]">
      <WorkingMark />
      <span aria-hidden="true">{words}</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
