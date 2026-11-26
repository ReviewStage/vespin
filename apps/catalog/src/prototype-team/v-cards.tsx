/**
 * v-cards.tsx -- PROTOTYPE, throwaway: the team dealt as trading cards, one per Manager and one for you holding what you owe them.
 */

import { AVATAR_SIZE, Avatar, Badge, STATUS_TONE } from "@repo/ui";
import { AGENT_STATE, countAgents, MANAGERS, ME, openPrs, TOTAL_ASKS } from "./fixture";
import { AGENT_LOOK, Face, faceInk, WordsFace } from "./shared";

function Stat({
  label,
  value,
  hot,
}: {
  label: string;
  value: number;
  hot?: boolean;
}): React.JSX.Element {
  return (
    <div className="pt-card-stat" data-hot={hot ? "true" : undefined}>
      <span className="pt-card-stat-value">{value}</span>
      <span className="pt-card-stat-label">{label}</span>
    </div>
  );
}

export function TradingCards(): React.JSX.Element {
  return (
    <div className="pt-cards">
      <div className="pt-cards-title">
        <span className="pt-display">Your team</span>
        <span className="pt-muted">{`Five Managers dealt · ${TOTAL_ASKS} cards in your hand`}</span>
      </div>
      <div className="pt-cards-row">
        {MANAGERS.map((m) => (
          <article
            key={m.id}
            className="pt-card"
            style={{ "--pt-ink": faceInk(m) } as React.CSSProperties}
            data-needs={m.asks.length > 0 ? "true" : undefined}
          >
            <header className="pt-card-band">
              <span className="pt-card-name">{m.name}</span>
              <span className="pt-card-class">
                {m.working ? "On the field" : "Benched · waits on you"}
              </span>
            </header>
            <div className="pt-card-portrait">
              <Face m={m} big="xxl" />
            </div>
            <div className="pt-card-quest">
              <span className="pt-card-kicker">Current quest</span>
              <span className="pt-card-quest-text">{m.focus}</span>
            </div>
            <div className="pt-card-stats">
              <Stat label="Agents" value={countAgents(m, AGENT_STATE.WORKING)} />
              <Stat label="PRs" value={openPrs(m).length} />
              <Stat label="Merged" value={m.mergedThisWeek} />
              <Stat label="For you" value={m.asks.length} hot={m.asks.length > 0} />
            </div>
            <ul className="pt-card-moves">
              {m.agents.map((a) => (
                <li key={a.name}>
                  <span className="pt-dot" style={{ background: AGENT_LOOK[a.state].ink }} />
                  <span className="pt-card-move">{a.name}</span>
                  <span className="pt-card-move-state">{AGENT_LOOK[a.state].words}</span>
                </li>
              ))}
            </ul>
            <footer className="pt-card-flavor">“{m.yesterday}”</footer>
          </article>
        ))}
        <article className="pt-card pt-card-you" data-needs="true">
          <header className="pt-card-band">
            <span className="pt-card-name">You</span>
            <span className="pt-card-class">Team lead</span>
          </header>
          <div className="pt-card-portrait">
            <span className="pt-face-xxl-avatar">
              <Avatar name={ME.name} size={AVATAR_SIZE.PORTRAIT} decorative />
            </span>
          </div>
          <div className="pt-card-quest">
            <span className="pt-card-kicker">Your hand</span>
            <span className="pt-card-quest-text">{`${TOTAL_ASKS} asks to play`}</span>
          </div>
          <ul className="pt-card-hand">
            {MANAGERS.flatMap((m) =>
              m.asks.map((ask) => (
                <li key={ask.title}>
                  <WordsFace m={m} />
                  <span className="pt-card-move">{ask.title}</span>
                  <span className="pt-card-move-state">{ask.age}</span>
                </li>
              )),
            )}
          </ul>
          <footer className="pt-card-flavor">
            <Badge tone={STATUS_TONE.ATTENTION}>Oldest ask 3h</Badge>
          </footer>
        </article>
      </div>
    </div>
  );
}
