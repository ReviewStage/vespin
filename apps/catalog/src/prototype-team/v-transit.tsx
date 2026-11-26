/**
 * v-transit.tsx -- PROTOTYPE, throwaway: the team as a transit map, a line per Manager running from what it shipped through now to its goal, handoffs as transfers between lines, and every stop that waits on you lit orange.
 */

import { AGENT_STATE, HANDOFFS, MANAGERS, PR_STATE, type TeamManager, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, Face, faceInk } from "./shared";

const W = 1400;
const H = 720;
const ORDER = ["gpt-live", "product", "frontend", "performance", "mobile"];
const ROW_Y = (i: number) => 130 + i * 120;
const START = 230;
const NOW = 600;
const END = 1120;
const AGE_X: Record<string, number> = { "25m": 545, "1h": 490, "3h": 440, "5h": 320 };

interface Stop {
  x: number;
  label: string;
  kind: "done" | "working" | "needs" | "review" | "idle";
}

function stopsOf(m: TeamManager): Stop[] {
  const done = [
    ...m.pullRequests.filter((p) => p.state === PR_STATE.MERGED).map((p) => `#${p.number}`),
    ...m.agents.filter((a) => a.state === AGENT_STATE.DONE).map((a) => a.name),
  ].slice(0, 2);
  const ahead = m.agents.filter((a) => a.state !== AGENT_STATE.DONE);
  const order = { "needs-you": 0, working: 1, review: 2, idle: 3 } as const;
  ahead.sort((a, b) => order[a.state as keyof typeof order] - order[b.state as keyof typeof order]);
  return [
    ...done.map((label, i) => ({ x: 270 + i * 130, label, kind: "done" as const })),
    ...ahead.map((a, i) => ({
      x: NOW + 90 + i * 160,
      label: a.name,
      kind:
        a.state === AGENT_STATE.NEEDS_YOU
          ? ("needs" as const)
          : a.state === AGENT_STATE.WORKING
            ? ("working" as const)
            : a.state === AGENT_STATE.REVIEW
              ? ("review" as const)
              : ("idle" as const),
    })),
  ];
}

const KIND_FILL = {
  done: "var(--ui-color-surface)",
  working: AGENT_LOOK.working.ink,
  needs: AGENT_LOOK["needs-you"].ink,
  review: AGENT_LOOK.review.ink,
  idle: "var(--ui-color-surface)",
} as const;

export function TransitMap(): React.JSX.Element {
  const rows = ORDER.map((id) => MANAGERS.find((m) => m.id === id)).filter(
    (m): m is TeamManager => m !== undefined,
  );
  const yOf = (id: string) => ROW_Y(ORDER.indexOf(id));
  return (
    <div className="pt-transit">
      <div className="pt-transit-head">
        <div>
          <div className="pt-display">Lines of work</div>
          <div className="pt-muted">{`One line per Manager · past stops left of now, upcoming right · ${TOTAL_ASKS} stops held for you`}</div>
        </div>
        <div className="pt-transit-legend">
          <span>
            <i className="pt-legend-stop" style={{ background: KIND_FILL.needs }} />
            Held for you
          </span>
          <span>
            <i className="pt-legend-stop" style={{ background: KIND_FILL.working }} />
            Agent working
          </span>
          <span>
            <i className="pt-legend-stop" style={{ background: KIND_FILL.review }} />
            In review
          </span>
          <span>
            <i className="pt-legend-stop" />
            Shipped / queued
          </span>
          <span>
            <i className="pt-legend-transfer" />
            Handoff
          </span>
        </div>
      </div>
      <div className="pt-transit-map" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <line x1={NOW} x2={NOW} y1={70} y2={H - 30} className="pt-transit-now" />
          <text x={NOW} y={60} textAnchor="middle" className="pt-transit-now-label">
            NOW · 10:50 PM
          </text>
          {rows.map((m, i) => (
            <g key={m.id}>
              <line x1={START} x2={END} y1={ROW_Y(i)} y2={ROW_Y(i)} className="pt-transit-casing" />
              <line
                x1={START}
                x2={END}
                y1={ROW_Y(i)}
                y2={ROW_Y(i)}
                stroke={faceInk(m)}
                className="pt-transit-line"
              />
            </g>
          ))}
          {HANDOFFS.map((h) => {
            const x = AGE_X[h.age] ?? 400;
            const y1 = yOf(h.from);
            const y2 = yOf(h.to);
            const path = `M ${x} ${y1} C ${x + 50} ${y1}, ${x - 10} ${y2}, ${x + 40} ${y2}`;
            return (
              <g key={h.what}>
                <path d={path} className="pt-transit-transfer" />
                <circle cx={x} cy={y1} r={10} className="pt-transit-interchange" />
                <circle cx={x + 40} cy={y2} r={10} className="pt-transit-interchange" />
              </g>
            );
          })}
          {rows.map((m, i) =>
            stopsOf(m).map((s, k) => {
              const y = ROW_Y(i);
              const up = k % 2 === 0;
              return (
                <g key={`${m.id}${s.label}`}>
                  <circle
                    cx={s.x}
                    cy={y}
                    r={s.kind === "needs" ? 14 : 9}
                    fill={KIND_FILL[s.kind]}
                    className="pt-transit-stop"
                    data-kind={s.kind}
                  />
                  {s.kind === "needs" ? (
                    <text x={s.x} y={y + 5} textAnchor="middle" className="pt-transit-bang">
                      !
                    </text>
                  ) : null}
                  <text
                    x={s.x}
                    y={up ? y - 22 : y + 32}
                    textAnchor="middle"
                    className="pt-transit-label"
                    data-kind={s.kind}
                  >
                    {s.label}
                  </text>
                </g>
              );
            }),
          )}
          {rows.map((m, i) => (
            <g key={`${m.id}end`}>
              <rect
                x={END - 6}
                y={ROW_Y(i) - 16}
                width={12}
                height={32}
                rx={4}
                className="pt-transit-terminus"
              />
              <text x={END + 18} y={ROW_Y(i) - 2} className="pt-transit-dest-kicker">
                TOWARD
              </text>
              <text x={END + 18} y={ROW_Y(i) + 14} className="pt-transit-dest">
                {m.focus}
              </text>
            </g>
          ))}
        </svg>
        {rows.map((m, i) => (
          <div key={m.id} className="pt-transit-origin" style={{ top: ROW_Y(i) - 22 }}>
            <Face m={m} big="l" />
            <div>
              <div className="pt-transit-origin-name">{m.name} line</div>
              <div className="pt-muted pt-small">
                {m.working
                  ? `${m.agents.filter((a) => a.state === "working").length} running`
                  : "Held at the platform"}
              </div>
            </div>
          </div>
        ))}
        {HANDOFFS.map((h) => {
          const x = (AGE_X[h.age] ?? 400) + 20;
          const far = Math.abs(yOf(h.to) - yOf(h.from)) > 130;
          const y = yOf(h.from) + (yOf(h.to) - yOf(h.from)) * (far ? 0.75 : 0.5);
          return (
            <div key={h.what} className="pt-transit-transfer-tag" style={{ left: x, top: y }}>
              {h.what}
            </div>
          );
        })}
      </div>
    </div>
  );
}
