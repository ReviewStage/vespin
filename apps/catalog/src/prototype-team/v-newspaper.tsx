/**
 * v-newspaper.tsx -- PROTOTYPE, throwaway: the team's day as a newspaper front page, the Managers' work as its stories and what needs you as the box above the fold.
 */

import { CountParts, linesCount } from "@repo/ui";
import { HANDOFFS, MANAGERS, managerById, PR_STATE, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, WordsFace } from "./shared";

export function Newspaper(): React.JSX.Element {
  const [lead, ...rest] = [...MANAGERS].sort((a, b) => b.asks.length - a.asks.length);
  if (lead === undefined) throw new Error("No lead");
  const merged = MANAGERS.flatMap((m) =>
    m.pullRequests.filter((p) => p.state === PR_STATE.MERGED).map((p) => ({ m, p })),
  );
  const open = MANAGERS.flatMap((m) =>
    m.pullRequests.filter((p) => p.state !== PR_STATE.MERGED).map((p) => ({ m, p })),
  );
  return (
    <div className="pt-paper">
      <header className="pt-paper-mast">
        <div className="pt-paper-ears">
          <span>Wednesday, November 25, 2026</span>
          <span>{`${MANAGERS.length} Managers · ${MANAGERS.reduce((n, m) => n + m.agents.length, 0)} agents · ${TOTAL_ASKS} asks`}</span>
        </div>
        <h1 className="pt-paper-title">The Daily Standup</h1>
        <div className="pt-paper-rule" />
      </header>
      <div className="pt-paper-grid">
        <aside className="pt-paper-side">
          <section className="pt-paper-box">
            <h2 className="pt-paper-box-head">Awaiting your signature</h2>
            {MANAGERS.flatMap((m) =>
              m.asks.map((ask) => (
                <div key={ask.title} className="pt-paper-ask">
                  <div className="pt-paper-ask-title">{ask.title}</div>
                  <div className="pt-paper-ask-by">
                    <WordsFace m={m} /> {m.name} · {ask.age} ago
                  </div>
                </div>
              )),
            )}
          </section>
          <section>
            <h2 className="pt-paper-section">Off the wire: handoffs</h2>
            {HANDOFFS.map((h) => (
              <p key={h.what} className="pt-paper-brief">
                <strong>
                  {managerById(h.from).name} → {managerById(h.to).name}.
                </strong>{" "}
                {h.what}. <span className="pt-muted">{h.age} ago</span>
              </p>
            ))}
          </section>
        </aside>
        <main className="pt-paper-main">
          <article className="pt-paper-lead">
            <div className="pt-paper-kicker">Needs you · {lead.asks.length} asks</div>
            <h2 className="pt-paper-headline">{lead.headline}</h2>
            <div className="pt-paper-byline">
              <WordsFace m={lead} /> By {lead.name} · Focus: {lead.focus}
            </div>
            <p className="pt-paper-body">
              <span className="pt-paper-drop">Y</span>esterday the desk{" "}
              {lead.yesterday.charAt(0).toLowerCase() + lead.yesterday.slice(1)} Today its one agent
              at the switchboard is held: it needs the realtime scope on your OpenAI key, and a
              ruling on whether a call may start an agent at all. Nothing moves until you answer.
            </p>
          </article>
          <div className="pt-paper-stories">
            {rest.map((m) => (
              <article key={m.id} className="pt-paper-story">
                <div
                  className="pt-paper-kicker"
                  data-quiet={m.asks.length === 0 ? "true" : undefined}
                >
                  {m.asks.length > 0
                    ? `Needs you · ${m.asks.length}`
                    : m.working
                      ? "At work"
                      : "Resting"}
                </div>
                <h3 className="pt-paper-subhead">{m.headline}</h3>
                <div className="pt-paper-byline">
                  <WordsFace m={m} /> By {m.name}
                </div>
                <p className="pt-paper-body">{m.yesterday}</p>
                <ul className="pt-paper-agents">
                  {m.agents.map((a) => (
                    <li key={a.name}>
                      <span className="pt-dot" style={{ background: AGENT_LOOK[a.state].ink }} />
                      {a.name} <span className="pt-muted">— {a.doing}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </main>
        <aside className="pt-paper-side">
          <section>
            <h2 className="pt-paper-section">Markets: merged</h2>
            <table className="pt-paper-table">
              <tbody>
                {merged.map(({ m, p }) => (
                  <tr key={p.number}>
                    <td className="pt-mono">#{p.number}</td>
                    <td>{m.name}</td>
                    <td className="pt-num">
                      <CountParts parts={linesCount(p.additions, p.deletions)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h2 className="pt-paper-section">In the queue</h2>
            <table className="pt-paper-table">
              <tbody>
                {open.map(({ m, p }) => (
                  <tr key={p.number}>
                    <td className="pt-mono">#{p.number}</td>
                    <td>{p.title}</td>
                    <td className="pt-num">{m.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="pt-paper-weather">
            <h2 className="pt-paper-section">Forecast</h2>
            <p className="pt-paper-brief">
              Busy, with asks gathering over GPT Live. TestFlight 0.25 expected overnight.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
