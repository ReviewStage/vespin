/**
 * v-building.tsx -- PROTOTYPE, throwaway: the team as a building in elevation, a floor per Manager whose windows are its agents lit by what they do, an elevator carrying handoffs between floors, and you in the lobby with the mail.
 */

import { AVATAR_SIZE, Avatar } from "@repo/ui";
import { AGENT_STATE, HANDOFFS, MANAGERS, ME, managerById, PR_STATE, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, Face, faceInk } from "./shared";

const WINDOWS = 5;

export function Building(): React.JSX.Element {
  const floors = [...MANAGERS].reverse();
  const merged = MANAGERS.reduce((n, m) => n + m.mergedThisWeek, 0);
  return (
    <div className="pt-building">
      <div className="pt-building-side">
        <div className="pt-display">Vespin HQ</div>
        <div className="pt-muted">
          A floor per Manager · each window an agent, lit by what it is doing · the elevator carries
          handoffs
        </div>
        <div className="pt-building-legend">
          {Object.values(AGENT_STATE).map((s) => (
            <span key={s}>
              <i style={{ background: AGENT_LOOK[s].ink }} />
              {AGENT_LOOK[s].words}
            </span>
          ))}
          <span>
            <i className="pt-building-dark" />
            Empty desk
          </span>
        </div>
        <div className="pt-building-log">
          <div className="pt-building-log-head">Elevator log</div>
          {HANDOFFS.map((h) => (
            <div key={h.what} className="pt-small">
              <strong>{managerById(h.from).name}</strong> →{" "}
              <strong>{managerById(h.to).name}</strong>: {h.what}{" "}
              <span className="pt-muted">· {h.age}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pt-building-tower">
        <div className="pt-building-roof">
          <span className="pt-building-sign">{`${merged} merged this week`}</span>
        </div>
        {floors.map((m, i) => {
          const goingHere = HANDOFFS.filter((h) => h.to === m.id);
          return (
            <div
              key={m.id}
              className="pt-floor"
              style={{ "--pt-ink": faceInk(m) } as React.CSSProperties}
              data-needs={m.asks.length > 0 ? "true" : undefined}
            >
              <div className="pt-floor-number">{floors.length - i}</div>
              <div className="pt-floor-plate">
                <Face m={m} big="l" />
                <div>
                  <div className="pt-floor-name">{m.name}</div>
                  <div className="pt-small">{m.focus}</div>
                </div>
              </div>
              <div className="pt-floor-windows">
                {Array.from({ length: WINDOWS }, (_, k) => {
                  const a = m.agents[k];
                  return (
                    <div
                      key={k}
                      className="pt-window"
                      data-state={a?.state ?? "empty"}
                      style={
                        a
                          ? ({ "--pt-lit": AGENT_LOOK[a.state].ink } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {a ? <span className="pt-window-name">{a.name}</span> : null}
                      {a?.state === AGENT_STATE.NEEDS_YOU ? (
                        <span className="pt-window-flag">needs you</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="pt-floor-balcony">
                {m.asks.length > 0 ? (
                  <span className="pt-floor-banner">{`${m.asks.length} for you ↓`}</span>
                ) : (
                  <span className="pt-muted pt-small">{`${m.pullRequests.filter((p) => p.state !== PR_STATE.MERGED).length} PRs open`}</span>
                )}
              </div>
              <div className="pt-floor-shaft">
                {goingHere.map((h) => (
                  <div
                    key={h.what}
                    className="pt-elevator"
                    style={{ "--pt-ink": faceInk(managerById(h.from)) } as React.CSSProperties}
                  >
                    <span className="pt-small">from {managerById(h.from).name}</span>
                    <span className="pt-elevator-what">{h.what}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className="pt-lobby">
          <div className="pt-lobby-you">
            <Avatar name={ME.name} size={AVATAR_SIZE.CARD} decorative />
            <div>
              <div className="pt-floor-name">Lobby · you</div>
              <div className="pt-small">{`${TOTAL_ASKS} letters in your box`}</div>
            </div>
          </div>
          <div className="pt-mailboxes">
            {MANAGERS.map((m) => (
              <div
                key={m.id}
                className="pt-mailbox"
                data-full={m.asks.length > 0 ? "true" : undefined}
                style={{ "--pt-ink": faceInk(m) } as React.CSSProperties}
              >
                <span className="pt-mailbox-count">{m.asks.length}</span>
                <span className="pt-small">{m.name}</span>
              </div>
            ))}
          </div>
          <div className="pt-lobby-door" />
        </div>
      </div>
    </div>
  );
}
