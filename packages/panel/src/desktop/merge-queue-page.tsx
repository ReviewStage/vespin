/**
 * merge-queue-page.tsx -- the Merge queue page: every pull request GitHub's merge queues hold across the listed workspace's repositories, each repository's line drawn front first.
 *
 * Each repository is a section of the page, as a task's Overview draws its
 * own: a section's head (`GROUP_LOOK.SECTION`) that names the repository as
 * the sidebar and the Tasks page do, its owner's picture and its name
 * (`repositoryLabel`), with how many it holds and a way to its queue on
 * GitHub (`OpenOnGitHubButton`), over its pull requests front first, each
 * a `TaskRow` in a `TaskRows`, as a task's sub-tasks and agents, Home's
 * Recent, and a person's page stand theirs, so its columns line up down the
 * list; and every list takes one fit read from the whole page
 * (`taskRowFit`), so they line up from list to list too. A row draws what
 * the Pull request tab already draws: its number where a task's key stands;
 * the queued pull request's mark where a task's status does
 * (`PullRequestMark`), as the sidebar's and the composer's rows draw it; its
 * title; how its merge group's checks stand, counted as its Checks tab
 * counts them (`checksCount`), a red × and how many failed, the ring every
 * wait turns and how many still run, or a green check and how many passed;
 * who opened it, by their mark as every surface draws a GitHub account
 * (`ActorMark`); and when GitHub estimates it merges. Its stage, its checks
 * in words, and its author are spoken to a reader after its name. A
 * row opens its pull request as the window opens a GitHub address
 * (`useOpenLink`): in its Pull request tab where a listed task's
 * lines name it, else on GitHub. The pull request the page was opened for,
 * from its Queued, is the row marked.
 *
 * The queues are read through the host as the page opens and again every
 * half minute while it stands, since GitHub tells the app nothing as a queue
 * moves; a front that merged leaves at once and the line closes up. A
 * read that fails once it has answered keeps what it held, and one that
 * fails with nothing held says so with its Try again, never as an empty
 * queue.
 */

import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  MERGE_QUEUE_PAGE_WORDS,
  MERGE_QUEUE_READ_EVERY,
  mergeQueueChecksStanding,
  mergeQueueHeard,
  mergeQueueNumberWords,
} from "@repo/features/merge-queue-model";
import type {
  MergeQueueAnswer,
  MergeQueueEntry,
  MergeQueueRepository,
} from "@repo/features/merge-queue-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { repositoryLabel } from "@repo/features/task-list-model";
import { TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  AVATAR_SIZE,
  CountParts,
  checksCount,
  DetailPage,
  EmptyState,
  ErrorState,
  GAP,
  PAGE_FRAME,
  RepositoryPicture,
  Stack,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  TaskRowGlyph,
  TaskRows,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  taskRowFit,
  VisuallyHidden,
} from "@repo/ui";
import {
  type Actor,
  actorName,
  DELETED_ACCOUNT_ACTOR,
  githubLoginActor,
} from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { type CSSProperties, useMemo } from "react";
import { askAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { failureShown } from "../failure-report.js";
import { MERGE_QUEUE_WORDS } from "../history-titles.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { OpenOnGitHubButton } from "../tasks/open-on-github-button.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { MergeQueueSection, MergeQueueSkeleton, QUEUE_ROW_CELLS } from "./merge-queue-frame.js";

/** The workspace's queues, read as the page opens and every half minute while it stands. */
function mergeQueueQuery(workspaceId: string | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.MERGE_QUEUE, workspaceId],
    queryFn: () =>
      workspaceId === undefined
        ? Promise.reject(new Error("No workspace is listed."))
        : askAct(ACT_KIND.WORKSPACE_MERGE_QUEUE_READ, { workspaceId }),
    enabled: workspaceId !== undefined,
    refetchOnMount: "always",
    refetchInterval: Duration.toMillis(MERGE_QUEUE_READ_EVERY),
    retry: false,
  });
}

/** Who opened the pull request, as every surface draws a GitHub account: a person's circle, an App's bot's square, or a deleted account's mark. */
function authorActor(entry: MergeQueueEntry): Actor {
  const { author } = entry.pullRequest;

  return author === null
    ? DELETED_ACCOUNT_ACTOR
    : { ...githubLoginActor(author.login), avatarUrl: author.avatarUrl };
}

/** A queued pull request's mark in its row's status column (`TaskRowGlyph`), as the sidebar's and the composer's rows draw one the merge queue holds. */
function QueuedMark({ number }: { number: number }): React.JSX.Element {
  return (
    <TaskRowGlyph>
      <PullRequestMark
        pullRequest={{
          number,
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.NONE,
          queued: true,
        }}
      />
    </TaskRowGlyph>
  );
}

/** A pull request's number in its row's key column, as a task's key stands there. */
function PullRequestKey({ number }: { number: number }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
      aria-hidden
    >
      {mergeQueueNumberWords(number)}
    </Text>
  );
}

/**
 * How the merge group's checks stand, counted as a pull request's Checks tab
 * counts them (`checksCount`): those that failed, in the danger ink by their
 * ×; else those still running, by the ring every wait turns; else all of
 * them, in the complete ink by their check; by its stage's glyph alone where
 * GitHub has counted none yet, and nothing while it waits its turn.
 */
