/**
 * v-studio.tsx -- PROTOTYPE, throwaway: the team as an isometric studio floor, a desk per Manager with a monitor per agent lit in its state, and your own desk up front holding the trays that wait on you.
 */

import { AVATAR_SIZE, Avatar } from "@repo/ui";
import { HANDOFFS, MANAGERS, ME, managerById, type TeamManager, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, Face, faceInk, ManagerBadge } from "./shared";

const W = 1400;
const H = 900;
const S = 40; // one floor unit in pixels
const OX = 600;
const OY = 250;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

function iso(x: number, y: number, z = 0): [number, number] {
  return [OX + (x - y) * COS * S, OY + (x + y) * SIN * S - z * S];
}

function pts(list: [number, number][]): string {
  return list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
}

/** A box on the floor: its top, its left face, and its right face. */
function Box({
  x,
  y,
  z = 0,
  w,
  d,
  h,
  fill,
  cls,
}: {
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  fill: string;
  cls?: string;
}): React.JSX.Element {
  const top = pts([
    iso(x, y, z + h),
    iso(x + w, y, z + h),
    iso(x + w, y + d, z + h),
    iso(x, y + d, z + h),
  ]);
  const left = pts([
    iso(x, y + d, z + h),
    iso(x + w, y + d, z + h),
    iso(x + w, y + d, z),
    iso(x, y + d, z),
  ]);
  const right = pts([
    iso(x + w, y, z + h),
    iso(x + w, y + d, z + h),
    iso(x + w, y + d, z),
    iso(x + w, y, z),
  ]);
  return (
    <g className={cls} style={{ "--pt-fill": fill } as React.CSSProperties}>
      <polygon points={left} className="pt-iso-left" />
      <polygon points={right} className="pt-iso-right" />
      <polygon points={top} className="pt-iso-top" />
    </g>
  );
}

/** Where each Manager's desk stands on the floor, in floor units. */
const DESKS: Record<string, [number, number]> = {
  product: [0, 0],
  frontend: [8, 0],
  performance: [16, 0],
  "gpt-live": [0, 8],
  mobile: [8, 8],
};
const YOU: [number, number] = [16, 8];

function sum(at: [number, number] | undefined): number {
  return at === undefined ? 0 : at[0] + at[1];
}

function Desk({ m }: { m: TeamManager }): React.JSX.Element {
  const [x, y] = DESKS[m.id] ?? [0, 0];
  return (
    <g>
      <Box x={x} y={y} w={4.4} d={2} h={0.9} fill={faceInk(m)} cls="pt-iso-desk" />
      {m.agents.map((a, i) => (
        <Box
          key={a.name}
          x={x + 0.3 + i * 1.05}
          y={y + 0.3}
          z={0.9}
          w={0.85}
          d={0.18}
          h={0.75}
          fill={AGENT_LOOK[a.state].ink}
          cls="pt-iso-monitor"
        />
      ))}
    </g>
  );
}

