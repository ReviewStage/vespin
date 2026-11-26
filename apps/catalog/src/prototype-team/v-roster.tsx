/**
 * v-roster.tsx -- PROTOTYPE, throwaway: the practical one, a roster of Manager cards with what waits on you above and the team's feed beside.
 */

import {
  CARD_LOOK,
  CARD_PADDING,
  Card,
  GAP,
  Inline,
  JUSTIFY,
  LIST_INSET,
  List,
  ListRow,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { FEED, HANDOFFS, MANAGERS, managerById, openPrs, TOTAL_ASKS } from "./fixture";
import { AgentBadge, Face, ManagerBadge, RowFace } from "./shared";

function ManagerCard({ m }: { m: (typeof MANAGERS)[number] }): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.BLOCK}>
        <div className="pt-roster-card-head">
          <Face m={m} />
          <div className="pt-grow">
            <Text variant={TEXT_VARIANT.LABEL}>{m.name}</Text>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {m.focus}
            </Text>
          </div>
          <ManagerBadge m={m} />
        </div>
        <Stack gap={GAP.TIGHT}>
          {m.agents.map((a) => (
            <Inline key={a.name} gap={GAP.ITEM} justify={JUSTIFY.BETWEEN}>
              <Text variant={TEXT_VARIANT.CAPTION} truncate>
                {a.name}
              </Text>
              <AgentBadge state={a.state} />
            </Inline>
          ))}
        </Stack>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`${openPrs(m).length} open PRs · ${m.mergedThisWeek} merged this week`}
        </Text>
      </Stack>
    </Card>
  );
}

export function Roster(): React.JSX.Element {
  const asks = MANAGERS.flatMap((m) => m.asks.map((ask) => ({ m, ask })));
  const working = MANAGERS.filter((m) => m.working).length;
  return (
    <div className="pt-roster">
      <Stack gap={GAP.SECTION}>
        <Stack gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.TITLE}>Your team</Text>
          <Text
            tone={TEXT_TONE.MUTED}
          >{`${working} of ${MANAGERS.length} Managers at work · ${TOTAL_ASKS} things need you`}</Text>
        </Stack>
        <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.SNUG}>
          <Stack gap={GAP.TIGHT}>
            <div className="pt-roster-head">
              <Text variant={TEXT_VARIANT.LABEL}>Waiting on you</Text>
            </div>
            <List label="Waiting on you" inset={LIST_INSET.ROW}>
              {asks.map(({ m, ask }) => (
                <ListRow
                  key={ask.title}
                  leading={<RowFace m={m} />}
                  title={ask.title}
                  description={`${m.name} · ${ask.detail}`}
                  meta={ask.age}
                  chevron
                  onPress={() => {}}
                />
              ))}
            </List>
          </Stack>
        </Card>
        <div className="pt-roster-body">
          <div className="pt-roster-grid">
            {MANAGERS.map((m) => (
              <ManagerCard key={m.id} m={m} />
            ))}
            <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
              <Stack gap={GAP.BLOCK}>
                <Text variant={TEXT_VARIANT.LABEL}>Handoffs between Managers</Text>
                {HANDOFFS.map((h) => (
                  <div key={h.what} className="pt-feed-row">
                    <RowFace m={managerById(h.from)} />
                    <span className="pt-small">→</span>
                    <RowFace m={managerById(h.to)} />
                    <Text variant={TEXT_VARIANT.CAPTION}>
                      {h.what}
                      <span className="pt-muted">{` · ${h.age}`}</span>
                    </Text>
                  </div>
                ))}
              </Stack>
            </Card>
          </div>
          <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
            <Stack gap={GAP.BLOCK}>
              <Text variant={TEXT_VARIANT.LABEL}>Team feed</Text>
              {FEED.map((e) => {
                const m = managerById(e.manager);
                return (
                  <div key={`${e.manager}${e.at}${e.kind}`} className="pt-feed-row">
                    <RowFace m={m} />
                    <Text variant={TEXT_VARIANT.CAPTION}>
                      <strong>{m.name}</strong> {e.text}
                      <span className="pt-muted">{` · ${e.at}`}</span>
                    </Text>
                  </div>
                );
              })}
            </Stack>
          </Card>
        </div>
      </Stack>
    </div>
  );
}
