/**
 * reference-office.tsx -- PROTOTYPE, throwaway: three views of the Managers' progress, each after a product people already read at a glance (Basecamp's Hilltop View, an airport's departures board, a Geekbot standup in Slack).
 */

import {
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardPress,
  ChannelMessage,
  DetailPage,
  LIST_INSET,
  LIST_ROW_META,
  LIST_ROW_TITLE_LINES,
  List,
  ListRow,
  PAGE_FRAME,
  PAGE_WIDTH,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DataTable,
} from "@repo/ui/data-table";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { OFFICE_VARIANT, type OfficeVariant } from "./office-params.js";
import {
  type GoalManager,
  hourWords,
  LOOKED_WORDS,
  listed,
  newSteps,
  TEAM,
} from "./progress-data.js";
import "./office.css";

const noop = () => {};

/** Where each goal stood on its hill when you last looked and where it stands now: 0 at the hill's foot, 50 its top, 100 done. */
const HILL: Record<string, { was: number; now: number }> = {
  frontend: { was: 62, now: 76 },
  chat: { was: 56, now: 68 },
  mobile: { was: 80, now: 90 },
  performance: { was: 28, now: 40 },
  reviews: { was: 72, now: 82 },
  storage: { was: 86, now: 86 },
  design: { was: 34, now: 46 },
  media: { was: 14, now: 14 },
};

const HILL_W = 260;
const HILL_H = 64;
const SPREAD = 0.2;
const TOP = 34;

function hillY(t: number): number {
  const x = t / 100;
  return HILL_H - (HILL_H - 6) * Math.exp(-((x - 0.5) ** 2) / (2 * SPREAD ** 2));
}