export function Studio(): React.JSX.Element {
  const floor = pts([iso(-1, -1), iso(21.5, -1), iso(21.5, 11.5), iso(-1, 11.5)]);
  const center = (id: string): [number, number] => {
    const [x, y] = DESKS[id] ?? [0, 0];
    return iso(x + 2.2, y + 2.8);
  };
  return (
    <div className="pt-studio">
      <div className="pt-studio-head">
        <div className="pt-display">The studio</div>
        <div className="pt-muted">
          Each monitor is an agent, lit by what it is doing · paths on the floor are handoffs
        </div>
      </div>
      <div className="pt-studio-floor" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <polygon points={floor} className="pt-iso-floor" />
          {Array.from({ length: 22 }, (_, i) => (
            <polyline
              key={`gx${i}`}
              points={pts([iso(i, -1), iso(i, 11.5)])}
              className="pt-iso-grid"
            />
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <polyline
              key={`gy${i}`}
              points={pts([iso(-1, i), iso(21.5, i)])}
              className="pt-iso-grid"
            />
          ))}
          {HANDOFFS.map((h) => {
            const [ax, ay] = center(h.from);
            const [bx, by] = center(h.to);
            return (
              <path
                key={h.what}
                d={`M ${ax} ${ay} Q ${(ax + bx) / 2} ${(ay + by) / 2 + 40} ${bx} ${by}`}
                className="pt-iso-path"
              />
            );
          })}
          {[...MANAGERS]
            .sort((a, b) => sum(DESKS[a.id]) - sum(DESKS[b.id]))
            .map((m) => (
              <Desk key={m.id} m={m} />
            ))}
          <Box
            x={YOU[0]}
            y={YOU[1]}
            w={4.4}
            d={2.2}
            h={0.9}
            fill="var(--ui-color-surface)"
            cls="pt-iso-desk"
          />
          {MANAGERS.flatMap((m) => m.asks.map((a) => ({ m, a }))).map(({ m, a }, i) => (
            <Box
              key={a.title}
              x={YOU[0] + 0.3 + (i % 2) * 2}
              y={YOU[1] + 0.2 + Math.floor(i / 2) * 1}
              z={0.9}
              w={1.6}
              d={0.8}
              h={0.25}
              fill={faceInk(m)}
              cls="pt-iso-tray"
            />
          ))}
        </svg>
        {MANAGERS.map((m) => {
          const [x, y] = DESKS[m.id] ?? [0, 0];
          const [fx, fy] = iso(x + 2.2, y + 1.5, 0.9);
          return (
            <div key={m.id}>
              <div className="pt-studio-face" style={{ left: fx - 32, top: fy - 58 }}>
                <Face m={m} big="xl" />
              </div>
              <div
                className="pt-studio-plaque"
                style={{ left: fx - 115, top: fy - 66, transform: "translateY(-100%)" }}
                data-needs={m.asks.length > 0 ? "true" : undefined}
              >
                <div className="pt-studio-plaque-name">
                  {m.name} <ManagerBadge m={m} />
                </div>
                <div className="pt-small">{m.focus}</div>
                {m.asks.map((a) => (
                  <div key={a.title} className="pt-studio-plaque-ask">
                    ↳ {a.title}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {(() => {
          const [fx, fy] = iso(YOU[0] + 2.2, YOU[1] + 2.6, 0.9);
          const [lx, ly] = iso(YOU[0] + 4.4, YOU[1] + 2.2, 0);
          return (
            <>
              <div className="pt-studio-face" style={{ left: fx - 24, top: fy - 52 }}>
                <Avatar name={ME.name} size={AVATAR_SIZE.PAGE} decorative />
              </div>
              <div
                className="pt-studio-plaque pt-studio-you"
                style={{ left: lx - 520, top: ly - 40 }}
              >
                <div className="pt-studio-plaque-name">Your desk</div>
                <div className="pt-small">{`${TOTAL_ASKS} trays in your inbox, each in its Manager's color`}</div>
              </div>
            </>
          );
        })()}
        <div className="pt-studio-wall">
          <div className="pt-small pt-muted">PINNED: HANDOFFS</div>
          {HANDOFFS.map((h) => (
            <div key={h.what} className="pt-studio-note">
              <strong>
                {managerById(h.from).name} → {managerById(h.to).name}
              </strong>
              <br />
              {h.what} · {h.age}
            </div>
          ))}
        </div>
        <div className="pt-studio-legend">
          <span>
            <i style={{ background: AGENT_LOOK.working.ink }} />
            Working
          </span>
          <span>
            <i style={{ background: AGENT_LOOK["needs-you"].ink }} />
            Needs you
          </span>
          <span>
            <i style={{ background: AGENT_LOOK.review.ink }} />
            In review
          </span>
          <span>
            <i style={{ background: AGENT_LOOK.done.ink }} />
            Done
          </span>
          <span>
            <i style={{ background: AGENT_LOOK.idle.ink }} />
            Queued
          </span>
        </div>
      </div>
    </div>
  );
}
