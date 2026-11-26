/**
 * office-page.tsx -- PROTOTYPE, throwaway: the Office, every Manager at its desk as a real page of the app, in three layouts, built only from @repo/ui and the panel's own parts.
 */

import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import {
  Badge,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  DetailPage,
  GAP,
  LIST_INSET,
  LIST_ROW_META,
  List,
  ListRow,
  PAGE_FRAME,
  PAGE_WIDTH,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
  TaskRowGlyph,
  TaskRows,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { AgentGlyph } from "../../tasks/tab-look.js";
import { PersonBody, PersonSectionFrame } from "../person-frame.js";
import { AGENT_STATE, type Agent, type AgentState } from "./fixture.js";
import {
  asksOf,
  byId,
  handoffsOf,
  MANAGER_STATUS,
  type ManagerStatus,
  type OfficeManager,
  statusOf,
  teamOf,
} from "./office-data.js";
import { OFFICE_SIZE, OFFICE_VARIANT, type OfficeVariant } from "./office-params.js";
import "./office.css";

const MODEL = "anthropic/claude-opus-5.5";

const AGENT_LOOK: Record<
  AgentState,
  { status: AgentStatus | undefined; tone: StatusTone; words: string; at: string }
> = {
  [AGENT_STATE.WORKING]: {
    status: AGENT_STATUS.RUNNING,
    tone: STATUS_TONE.WORKING,
    words: "Working",
    at: "now",
  },
  [AGENT_STATE.NEEDS_YOU]: {
    status: AGENT_STATUS.COMPLETED,
    tone: STATUS_TONE.ATTENTION,
    words: "Waiting on you",
    at: "12m",
  },
  [AGENT_STATE.REVIEW]: {
    status: AGENT_STATUS.COMPLETED,
    tone: STATUS_TONE.STARTING,
    words: "In review",
    at: "40m",
  },
  [AGENT_STATE.DONE]: {
    status: AGENT_STATUS.COMPLETED,
    tone: STATUS_TONE.COMPLETE,
    words: "Merged",
    at: "2h",
  },
  [AGENT_STATE.IDLE]: { status: undefined, tone: STATUS_TONE.NEUTRAL, words: "Queued", at: "—" },
};

const STATUS_LOOK: Record<ManagerStatus, { tone: StatusTone; words: string }> = {
  [MANAGER_STATUS.WAITING]: { tone: STATUS_TONE.ATTENTION, words: "Waiting on you" },
  [MANAGER_STATUS.WORKING]: { tone: STATUS_TONE.WORKING, words: "Working" },
  [MANAGER_STATUS.IDLE]: { tone: STATUS_TONE.NEUTRAL, words: "Idle" },
};

const AGENT_CELLS = [TASK_ROW_CELL.STATUS, TASK_ROW_CELL.END, TASK_ROW_CELL.UPDATED] as const;
const SEAT_CELLS = [TASK_ROW_CELL.STATUS, TASK_ROW_CELL.END] as const;

const noop = () => {};

function StatusChip({ m }: { m: OfficeManager }): React.JSX.Element {
  const look = STATUS_LOOK[statusOf(m)];
  return (
    <Badge tone={look.tone}>
      {m.asks.length > 1 ? `${look.words} · ${m.asks.length}` : look.words}
    </Badge>
  );
}

function RowFace({ m }: { m: OfficeManager }): React.JSX.Element {
  return <ManagerFace face={m.face} size={MANAGER_FACE_SIZE.ROW} working={m.working} />;
}

/** A Manager's nameplate: the row that opens its chat. */
function Nameplate({ m }: { m: OfficeManager }): React.JSX.Element {
  return (
    <List label={m.name} inset={LIST_INSET.ROW}>
      <ListRow
        leading={<ManagerFace face={m.face} size={MANAGER_FACE_SIZE.MESSAGE} working={m.working} />}
        title={
          <>
            {m.name}{" "}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {m.role}
            </Text>
          </>
        }
        description={m.focus}
        meta={<StatusChip m={m} />}
        metaAt={LIST_ROW_META.TITLE}
        onPress={noop}
      />
    </List>
  );
}

/** The agents at a Manager's desks, each a task row's anatomy as the Manager Overview lists them. */
function AgentDesks({
  m,
  agents,
  cells = AGENT_CELLS,
}: {
  m: OfficeManager;
  agents: readonly Agent[];
  cells?: readonly TaskRowCell[];
}): React.JSX.Element {
  return (
    <TaskRows
      label={`${m.name}'s agents`}
      cells={cells}
      more={false}
      edges={TASK_ROW_EDGES.UNCHOSEN}
    >
      {agents.map((a) => {
        const look = AGENT_LOOK[a.state];
        return (
          <TaskRow
            key={a.name}
            taskId={`${m.id}-${a.name}`}
            name={a.name}
            cells={cells}
            content={{
              [TASK_ROW_CELL.STATUS]: (
                <TaskRowGlyph>
                  <AgentGlyph agent={{ model: MODEL, status: look.status }} />
                </TaskRowGlyph>
              ),
              [TASK_ROW_CELL.END]: <Badge tone={look.tone}>{look.words}</Badge>,
              [TASK_ROW_CELL.UPDATED]: (
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {look.at}
                </Text>
              ),
            }}
            more={false}
            edges={TASK_ROW_EDGES.UNCHOSEN}
            onOpen={noop}
          />
        );
      })}
    </TaskRows>
  );
}

/** A section on a card of its own, as the Manager Overview stands its parts. */
function Room({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count?: number;
  tone?: StatusTone;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.SNUG}>
      <PersonSectionFrame label={title} title={title} count={count} tone={tone}>
        {children}
      </PersonSectionFrame>
    </Card>
  );
}

