/**
 * v-solar.tsx -- PROTOTYPE, throwaway: you at the center of the team's solar system, each Manager a planet orbiting as close as it needs you, its agents its moons.
 */

import { AVATAR_SIZE, Avatar } from "@repo/ui";
import { HANDOFFS, MANAGERS, ME, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, Face, faceInk } from "./shared";

const W = 1400;
const H = 880;
const CX = 700;
const CY = 470;
const RINGS = [
  { rx: 230, ry: 140, label: "Blocked on you" },
  { rx: 410, ry: 250, label: "Has a question" },
  { rx: 600, ry: 370, label: "Running on its own" },
];
/** Each Manager's ring, by how much it waits on you, and where on it, in degrees. */
const PLACE: Record<string, { ring: number; angle: number }> = {
  "gpt-live": { ring: 0, angle: 200 },
  product: { ring: 1, angle: 300 },
  performance: { ring: 1, angle: 30 },
  frontend: { ring: 2, angle: 250 },
  mobile: { ring: 2, angle: 120 },
};

function at(id: string): [number, number] {
  const place = PLACE[id] ?? { ring: 2, angle: 0 };
  const ring = RINGS[place.ring] ?? RINGS[2]!;
  const t = (place.angle * Math.PI) / 180;
  return [CX + ring.rx * Math.cos(t), CY + ring.ry * Math.sin(t)];
}

export function SolarSystem(): React.JSX.Element {
  return (
    <div className="pt-solar">
      <div className="pt-solar-head">
        <div className="pt-display">Your orbit</div>
        <div className="pt-muted">
          The closer a Manager orbits, the more it waits on you · moons are its agents, colored by
          state
        </div>
      </div>
      <div className="pt-solar-space" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {RINGS.map((r, i) => (
            <g key={r.label}>
              <ellipse
                cx={CX}
                cy={CY}
                rx={r.rx}
                ry={r.ry}
                className="pt-solar-ring"
                data-ring={i}
              />
              <text
                x={CX}
                y={CY - r.ry - 8}
                textAnchor="middle"
                className="pt-solar-ring-label"
                data-ring={i}
              >
                {r.label.toUpperCase()}
              </text>
            </g>
          ))}
          {HANDOFFS.map((h) => {
            const [ax, ay] = at(h.from);
            const [bx, by] = at(h.to);
            const px = (ax + bx) / 2 - CX;
            const py = (ay + by) / 2 - CY;
            const mx = CX + px * 1.9;
            const my = CY + py * 1.9;
            return (
              <path
                key={h.what}
                d={`M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`}
                className="pt-solar-handoff"
              />
            );
          })}
          {MANAGERS.map((m) => {
            const [x, y] = at(m.id);
            const r = 30 + m.agents.length * 5;
            return (
              <g key={m.id}>
                {m.asks.length > 0 ? (
                  <line x1={CX} y1={CY} x2={x} y2={y} className="pt-solar-tether" />
                ) : null}
                <circle cx={x} cy={y} r={r + 22} className="pt-solar-moon-orbit" />
                <circle cx={x} cy={y} r={r} fill={faceInk(m)} className="pt-solar-planet" />
                {m.agents.map((a, i) => {
                  const t = -Math.PI / 2 + (i * 2 * Math.PI) / m.agents.length;
                  return (
                    <circle
                      key={a.name}
                      cx={x + (r + 22) * Math.cos(t)}
                      cy={y + (r + 22) * Math.sin(t)}
                      r={8}
                      fill={AGENT_LOOK[a.state].ink}
                      className="pt-solar-moon"
                    />
                  );
                })}
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={58} className="pt-solar-sun" />
        </svg>
        <div className="pt-solar-you" style={{ left: CX - 36, top: CY - 36 }}>
          <Avatar name={ME.name} size={AVATAR_SIZE.PORTRAIT} decorative />
        </div>
        <div className="pt-solar-you-label" style={{ left: CX - 80, top: CY + 64 }}>
          <strong>You</strong> · {TOTAL_ASKS} asks pulling at you
        </div>
        {MANAGERS.map((m) => {
          const [x, y] = at(m.id);
          const r = 30 + m.agents.length * 5;
          const right = x >= CX;
          return (
            <div key={m.id}>
              <div className="pt-solar-face" style={{ left: x - 32, top: y - 32 }}>
                <Face m={m} big="xl" />
              </div>
              <div
                className="pt-solar-label"
                data-side={right ? "right" : "left"}
                data-needs={m.asks.length > 0 ? "true" : undefined}
                style={
                  right
                    ? { left: x + r + 40, top: y - 30 }
                    : { right: W - (x - r - 40), top: y - 30 }
                }
              >
                <div className="pt-solar-name">{m.name}</div>
                <div className="pt-small">{m.focus}</div>
                {m.asks.map((a) => (
                  <div key={a.title} className="pt-solar-ask">
                    ● {a.title}
                  </div>
                ))}
                <div className="pt-small pt-muted">
                  {m.agents.map((a) => AGENT_LOOK[a.state].words.toLowerCase()).join(" · ")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
