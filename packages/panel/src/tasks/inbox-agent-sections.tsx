/**
 * inbox-agent-sections.tsx -- the Inbox threads prototype's Inbox: one row
 * per agent rather than per thread, in sections by what the agent needs of
 * the reader (Needs you, Done, Running, Scheduled, Archived), its open asks
 * listed under it. A post with no ask never puts its agent in Needs you; it
 * only marks the agent unread. A row opens the agent's chat at its newest
 * line, and an ask under it opens its thread drilled into the agent's card.
 * A throwaway prototype on `prototype/inbox-threads-real`; nothing merges.
 */

import { AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import type { InboxGroup } from "@repo/features/inbox-list-model";
import { INBOX_STATUS, type InboxItem, openAskOf } from "@repo/features/inbox-wire";
import { agentName, type modelLabel } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import { FIXTURE_WAKES } from "@repo/host/fixture-inbox";
import {
  GAP,
  GlyphSlot,
  GROUP_LOOK,
  GroupHeader,
  LIST_ROW_META,
  List,
  ListRow,
  Spinner,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  UnreadMark,
  useMinute,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The sections, in the order they stand, and whether each starts open. */
const SECTION = {
  NEEDS_YOU: "Needs you",
  DONE: "Done",
  RUNNING: "Running",
  SCHEDULED: "Scheduled",
  ARCHIVED: "Archived",
} as const;

type Section = (typeof SECTION)[keyof typeof SECTION];

const SECTIONS: readonly { readonly section: Section; readonly open: boolean }[] = [
  { section: SECTION.NEEDS_YOU, open: true },
  { section: SECTION.DONE, open: true },
  { section: SECTION.RUNNING, open: true },
  { section: SECTION.SCHEDULED, open: true },
  { section: SECTION.ARCHIVED, open: false },
];

/** One agent as the sections list it: its section, its open asks, and whether something of its is unread. */
interface AgentLine {
  readonly agent: ListedAgent;
  readonly section: Section;
  readonly task: string | undefined;
  readonly asks: readonly InboxItem[];
  readonly unread: boolean;
  readonly latest: number;
}

/** Whether an item waits on the reader: open, with an ask still open. */
function isAsking(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) !== undefined;
}

/** Whether an agent is at work now. */
function isRunning(agent: ListedAgent): boolean {
  return agent.status === AGENT_STATUS.RUNNING || agent.status === AGENT_STATUS.STARTING;
}

/** Which section an agent stands in, by what it needs of the reader first, then what it is doing. */
function sectionOf(agent: ListedAgent, asks: readonly InboxItem[]): Section {
  if (agent.archivedAt !== undefined) return SECTION.ARCHIVED;
  if (asks.length > 0) return SECTION.NEEDS_YOU;
  if (FIXTURE_WAKES.has(agent.id)) return SECTION.SCHEDULED;
  return isRunning(agent) ? SECTION.RUNNING : SECTION.DONE;
}

/** "12m", "3h", "Nov 6": an age as a row says it. */
function ageWords(at: number, now: number): string {
  const gone = Math.max(0, now - at);
  if (gone < HOUR) return `${Math.max(1, Math.round(gone / MINUTE))}m`;
  if (gone < DAY) return `${Math.round(gone / HOUR)}h`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** What a row says at its end: a spinner while the agent works, when a scheduled one wakes, or its age. */
function AgentMeta({ line, now }: { line: AgentLine; now: number }): React.JSX.Element {
  const wakes = FIXTURE_WAKES.get(line.agent.id);
  if (line.section !== SECTION.ARCHIVED && isRunning(line.agent)) {
    return <Spinner label="Working" delay={false} />;
  }
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
      {wakes === undefined
        ? ageWords(line.latest, now)
        : `Wakes ${new Date(wakes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
    </Text>
  );
}

/** The agents' lines, every agent the reader's tasks list, its items found among the Inbox's. */
function agentLines(
  groups: readonly InboxGroup[],
  agents: readonly ListedAgent[],
  tasks: readonly TaskSummary[],
): AgentLine[] {
  const items = groups.flatMap(({ items }) => items);
  return agents.map((agent) => {
    const own = items.filter((item) => item.agentId === agent.id);
    const asks = own.filter(isAsking).toSorted((a, b) => b.updatedAt - a.updatedAt);
    return {
      agent,
      section: sectionOf(agent, asks),
      task: tasks.find((task) => task.id === agent.planId)?.name,
      asks,
      unread: own.some((item) => item.unread === true),
      latest: Math.max(agent.createdAt, ...own.map((item) => item.updatedAt)),
    };
  });
}

/**
 * The Inbox as the prototype lists it: a section per standing, an agent's
 * row in its own, its open asks under it, each opening its thread.
 */
export function InboxAgentSections({
  groups,
  agents,
  tasks,
  models,
  onOpenAgent,
  onOpenThread,
}: {
  groups: readonly InboxGroup[];
  agents: readonly ListedAgent[];
  tasks: readonly TaskSummary[];
  models: Parameters<typeof modelLabel>[1];
  onOpenAgent: (agent: ListedAgent) => void;
  onOpenThread: (agent: ListedAgent, item: InboxItem) => void;
}): React.JSX.Element {
  const now = useMinute();
  const lines = agentLines(groups, agents, tasks);
  return (
    <Stack gap={GAP.FIELD}>
      {SECTIONS.map(({ section, open }) => {
        const rows = lines
          .filter((line) => line.section === section)
          .toSorted((a, b) => b.latest - a.latest);
        if (rows.length === 0) return null;
        return (
          <GroupHeader
            key={section}
            label={section}
            look={GROUP_LOOK.HEADING}
            count={{ value: rows.length, noun: rows.length === 1 ? "agent" : "agents" }}
            fold={{ defaultOpen: open }}
          >
            <List label={section}>
              {rows.flatMap((line) => [
                <ListRow
                  key={line.agent.id}
                  leading={
                    section === SECTION.DONE && line.unread ? (
                      <GlyphSlot size={ICON_SIZE.SMALL}>
                        <GLYPH.DONE />
                      </GlyphSlot>
                    ) : (
                      <UnreadMark unread={line.unread || section === SECTION.NEEDS_YOU} />
                    )
                  }
                  title={agentName(line.agent, models)}
                  description={line.task}
                  meta={<AgentMeta line={line} now={now} />}
                  metaAt={LIST_ROW_META.TITLE}
                  unread={line.unread || section === SECTION.NEEDS_YOU}
                  muted={section === SECTION.ARCHIVED}
                  more={false}
                  onPress={() => onOpenAgent(line.agent)}
                />,
                ...line.asks.map((item) => (
                  <ListRow
                    key={item.id}
                    depth={1}
                    leading={<GLYPH.DECIDE />}
                    title={item.title}
                    meta={ageWords(item.updatedAt, now)}
                    metaAt={LIST_ROW_META.TITLE}
                    unread={item.unread === true}
                    more={false}
                    onPress={() => onOpenThread(line.agent, item)}
                  />
                )),
              ])}
            </List>
          </GroupHeader>
        );
      })}
    </Stack>
  );
}