function YourDesk({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  const asks = asksOf(team);
  return (
    <Room title="Your desk" count={asks.length} tone={STATUS_TONE.ATTENTION}>
      <List label="Your desk" inset={LIST_INSET.ROW}>
        {asks.map(({ m, ask }) => (
          <ListRow
            key={ask.title}
            leading={<RowFace m={m} />}
            title={ask.title}
            description={`${m.name} · ${ask.detail}`}
            meta={ask.age}
            tone={STATUS_TONE.ATTENTION}
            unread
            chevron
            onPress={noop}
          />
        ))}
      </List>
    </Room>
  );
}

function MeetingRoom({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  const handoffs = handoffsOf(team);
  return (
    <Room title="Meeting room" count={handoffs.length}>
      <List label="Meeting room" inset={LIST_INSET.ROW}>
        {handoffs.map((h) => {
          const from = byId(team, h.from);
          const to = byId(team, h.to);
          return (
            <ListRow
              key={h.what}
              leading={
                <span className="office-pair">
                  <RowFace m={from} />
                  <RowFace m={to} />
                </span>
              }
              title={h.what}
              description={`${from.name} handed it to ${to.name}`}
              meta={h.age}
              onPress={noop}
            />
          );
        })}
      </List>
    </Room>
  );
}

function StandupBoard({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  return (
    <Room title="Standup board" count={team.length}>
      <List label="Standup board" inset={LIST_INSET.ROW}>
        {team.map((m) => {
          const working = m.agents.filter((a) => a.state === AGENT_STATE.WORKING).length;
          return (
            <ListRow
              key={m.id}
              leading={<RowFace m={m} />}
              title={m.focus}
              description={`${m.name} · ${working} working · ${m.mergedThisWeek} merged this week`}
              onPress={noop}
            />
          );
        })}
      </List>
    </Room>
  );
}

/** A Manager's desk: its nameplate over its agents' desks, on a card. */
function Desk({ m }: { m: OfficeManager }): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.SNUG}>
      <Stack gap={GAP.TIGHT}>
        <Nameplate m={m} />
        <AgentDesks m={m} agents={m.agents} />
      </Stack>
    </Card>
  );
}

