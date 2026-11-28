/**
 * manager-card.tsx -- the card a Manager hangs wherever it is named, its sidebar row, a mention's chip, or a line it sent: who it is, who started it, where it stands, and what waits on the reader.
 *
 * It is an agent's card (`agent-tab-card.tsx`) in its head and its first
 * row, so a Manager reads as one of the family a task's, an agent's, and a
 * person's cards make: its face at a card's size, livelier while it works,
 * its name, the model it runs on under it, and its corner, the run's count
 * while it works and else how long ago it last moved, after "Idle" where its
 * turn ended as a turn should, since a Manager at rest waits on its chat; then
 * who started it, as a task's card says who created it, where others share
 * its workspace or a teammate did. Under a rule, a receipt of the counts
 * a Manager is for (`HoverCardFigures`): how many of its threads wait on the
 * reader now, as the Inbox counts them (`waitsOnReaderNow`), how many of
 * the agents it started are at work, and how many pull requests they opened
 * are still open, each said only where it is not none.
 *
 * Everything is read from what the window already holds, so hanging it
 * asks the service nothing: the task list's agents and the pull requests
 * their rows name, followed live, and the account's Inbox feed, which holds the threads of every agent on no task.
 * Its latest step is no part of it: the window holds a Manager's transcript
 * only while its page is open.
 */

import { inboxRowOf } from "@repo/features/inbox-digest";
import { waitsOnReaderNow } from "@repo/features/inbox-list-model";
import { agentAtWork, pullRequestOpen } from "@repo/features/manager-overview-model";
import type { CatalogModel } from "@repo/features/models-wire";
import {
  HoverCard,
  type HoverCardFigure,
  HoverCardFigures,
  HoverCardRule,
  useMinute,
} from "@repo/ui";
import { and, eq, isUndefined, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { inboxItemsQuery } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { useTaskListCollections } from "../task-list-collections.js";
import type { AgentSubject } from "./agent-ref.js";
import { AgentCardHead, CARD_CORNER, type CardCorner, StartedBy } from "./agent-tab-card.js";
import { useMentionedReader } from "./mentioned-place.js";

/** What a Manager's corner says before how long ago it last moved, where its turn ended as a turn should: it waits on its chat. */
const IDLE_WORDS = "Idle";

/** What the card's counts say, each as its label. */
const FIGURE_WORDS = {
  LABEL: "What the Manager is doing",
  WAITING: "Waiting on you",
  AT_WORK: "Agents at work",
  OPEN_PULL_REQUESTS: "Open pull requests",
} as const;

/** The corner a Manager wears: the agent's, saying "Idle" where its turn ended as a turn should and the corner names no other end. */
function managerCorner(corner: CardCorner): CardCorner {
  return corner.kind === CARD_CORNER.ENDED && corner.state === undefined
    ? { ...corner, state: IDLE_WORDS }
    : corner;
}

/** How many of the Manager's threads wait on the reader now, as the Inbox counts them, from the account's feed, which holds every agent on no task's. */
function useWaitingOnReader(agentId: string, readerId: string | undefined): number {
  const now = useMinute();
  const items = useQuery(inboxItemsQuery()).data?.agents?.[agentId];

  return (items ?? []).filter((item) => waitsOnReaderNow(inboxRowOf(item), readerId, now)).length;
}

/** What the Manager's agents are doing: how many of them are at work, and how many pull requests they opened are still open. */
interface ManagerWork {
  readonly atWork: number;
  readonly openPullRequests: number;
}

/**
 * What the agents the Manager started are doing, its archived ones left
 * out, as the task list carries them: how many are at work, and how many
 * of the pull requests their rows name are open, a draft among them, as
 * its overview counts them (`manager-overview-model.ts`).
 */
function useManagerWork(agentId: string): ManagerWork {
  const { agents, agentPullRequests } = useTaskListCollections();

  const { data: started } = useLiveQuery((q) =>
    q
      .from({ agent: agents })
      .where(({ agent }) => and(eq(agent.startedByAgentId, agentId), isUndefined(agent.archivedAt)))
      .select(({ agent }) => ({ id: agent.id, status: agent.status })),
  );

  const { data: opened } = useLiveQuery((q) =>
    q
      .from({ listed: agentPullRequests })
      .select(({ listed }) => ({ agentId: listed.agentId, state: listed.pullRequest.state })),
  );

  const theirs = new Set((started ?? []).map((agent) => agent.id));

  return {
    atWork: (started ?? []).filter((agent) => agentAtWork(agent.status)).length,
    openPullRequests: (opened ?? []).filter(
      (each) => theirs.has(each.agentId) && pullRequestOpen(each.state),
    ).length,
  };
}

/** The card's counts, each said only where it is not none. */
function figuresOf(waiting: number, work: ManagerWork): readonly HoverCardFigure[] {
  return [
    { label: FIGURE_WORDS.WAITING, count: waiting },
    { label: FIGURE_WORDS.AT_WORK, count: work.atWork },
    { label: FIGURE_WORDS.OPEN_PULL_REQUESTS, count: work.openPullRequests },
  ].flatMap(({ label, count }) => (count === 0 ? [] : [{ label, figure: count }]));
}

/** A Manager's card; see the module's head. `subject` is the Manager as the place names it, its summary among it. */
export function ManagerCard({
  subject,
  agentId,
  models,
}: {
  subject: AgentSubject;
  agentId: string;
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const directory = useMemberDirectory();
  const reading = subject.read();
  const waiting = useWaitingOnReader(agentId, useMentionedReader() ?? directory.readerId);
  const figures = figuresOf(waiting, useManagerWork(agentId));

  // Note that a Manager its workspace shares says who started it, the reader among them, as a task's card says who created it.
  const shared = directory.members !== undefined && directory.members.length > 1;
  const startedBy = reading.startedBy ?? (shared ? subject.agent?.startedBy : undefined);

  return (
    <HoverCard data-agent-card="" data-manager-card="">
      <AgentCardHead
        name={subject.name}
        models={models}
        tile={reading.tile ?? subject.tile}
        choice={reading.choice}
        corner={managerCorner(reading.corner)}
      />
      <StartedBy
        by={startedBy}
        agentId={reading.startedByAgentId}
        automationId={reading.automationId}
        automationName={reading.automationName}
        at={reading.startedAt}
        models={models}
      />
      {figures.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardFigures label={FIGURE_WORDS.LABEL} figures={figures} />
        </>
      )}
    </HoverCard>
  );
}
