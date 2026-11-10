import { cn } from "../../cn.js";
import {
  PROGRESS_SIZE,
  PROGRESS_TONE,
  PROGRESS_WIDTH,
  Progress,
  type ProgressTone,
} from "../progress/progress.js";

/**
 * usage-meters.tsx -- how much of each usage window a plan has used, one row a window: its name, a bar, the share used, and when it resets.
 *
 * A plan is counted in more than one window at once, a 5-hour session and
 * a week, as Claude Code's `/usage` and Codex's `/status` list them, so each
 * is a row of its own: "5-hour", a bar filled to the share used, "22%", and
 * when the window resets in the muted ink ("in 2h", "in 4d"). The rows line
 * their bars up in one column whatever their names' widths, as Capy's model
 * picker does, each bar thin as a row's meter is, a meter's length beside a row's words, or running
 * the whole width it is given where the meters stand alone at a menu's foot
 * (`USAGE_METERS_WIDTH.FILL`). A window at its limit fills in the attention ink. The words
 * say what the bar does, so the bar is their picture and says nothing to a
 * reader. A reading that is not fresh says when it was heard under the rows
 * (`heard`), since a plan's usage is only known from the turns that ran on
 * it.
 */

/** One window's row: its name, the share used, when it resets, and the ink its bar fills in. */
export interface UsageMeterRow {
  /** The window's name: "5-hour", "Weekly". */
  readonly label: string;
  /** The share of the window used, in percent. */
  readonly usedPercent: number;
  /** When the window resets, as the row says it: "in 2h", "in 4d"; none where the provider did not say. */
  readonly resets?: string | undefined;
  /** The ink its bar fills in: the attention ink at its limit. */
  readonly tone?: ProgressTone | undefined;
}

/** How wide the meters run: their bars a meter's length, or the whole width they are given. */
export const USAGE_METERS_WIDTH = {
  METER: "meter",
  FILL: "fill",
} as const;

export type UsageMetersWidth = (typeof USAGE_METERS_WIDTH)[keyof typeof USAGE_METERS_WIDTH];

/** Each width's grid, and how long its bars run in it. */
const WIDTHS = {
  [USAGE_METERS_WIDTH.METER]: {
    grid: "w-fit max-w-full grid-cols-usage-meters",
    bar: PROGRESS_WIDTH.METER,
  },
  [USAGE_METERS_WIDTH.FILL]: {
    grid: "w-full grid-cols-usage-meters-fill",
    bar: PROGRESS_WIDTH.FILL,
  },
} as const satisfies Record<UsageMetersWidth, { grid: string; bar: string }>;

/** The share used as its row says it: a whole percent. */
function percentWords(usedPercent: number): string {
  return `${String(Math.round(usedPercent))}%`;
}

export function UsageMeters({
  rows,
  heard,
  width = USAGE_METERS_WIDTH.METER,
}: {
  rows: readonly UsageMeterRow[];
  /** When the reading was heard, where it is not fresh: "Updated 1h ago". */
  heard?: string | undefined;
  /** How wide the meters run; their bars a meter's length where none is named. */
  width?: UsageMetersWidth | undefined;
}): React.JSX.Element {
  const { grid, bar } = WIDTHS[width];
  return (
    <div className="ui-usage-meters flex flex-col gap-ui-4 text-caption">
      <div className={cn("grid items-center gap-x-ui-8 gap-y-ui-4", grid)}>
        {rows.map((row) => (
          <div key={row.label} className="contents" data-window={row.label}>
            <span className="text-muted-foreground">{row.label}</span>
            <Progress
              value={row.usedPercent}
              tone={row.tone ?? PROGRESS_TONE.WORKING}
              width={bar}
              size={PROGRESS_SIZE.THIN}
            />
            <span className="text-right tabular-nums">{percentWords(row.usedPercent)}</span>
            <span className="text-muted-foreground tabular-nums">{row.resets ?? ""}</span>
          </div>
        ))}
      </div>
      {heard === undefined ? null : <span className="text-muted-foreground">{heard}</span>}
    </div>
  );
}