function ChecksCount({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const { summary, count } = mergeQueueChecksStanding(entry);
  const counted = checksCount(summary, count);

  return counted === undefined ? null : <CountParts parts={counted} />;
}

/** What a reader hears after a row's name that the eye reads in its cells: its number, its stage, how its checks stand, and who opened it. */
function RowSaid({ entry, author }: { entry: MergeQueueEntry; author: Actor }): React.JSX.Element {
  return (
    <VisuallyHidden>
      <ReplayMask>{`, ${mergeQueueHeard(entry, actorName(author)).join(", ")}`}</ReplayMask>
    </VisuallyHidden>
  );
}

/** When GitHub estimates the pull request merges, counted down; nothing where it gives no estimate. */
function MergeEstimate({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const at = entry.estimatedMergeAt;

  return at === null || at === undefined ? null : <Time at={at} look={TIME_LOOK.UNTIL} />;
}

/** One repository's line: its section's head over its pull requests, front first. */
function RepositoryQueue({
  queue,
  label,
  pictures,
  fit,
  marked,
  onOpen,
}: {
  queue: MergeQueueRepository;
  /** The words the page says for the repository (`repositoryLabel`). */
  label: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  /** How wide the number column stands, the widest on the page (`taskRowFit`). */
  fit: CSSProperties;
  marked: string | undefined;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const count = queue.entries.length;

  return (
    <MergeQueueSection
      glyph={
        <RepositoryPicture
          repository={queue.repository}
          pictures={pictures}
          size={AVATAR_SIZE.GLYPH}
        />
      }
      label={<ReplayMask>{label}</ReplayMask>}
      tooltip={label === queue.repository ? undefined : queue.repository}
      count={{
        value: count,
        noun: count === 1 ? TERM.PULL_REQUEST.one : TERM.PULL_REQUEST.many,
      }}
      actions={<OpenOnGitHubButton url={queue.url} />}
    >
      <TaskRows
        label={queue.repository}
        cells={QUEUE_ROW_CELLS}
        more={false}
        edges={TASK_ROW_EDGES.UNCHOSEN}
        fit={fit}
      >
        {queue.entries.map((entry) => {
          const author = authorActor(entry);

          return (
            <TaskRow
              key={entry.pullRequest.url}
              taskId={entry.pullRequest.url}
              name={entry.pullRequest.title}
              said={<RowSaid entry={entry} author={author} />}
              cells={QUEUE_ROW_CELLS}
              content={{
                [TASK_ROW_CELL.KEY]: <PullRequestKey number={entry.pullRequest.number} />,
                [TASK_ROW_CELL.STATUS]: <QueuedMark number={entry.pullRequest.number} />,
                [TASK_ROW_CELL.SUB_TASKS]: <ChecksCount entry={entry} />,
                [TASK_ROW_CELL.CREATOR]: <ActorMark actor={author} size={ACTOR_SIZE.INLINE} />,
                [TASK_ROW_CELL.UPDATED]: <MergeEstimate entry={entry} />,
              }}
              more={false}
              edges={TASK_ROW_EDGES.UNCHOSEN}
              current={entry.pullRequest.url === marked}
              onOpen={() => onOpen(entry.pullRequest.url)}
            />
          );
        })}
      </TaskRows>
    </MergeQueueSection>
  );
}

/** What stands under the title: the read in progress, a failure with nothing held, none queued, or the queues. */
function QueuesRead({
  read,
  marked,
  onOpen,
}: {
  read: UseQueryResult<MergeQueueAnswer>;
  marked: string | undefined;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const repositories = read.data?.repositories;

  if (repositories === undefined && read.isError) {
    return (
      <ErrorState
        failure={failureShown({ surface: FAILURE_SURFACE.MERGE_QUEUE_READ, cause: read.error })}
        onRetry={() => void read.refetch()}
      >
        {MERGE_QUEUE_PAGE_WORDS.UNREAD}
      </ErrorState>
    );
  }

  if (repositories === undefined) return <MergeQueueSkeleton />;

  if (repositories.length === 0) {
    return <EmptyState icon={<GLYPH.QUEUED />}>{MERGE_QUEUE_PAGE_WORDS.EMPTY}</EmptyState>;
  }

  return <Queues repositories={repositories} marked={marked} onOpen={onOpen} />;
}

/** Every repository's line. */
function Queues({
  repositories,
  marked,
  onOpen,
}: {
  repositories: readonly MergeQueueRepository[];
  marked: string | undefined;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const pictures = useRepositoryPictures();

  // Note that every repository's numbers stand as wide as the widest on the page, so the titles start on one edge from list to list.
  const fit = useMemo(
    () =>
      taskRowFit(
        repositories.flatMap((queue) =>
          queue.entries.map((entry) => ({ key: mergeQueueNumberWords(entry.pullRequest.number) })),
        ),
      ),
    [repositories],
  );

  return (
    <Stack gap={GAP.BLOCK}>
      {repositories.map((queue) => (
        <RepositoryQueue
          key={queue.repository}
          queue={queue}
          label={repositoryLabel(queue.repository, repositories)}
          pictures={pictures}
          fit={fit}
          marked={marked}
          onOpen={onOpen}
        />
      ))}
    </Stack>
  );
}

/** The Merge queue page of the workspace `workspaceId` names, the row of the pull request at `marked` marked. */
export function MergeQueuePage({
  workspaceId,
  marked,
}: {
  workspaceId: string | undefined;
  marked: string | undefined;
}): React.JSX.Element {
  const read = useQuery(mergeQueueQuery(workspaceId));
  const openLink = useOpenLink();

  return (
    <ReplayUnmask>
      <DetailPage frame={PAGE_FRAME.PAGE} title={MERGE_QUEUE_WORDS}>
        <QueuesRead read={read} marked={marked} onOpen={openLink} />
      </DetailPage>
    </ReplayUnmask>
  );
}
