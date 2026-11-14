/**
 * landing-figures.tsx -- the line drawings over the landing's three pillars: a task's plan stacked in sub-tasks, one agent handing work to several, and branches merging into one.
 *
 * Each is a few hairline strokes in the line's own ink, quiet enough to sit
 * beside words without competing with the product's screens below them. They
 * are decoration, so a reader is told nothing of them; the pillar's title
 * says what each stands for.
 */

/** The figures the pillars draw, by the step each stands for. */
export const LANDING_FIGURE = {
  PLAN: "plan",
  DELEGATE: "delegate",
  SHIP: "ship",
} as const;

export type LandingFigure = (typeof LANDING_FIGURE)[keyof typeof LANDING_FIGURE];

/** One card of the plan's stack, its top-left corner at `y`, seen from above at an angle. */
function PlanCard({ y }: { y: number }): React.JSX.Element {
  return <path d={`M120 ${y} L196 ${y + 38} L120 ${y + 76} L44 ${y + 38} Z`} />;
}

/** A task's plan: its sub-tasks stacked as cards, the top one holding its lines. */
function PlanFigure(): React.JSX.Element {
  return (
    <>
      {[84, 66, 48, 30].map((y) => (
        <PlanCard key={y} y={y} />
      ))}
      <path d="M96 64 L136 84" />
      <path d="M88 72 L124 90" />
      <path d="M104 76 L132 90" />
    </>
  );
}

/** One agent at the middle handing work to four around it. */
function DelegateFigure(): React.JSX.Element {
  const around = [
    { x: 60, y: 54 },
    { x: 180, y: 54 },
    { x: 60, y: 146 },
    { x: 180, y: 146 },
  ];

  return (
    <>
      {around.map((at) => (
        <g key={`${at.x}-${at.y}`}>
          <path d={`M120 100 L${at.x} ${at.y}`} strokeDasharray="2 4" />
          <rect x={at.x - 18} y={at.y - 18} width="36" height="36" rx="8" />
        </g>
      ))}
      <rect x="92" y="72" width="56" height="56" rx="12" />
      <rect x="104" y="84" width="32" height="32" rx="7" />
    </>
  );
}

/** Branches leaving the main line and merging back into it, a commit at each turn. */
function ShipFigure(): React.JSX.Element {
  const commits = [
    { x: 36, y: 150 },
    { x: 204, y: 150 },
    { x: 92, y: 106 },
    { x: 128, y: 106 },
    { x: 116, y: 62 },
    { x: 152, y: 62 },
    { x: 188, y: 62 },
  ];

  return (
    <>
      <path d="M24 150 L216 150" />
      <path d="M48 150 L68 130 C72 126 76 106 92 106 L128 106 C148 106 148 150 168 150" />
      <path d="M76 150 L92 134 C96 130 100 62 116 62 L188 62 C200 62 196 150 204 150" />
      {commits.map((at) => (
        <circle key={`${at.x}-${at.y}`} cx={at.x} cy={at.y} r="5" />
      ))}
    </>
  );
}

const FIGURES = {
  [LANDING_FIGURE.PLAN]: PlanFigure,
  [LANDING_FIGURE.DELEGATE]: DelegateFigure,
  [LANDING_FIGURE.SHIP]: ShipFigure,
} as const satisfies Record<LandingFigure, () => React.JSX.Element>;

/** The line drawing for `figure`, in the line's own ink. */
export function LandingFigureArt({ figure }: { figure: LandingFigure }): React.JSX.Element {
  const Figure = FIGURES[figure];

  return (
    <svg className="ui-landing-figure" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
      <Figure />
    </svg>
  );
}
