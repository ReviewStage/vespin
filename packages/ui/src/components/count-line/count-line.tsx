import type { StatusTone } from "../../status-tone.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * count-line.tsx -- a page's counts on one line, each a figure and what it counts, as a dashboard opens on how much stands in each of its parts.
 *
 * Each count is its figure, set in the section role so it reads at a glance,
 * then its words, muted, on the figure's baseline; the counts stand a
 * section's gap apart and wrap where the line runs out of room. A count
 * that asks for a person (what waits on the reader) is handed the attention
 * tone, which inks its figure while it counts something. The line is a
 * list named by its `label`, each count an item a reader hears whole: "3
 * waiting on you".
 */

/** One count on the line: its figure, what it counts, and the tone its figure is inked in while it counts something. */
export interface LineCount {
  readonly value: number;
  readonly words: string;
  readonly tone?: StatusTone | undefined;
}

/** Counts on one line, each its figure and its words. */
export function CountLine({
  label,
  counts,
}: {
  /** What the counts are of, said to a reader as the list's name. */
  label: string;
  counts: readonly LineCount[];
}): React.JSX.Element {
  return (
    <ul
      aria-label={label}
      className="ui-count-line m-0 flex list-none flex-wrap items-baseline gap-x-section-gap gap-y-tight-gap p-0"
    >
      {counts.map((count) => (
        <li key={count.words} className="flex items-baseline gap-icon-gap">
          <Text variant={TEXT_VARIANT.SECTION}>
            <span
              className="tabular-nums data-tone:text-tone-ink"
              data-tone={count.value > 0 ? count.tone : undefined}
            >
              {count.value}
            </span>
          </Text>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {count.words}
          </Text>
        </li>
      ))}
    </ul>
  );
}