function hillPath(): string {
  const points = Array.from({ length: 53 }, (_, i) => {
    const t = (i / 52) * 100;
    return `${(t / 100) * HILL_W},${hillY(t).toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

/** What moved, said in one line. */
function movedWords(m: GoalManager): string {
  const fresh = newSteps(m);
  return fresh.length === 0 ? "Nothing new" : `New: ${listed(fresh.map((s) => s.what))}`;
}

function afterWords(m: GoalManager): string {
  return m.waiting === undefined ? `Next: ${m.next ?? ""}` : `Waiting on you: ${m.waiting}`;
}

/** After Basecamp's Hilltop View: a small hill per goal, uphill while it is still being figured out and downhill once it is being made, its face where it stands and a hollow dot where it stood when you last looked. */
function Hilltop(): React.JSX.Element {
  const path = hillPath();
  return (
    <div className="ref-hills">
      {TEAM.map((m) => {
        const spot = HILL[m.id] ?? { was: 0, now: 0 };
        const moved = spot.now !== spot.was;
        return (
          <Card key={m.id} look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
            <div className="ref-hill-card">
              <Text variant={TEXT_VARIANT.LABEL}>{m.goal}</Text>
              <div className="ref-hill" style={{ width: HILL_W, height: HILL_H + 28 + TOP }}>
                <svg
                  style={{ top: TOP }}
                  width={HILL_W}
                  height={HILL_H + 2}
                  viewBox={`0 0 ${HILL_W} ${HILL_H + 2}`}
                  aria-hidden="true"
                >
                  <line
                    x1={HILL_W / 2}
                    x2={HILL_W / 2}
                    y1={4}
                    y2={HILL_H}
                    className="ref-hill-crest"
                  />
                  <path d={path} className="ref-hill-line" />
                  {moved ? (
                    <circle
                      cx={(spot.was / 100) * HILL_W}
                      cy={hillY(spot.was)}
                      r={5}
                      className="ref-hill-was"
                    />
                  ) : null}
                </svg>
                <span
                  className="ref-hill-face"
                  data-moved={moved ? "true" : undefined}
                  style={{ left: (spot.now / 100) * HILL_W, top: hillY(spot.now) + TOP }}
                >
                  <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} />
                </span>
                <span className="ref-hill-end" data-end="start">
                  Figuring it out
                </span>
                <span className="ref-hill-end" data-end="end">
                  Making it happen
                </span>
              </div>
              <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.P}>
                <span className={moved ? "pg-new" : "pg-muted"}>{movedWords(m)}</span>
                <span className="pg-muted">{" · "}</span>
                <span className={m.waiting === undefined ? "pg-muted" : "pg-waiting"}>
                  {afterWords(m)}
                </span>
              </Text>
            </div>
            <CardPress onPress={noop} label={`Open ${m.name}`} />
          </Card>
        );
      })}
    </div>
  );
}

const STATUS = {
  MOVING: "Moving",
  WAITING: "Your turn",
  QUIET: "Quiet",
} as const;

function statusOf(m: GoalManager): (typeof STATUS)[keyof typeof STATUS] {
  if (m.waiting !== undefined) return STATUS.WAITING;
  return newSteps(m).length > 0 ? STATUS.MOVING : STATUS.QUIET;
}

const column = createDataTableColumnHelper<GoalManager>();

const BOARD_COLUMNS = column.columns([
  column.display({
    id: "goal",
    header: "Goal",
    cell: ({ row: { original: m } }) => (
      <span className="ref-board-goal">
        <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.ROW} />
        <span>{m.goal}</span>
      </span>
    ),
  }),
  column.display({
    id: "moved",
    header: `Since ${LOOKED_WORDS}`,
    cell: ({ row: { original: m } }) => {
      const fresh = newSteps(m);
      return fresh.length === 0 ? (
        <span className="pg-muted">—</span>
      ) : (
        listed(fresh.map((s) => s.what))
      );
    },
  }),
  column.display({
    id: "last",
    header: "Last moved",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: m } }) => {
      const last = m.steps.at(-1);
      return (
        <span className="ref-board-time">{last === undefined ? "—" : hourWords(last.at)}</span>
      );
    },
  }),
  column.display({
    id: "next",
    header: "Next",
    cell: ({ row: { original: m } }) => (m.waiting === undefined ? (m.next ?? "") : m.waiting),
  }),
  column.display({
    id: "status",
    header: "Status",
    cell: ({ row: { original: m } }) => {
      const status = statusOf(m);
      return (
        <span className="ref-board-status" data-status={status}>
          {status}
        </span>
      );
    },
  }),
]);

/** After an airport's departures board: one row per goal, read left to right, its last word the only state, in the one color that says it. */
function Board(): React.JSX.Element {
  const rows = [...TEAM].sort((a, b) => (b.steps.at(-1)?.at ?? 0) - (a.steps.at(-1)?.at ?? 0));
  return (
    <>
      <div className="ref-board">
        <DataTable
          label="Today's board"
          columns={BOARD_COLUMNS}
          rows={rows}
          getRowId={(m) => m.id}
          empty="No goals"
          onRowPress={noop}
        />
      </div>
      <div className="ref-board-phone">
        <List label="Today's board" inset={LIST_INSET.ROW}>
          {rows.map((m) => {
            const status = statusOf(m);
            return (
              <ListRow
                key={m.id}
                leading={<ManagerFace face={m.face} size={MANAGER_FACE_SIZE.ROW} />}
                title={m.goal}
                description={`${movedWords(m)} · ${afterWords(m)}`}
                meta={
                  <span className="ref-board-status" data-status={status}>
                    {status}
                  </span>
                }
                metaAt={LIST_ROW_META.TITLE}
                titleLines={LIST_ROW_TITLE_LINES.TWO}
                onPress={noop}
              />
            );
          })}
        </List>
      </div>
    </>
  );
}

/** After a Geekbot standup in a Slack channel: each Manager posts its two answers, what it did since you looked and what is next. */
function Standup(): React.JSX.Element {
  return (
    <div className="ref-standup">
      <Text
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.MUTED}
      >{`Standup · posted for you at 6:30 PM · since you looked at ${LOOKED_WORDS}`}</Text>
      {TEAM.map((m) => {
        const fresh = newSteps(m);
        return (
          <ChannelMessage
            key={m.id}
            avatar={<ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} />}
            name={m.name}
            at="6:30 PM"
          >
            <p className="ref-standup-goal">{m.goal}</p>
            <p className="ref-standup-line">
              {fresh.length > 0 ? (
                <>
                  <span className="pg-muted">Done: </span>
                  <span className="pg-new">
                    {m.letter.length > 0 ? listed(fresh.map((s) => s.what)) : ""}
                  </span>
                </>
              ) : (
                <span className="pg-muted">Nothing new since you looked</span>
              )}
              <span className="pg-muted">{"  ·  "}</span>
              {m.waiting === undefined ? (
                <>
                  <span className="pg-muted">Next: </span>
                  {m.next}
                </>
              ) : (
                <span className="pg-waiting">{`Blocked on you: ${m.waiting}`}</span>
              )}
            </p>
          </ChannelMessage>
        );
      })}
    </div>
  );
}

export function ReferenceOffice({ variant }: { variant: OfficeVariant }): React.JSX.Element {
  if (variant === OFFICE_VARIANT.HILLTOP) {
    return (
      <DetailPage
        frame={PAGE_FRAME.PAGE}
        title="Where each goal stands"
        description={`Since you looked at ${LOOKED_WORDS}`}
        width={PAGE_WIDTH.FULL}
      >
        <Hilltop />
      </DetailPage>
    );
  }
  if (variant === OFFICE_VARIANT.BOARD) {
    return (
      <DetailPage
        frame={PAGE_FRAME.PAGE}
        title="Today's board"
        description="Updated 6:30 PM"
        width={PAGE_WIDTH.FULL}
      >
        <Board />
      </DetailPage>
    );
  }
  return (
    <DetailPage frame={PAGE_FRAME.PAGE} title="#standup">
      <Standup />
    </DetailPage>
  );
}
