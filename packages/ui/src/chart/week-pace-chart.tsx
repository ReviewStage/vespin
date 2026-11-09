import { Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { paceEnd, WEEK_PACE, type WeekPace, type WeekPaceKind } from "../week-pace.js";
import { type ChartConfig, ChartContainer } from "./chart.js";

/**
 * week-pace-chart.tsx -- a plan's week as a small line: what it used up to its last reading, solid, and its pace carried on from there, dashed, to the reset or to the limit, under the limit's rule.
 *
 * The plot spans the week from its start to its reset and the window from
 * empty to whole, so where the dashed line meets the rule is where the week
 * runs out, and where it ends short of it is what is left at the reset. It
 * is drawn in the ink of what the pace says: the attention ink where it runs
 * out, the complete green where much of the week goes unused, and the
 * working ink where it lands about on the week. The words beside it say the
 * same, so the chart is their picture and is hidden from a reader; nothing
 * in it takes the focus or a hover.
 */

/** The ink the line is drawn in, by what the pace says. */
const PACE_INK = {
  [WEEK_PACE.RUNS_OUT]: "var(--ui-color-attention)",
  [WEEK_PACE.UNUSED]: "var(--ui-color-complete)",
  [WEEK_PACE.ON_TRACK]: "var(--ui-color-working)",
} as const satisfies Record<WeekPaceKind, string>;

const CONFIGS = {
  [WEEK_PACE.RUNS_OUT]: { pace: { color: PACE_INK[WEEK_PACE.RUNS_OUT] } },
  [WEEK_PACE.UNUSED]: { pace: { color: PACE_INK[WEEK_PACE.UNUSED] } },
  [WEEK_PACE.ON_TRACK]: { pace: { color: PACE_INK[WEEK_PACE.ON_TRACK] } },
} as const satisfies Record<WeekPaceKind, ChartConfig>;

/** The whole window, in percent, where the limit's rule stands. */
const WHOLE_PERCENT = 100;

/** The line's stroke, in pixels, and the dashes of its pace. */
const STROKE_WIDTH = 1.5;
const PACE_DASH = "3 3";

/** Room inside the plot's edges, so the rule and the line's ends are not clipped. */
const MARGIN = { top: 2, right: 2, bottom: 2, left: 2 } as const;

/** One point of the week: when, and the share used up to it, solid, or along the pace, dashed. */
interface PacePoint {
  readonly at: number;
  readonly used?: number;
  readonly pace?: number;
}

/** The week's three points: empty at its start, the reading, which both lines share, and where the pace ends. */
function pacePoints(pace: WeekPace): PacePoint[] {
  const end = paceEnd(pace);
  return [
    { at: pace.startsAt, used: 0 },
    { at: pace.readAt, used: pace.usedPercent, pace: pace.usedPercent },
    { at: end.at, pace: end.percent },
  ];
}

/** The plan's week as `pace` reads it, drawn small beside the words that say it. */
export function WeekPaceChart({ pace }: { pace: WeekPace }): React.JSX.Element {
  return (
    <ChartContainer
      config={CONFIGS[pace.kind]}
      className="ui-week-pace-chart max-w-progress"
      aria-hidden="true"
      data-pace={pace.kind}
    >
      <LineChart data={pacePoints(pace)} margin={MARGIN} accessibilityLayer={false}>
        <XAxis type="number" dataKey="at" domain={[pace.startsAt, pace.resetsAt]} hide />
        <YAxis type="number" domain={[0, WHOLE_PERCENT]} hide />
        <ReferenceLine y={WHOLE_PERCENT} stroke="var(--ui-color-border)" ifOverflow="visible" />
        <ReferenceLine y={0} stroke="var(--ui-color-border)" ifOverflow="visible" />
        <Line
          dataKey="used"
          stroke="var(--color-pace)"
          strokeWidth={STROKE_WIDTH}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="pace"
          stroke="var(--color-pace)"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={PACE_DASH}
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
