import type { CodeLines } from "@repo/features/tasks-view";
import type { ReactNode } from "react";
import { lineRuns } from "./code-card.js";

/**
 * code-preview.tsx -- a few lines of code standing for the whole, as a run action's row shows its command: its first lines, each in the host's colors and fading out where the edge cuts it, the last fading out downward where more lines follow.
 *
 * A row that holds a script but has no room for it shows its opening this
 * way, so a script of several lines reads as several lines at a glance and
 * a one-liner as one, rather than as a count. Each line keeps to one line
 * of its own, fading out where the row ends rather than wrapping, and the lines
 * keep the code's ground and type at the caption's size: mono, the reading
 * leading, tabs two wide. Where more lines follow than it shows, its last
 * line fades out downward, so what is cut reads as cut. It colors nothing
 * itself: it is handed the host's colors (`CodeLines`) as a code card is,
 * and draws a line plain until they land, or where they no longer spell it.
 * Its lines are left out of the screen recording (`ph-no-capture`), as a
 * code card's are, since their colors draw the code's shape.
 */

/** How many lines a preview shows before it fades the rest away. */
export const CODE_PREVIEW_LINES = 3;

/** The lines: mono at the caption's size, each cut at the edge, each run in its color. */
const PREVIEW =
  "ui-code-preview ph-no-capture m-0 block min-w-0 font-mono text-caption leading-reading text-code [tab-size:2] [&_span]:text-code-run data-[more=true]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1lh),transparent)]";

/** One line, kept to a line of its own and fading out where the preview's edge cuts it, as a row's cut name does. */
const PREVIEW_LINE =
  "ui-code-preview-line block overflow-hidden whitespace-pre [mask-image:linear-gradient(to_left,transparent,#000_var(--ui-label-fade))]";

/** One line as drawn: in its colors where they spell it, plain where they do not. */
function drawnLine(text: string, tokens: CodeLines[number] | undefined): ReactNode {
  const spelled = tokens?.map((token) => token.text).join("") === text;

  return spelled && tokens !== undefined ? lineRuns(tokens) : text;
}

/** The first `shown` lines of `code`, in the host's colors where `lines` holds them, the last fading out where more follow. */
export function CodePreview({
  code,
  lines,
  shown = CODE_PREVIEW_LINES,
}: {
  code: string;
  /** The host's colors for `code`, line by line; none while they have not landed. */
  lines?: CodeLines | undefined;
  /** How many lines it shows at most. */
  shown?: number | undefined;
}): React.JSX.Element {
  const all = code.split("\n");
  const drawn = all.slice(0, Math.max(1, shown));

  return (
    // Note that it is a `<code>` of block lines rather than a `<pre>`, because it stands in a row's description, a paragraph, which may hold phrasing content alone.
    <code className={PREVIEW} data-more={all.length > drawn.length || undefined}>
      {drawn.map((text, at) => (
        // Note that a line's place is its identity here, since the preview is drawn again whenever the code changes.
        <span key={at} className={PREVIEW_LINE}>
          {text === "" ? "​" : drawnLine(text, lines?.[at])}
        </span>
      ))}
    </code>
  );
}