/** Desks: what waits on you and the rooms across the top, then a grid of desks. */
function DesksLayout({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  return (
    <PersonBody>
      <div className="office-rooms">
        <YourDesk team={team} />
        <MeetingRoom team={team} />
      </div>
      <PersonSectionFrame label="Desks" title="Desks" count={team.length}>
        <div className="office-desks">
          {team.map((m) => (
            <Desk key={m.id} m={m} />
          ))}
        </div>
      </PersonSectionFrame>
      <StandupBoard team={team} />
    </PersonBody>
  );
}

/** Floor: the same desks as pods on a light floor plan, your office and the meeting room as walled rooms beside the open floor. */
function FloorLayout({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  return (
    <div className="office-plan">
      <div className="office-plan-side">
        <div className="office-plan-room" data-room="you">
          <span className="office-plan-label">Your office</span>
          <YourDesk team={team} />
        </div>
        <div className="office-plan-room">
          <span className="office-plan-label">Meeting room</span>
          <MeetingRoom team={team} />
        </div>
      </div>
      <div className="office-plan-floor">
        <span className="office-plan-label">Open floor</span>
        <div className="office-pods">
          {team.map((m) => (
            <div key={m.id} className="office-pod" data-status={statusOf(m)}>
              <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.SNUG}>
                <Nameplate m={m} />
              </Card>
              <div className="office-pod-seats">
                <AgentDesks m={m} agents={m.agents} cells={SEAT_CELLS} />
              </div>
            </div>
          ))}
        </div>
        <span className="office-plan-label">Standup board</span>
        <StandupBoard team={team} />
      </div>
    </div>
  );
}

/** Rooms: every Manager one row, grouped into who is at your door, at their desks, and away; the rooms beside them. */
function RoomsLayout({ team }: { team: readonly OfficeManager[] }): React.JSX.Element {
  const groups: { status: ManagerStatus; title: string; tone?: StatusTone }[] = [
    { status: MANAGER_STATUS.WAITING, title: "At your door", tone: STATUS_TONE.ATTENTION },
    { status: MANAGER_STATUS.WORKING, title: "At their desks" },
    { status: MANAGER_STATUS.IDLE, title: "Away" },
  ];
  return (
    <PersonBody>
      {groups.map((g) => {
        const here = team.filter((m) => statusOf(m) === g.status);
        if (here.length === 0) return null;
        return (
          <PersonSectionFrame
            key={g.status}
            label={g.title}
            title={g.title}
            count={here.length}
            tone={g.tone}
          >
            <Stack gap={GAP.BLOCK}>
              {here.map((m) => (
                <div key={m.id} className="office-row">
                  <Nameplate m={m} />
                  {m.asks.length > 0 ? (
                    <List label={`${m.name} asks`} inset={LIST_INSET.ROW}>
                      {m.asks.map((ask) => (
                        <ListRow
                          key={ask.title}
                          depth={1}
                          leading={<RowFace m={m} />}
                          title={ask.title}
                          description={ask.detail}
                          meta={ask.age}
                          tone={STATUS_TONE.ATTENTION}
                          unread
                          chevron
                          onPress={noop}
                        />
                      ))}
                    </List>
                  ) : null}
                  <AgentDesks m={m} agents={m.agents} />
                </div>
              ))}
            </Stack>
          </PersonSectionFrame>
        );
      })}
    </PersonBody>
  );
}

/** The Office as a page of the app. */
export function OfficePage({ variant }: { variant: OfficeVariant }): React.JSX.Element {
  const team = teamOf(OFFICE_SIZE);
  const asks = asksOf(team).length;
  const working = team.filter((m) => m.working).length;
  const description = `${team.length} Managers · ${working} at work · ${asks} waiting on you`;
  if (variant === OFFICE_VARIANT.ROOMS) {
    return (
      <DetailPage
        frame={PAGE_FRAME.PAGE}
        title="Office"
        description={description}
        width={PAGE_WIDTH.FULL}
        secondary={{
          label: "Rooms",
          content: (
            <Stack gap={GAP.SECTION}>
              <YourDesk team={team} />
              <MeetingRoom team={team} />
            </Stack>
          ),
        }}
      >
        <RoomsLayout team={team} />
      </DetailPage>
    );
  }
  return (
    <DetailPage
      frame={PAGE_FRAME.PAGE}
      title="Office"
      description={description}
      width={PAGE_WIDTH.FULL}
    >
      {variant === OFFICE_VARIANT.FLOOR ? <FloorLayout team={team} /> : <DesksLayout team={team} />}
    </DetailPage>
  );
}
