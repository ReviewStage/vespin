/**
 * manager-card.tsx -- the card a Manager hangs wherever it is named, its sidebar row, a mention's chip, or a line it sent: who it is, who started it, where it stands, what waits on the reader, and where it works.
 *
 * It is an agent's card (`agent-tab-card.tsx`) in its head and its first
 * row, so a Manager reads as one of the family a task's, an agent's, and a
 * person's cards make: its face at a card's size, livelier while it works,
 * its name, the model it runs on under it, and its corner, the run's count
 * while it works and else how long ago it last moved, after "Idle" where its
 * turn ended as a turn should, since a Manager at rest waits on its chat; then
 * who started it, as a task's card says who created it, where others share
 * its workspace or a teammate did. Under a rule, a receipt of the two counts
 * a Manager is for (`HoverCardFigures`): how many of its threads wait on the
 * reader now, as the Inbox counts them (`waitsOnReaderNow`), and how many
 * of the agents it started are at work, each said only where it is not
 * none. Under another, its repositories, one row each, its owner's picture
 * before it, as the repositories chip's card lists them.
 *
 * Everything is read from what the window already holds: the task list's
 * agents, followed live, the account's Inbox feed, which holds the threads
 * of every agent on no task, and the Manager's own read by its id, which
 * its page already holds and which names every repository it works in,
 * read once, since those are fixed as it is made. Until that read answers,
 * the card names the repository its row carries. Its latest step is no part
 * of it: the window holds a Manager's transcript only while its page is open.
 */

import { inboxRowOf } from "@repo/features/inbox-digest";
import { waitsOnReaderNow } from "@repo/features/inbox-list-model";
import { agentAtWork } from "@repo/features/manager-overview-model";
import type { CatalogModel } from "@repo/features/models-wire";
import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  type HoverCardFigure,
  HoverCardFigures,
  HoverCardList,
  HoverCardRow,
  HoverCardRule,
  RepositoryPicture,
  useMinute,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { and, eq, isUndefined, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { inboxItemsQuery } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useTaskListCollections, useTaskListRowAs } from "../task-list-collections.js";
import { agentPageQueryOptions } from "./agent-reads.js";
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
} as const;

/** What the card's repositories are named for a reader. */
const REPOSITORIES_WORDS = "Repositories";

/** No repository, the same array every render. */
const NO_REPOSITORIES: readonly string[] = [];

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

/** How many of the agents the Manager started are at work, its archived ones left out, as the task list carries them. */
function useAgentsAtWork(agentId: string): number {
  const { agents } = useTaskListCollections();

  const { data } = useLiveQuery((q) =>
    q
      .from({ agent: agents })
      .where(({ agent }) => and(eq(agent.startedByAgentId, agentId), isUndefined(agent.archivedAt)))
      .select(({ agent }) => ({ id: agent.id, status: agent.status })),
  );

  return (data ?? []).filter((agent) => agentAtWork(agent.status)).length;
}

/** Every repository the Manager works in, its checkout first: as its own read by id names them, or the one its row carries until that read answers, or where it refuses. */
function useManagerRepositories(agentId: string): readonly string[] {
  const listed = useTaskListRowAs(
    useTaskListCollections().agents,
    agentId,
    (row) => row?.repository,
  );

  // Note that a Manager's repositories are fixed as it is made, so its read is never taken again once it answered.
  const answer = useQuery({
    ...agentPageQueryOptions(agentId),
    staleTime: Number.POSITIVE_INFINITY,
  }).data;

  const page = answer === undefined || "failure" in answer ? undefined : answer.agent;

  if (page?.repositories !== undefined) return page.repositories;

  const checkout = page === undefined ? listed : page.repository;

  return checkout === null || checkout === undefined ? NO_REPOSITORIES : [checkout];
}

/** The card's counts, each said only where it is not none. */
function figuresOf(waiting: number, atWork: number): readonly HoverCardFigure[] {
  return [
    { label: FIGURE_WORDS.WAITING, count: waiting },
    { label: FIGURE_WORDS.AT_WORK, count: atWork },
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
  const pictures = useRepositoryPictures();
  const waiting = useWaitingOnReader(agentId, useMentionedReader() ?? directory.readerId);
  const atWork = useAgentsAtWork(agentId);
  const repositories = useManagerRepositories(agentId);
  const figures = figuresOf(waiting, atWork);

  // Note that a Manager its workspace shares says who started it, the reader among them, as a task's card says who created it.
  const shared = directory.members !== undefined && directory.members.length > 1;
  const startedBy = reading.startedBy ?? (shared ? subject.agent?.startedBy : undefined);

  const lists = [
    figures.length === 0 ? null : (
      <HoverCardFigures key="figures" label={FIGURE_WORDS.LABEL} figures={figures} />
    ),
    repositories.length === 0 ? null : (
      <HoverCardList key="repositories" label={REPOSITORIES_WORDS}>
        {repositories.map((repository) => (
          <li key={repository}>
            <HoverCardRow
              look={HOVER_CARD_ROW_LOOK.LINE}
              glyph={<RepositoryPicture repository={repository} pictures={pictures} />}
              label={<ReplayMask>{repository}</ReplayMask>}
            />
          </li>
        ))}
      </HoverCardList>
    ),
  ].filter((list) => list !== null);

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
      {lists.map((list) => (
        <Fragment key={list.key}>
          <HoverCardRule />
          {list}
        </Fragment>
      ))}
    </HoverCard>
  );
}
