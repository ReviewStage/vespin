/**
 * merge-queue-page.tsx -- the Merge queue page: every pull request GitHub's merge queues hold across the listed workspace's repositories, each repository's line drawn front first.
 *
 * Each repository is a section of the page, as a task's Overview draws its
 * own: a section's head (`GROUP_LOOK.SECTION`) that names the repository as
 * the sidebar and the Tasks page do, its owner's picture and its name
 * (`repositoryLabel`), with how many it holds and a way to its queue on
 * GitHub (`OpenOnGitHubButton`), over its pull requests front first, each
 * one line as Home's and a person's page's rows stand (`home-row.ts`). A
 * row leads with where it stands in the queue, drawn with the glyphs the
 * Pull request tab already draws it with: waiting its turn, the queued
 * pull request's mark (`PullRequestMark`), as the sidebar's and the
 * composer's rows draw it; and once GitHub builds its merge group, the glyph
 * for how the group's checks stand (`CheckGlyph`), a running ring while it
 * is checked, a check once it merges next, a × once it fails. Its title is
 * its number and title as every pull request's row says them
 * (`pullRequestLabelOf`), and at its end stand how its checks stand in words,
 * who opened it, by their mark as every surface draws a GitHub account
 * (`ActorMark`), and when GitHub estimates it merges. The stage the glyph
 * draws is spoken to a reader, whom the glyph, decoration, tells nothing. A
 * row opens its pull request as the window opens a GitHub address
 * (`useOpenLink`): in its agent's Pull request tab where a listed task's
 * agent opened it, else on GitHub. The pull request the page was opened for,
 * from its Queued, is the row marked.
 *
 * The queues are read through the host as the page opens and again every
 * half minute while it stands, since GitHub tells the app nothing as a queue
 * moves; the rows follow each pull request by its address under one
 * `ListMotion`, so a front that merged leaves and the line glides up. A
 * read that fails once it has answered keeps what it held, and one that
 * fails with nothing held says so with its Try again, never as an empty
 * queue.
 */

import {
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type {
  MergeQueueAnswer,
  MergeQueueChecks,
  MergeQueueEntry,
  MergeQueueRepository,
} from "@repo/features/merge-queue-wire";
import {
  MERGE_QUEUE_STAGE,
  MERGE_QUEUE_STAGE_LABEL,
  type MergeQueueStage,
  mergeQueueStage,
} from "@repo/features/pull-request-model";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { repositoryLabel } from "@repo/features/task-list-model";
import { TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  AVATAR_SIZE,
  CheckGlyph,
  DetailPage,
  EmptyState,
  ErrorState,
  GAP,
  GROUP_ACTIONS,
  GROUP_LOOK,
  GroupHeader,
  ListMotion,
  PAGE_FRAME,
  ProgressCount,
  RepositoryPicture,
  Stack,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
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
import { type CSSProperties, useMemo, useRef } from "react";
import { askAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { failureShown } from "../failure-report.js";
import { MERGE_QUEUE_WORDS } from "../history-titles.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { OpenOnGitHubButton } from "../tasks/open-on-github-button.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { RowsSkeleton } from "./person-frame.js";

const WORDS = {
  READING: "Reading the merge queues…",
  EMPTY: "Nothing is queued.",
  UNREAD: "The merge queues could not be read.",
} as const;

/** How often the queues are read again while the page stands. */
const READ_EVERY = Duration.seconds(30);

/** How the merge group's checks stand at each stage once GitHub builds one, as the Pull request tab draws a check; none while the pull request waits its turn, which its queued mark says. */
const STAGE_CHECK = {
  [MERGE_QUEUE_STAGE.WAITING]: undefined,
  [MERGE_QUEUE_STAGE.CHECKING]: CHECK_STATE.PENDING,
  [MERGE_QUEUE_STAGE.MERGING]: CHECK_STATE.PASSED,
  [MERGE_QUEUE_STAGE.FAILING]: CHECK_STATE.FAILED,
} as const satisfies Record<MergeQueueStage, CheckState | undefined>;

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
    refetchInterval: Duration.toMillis(READ_EVERY),
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

/** How the queue's checks stand on a pull request: the first named failure and how many more failed, or how many failed where none is named, else how many passed; none before it reports any. */
function checksWords(checks: MergeQueueChecks | null | undefined): string | undefined {
  if (checks === null || checks === undefined) return undefined;

  const [first] = checks.failed;
  const more = checks.failedCount - 1;

  if (first !== undefined) return more > 0 ? `${first} failed +${more}` : `${first} failed`;

  if (checks.failedCount > 0) {
    return `${checks.failedCount} ${checks.failedCount === 1 ? "check" : "checks"} failed`;
  }

  return `${checks.passed} of ${checks.total} ${checks.total === 1 ? "check" : "checks"} passed`;
}

/** Where a pull request stands in the queue, as its row's status column draws it (`TaskRowGlyph`): its queued mark while it waits its turn, else the glyph for how its merge group's checks stand. */
function StageGlyph({
  stage,
  number,
}: {
  stage: MergeQueueStage;
  number: number;
}): React.JSX.Element {
  const check = STAGE_CHECK[stage];

  return (
    <TaskRowGlyph>
      {check === undefined ? (
        <PullRequestMark
          pullRequest={{
            number,
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.NONE,
            queued: true,
          }}
        />
      ) : (
        <CheckGlyph state={check} />
      )}
    </TaskRowGlyph>
  );
}

/** A pull request's number as its key column says it. */
function numberWords(number: number): string {
  return `#${number}`;
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
      {numberWords(number)}
    </Text>
  );
}

/** How the merge group's checks stand, as a task's row counts its sub-tasks (`ProgressCount`); none before GitHub reports any. */
function ChecksCount({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const { checks } = entry;
  const words = checksWords(checks);

  if (checks === null || checks === undefined || words === undefined) return null;

  return <ProgressCount done={checks.passed} total={checks.total} label={words} />;
}

/** What a reader hears after a row's name that the eye reads in its cells: its number, its stage, and who opened it. */
function RowSaid({ entry, author }: { entry: MergeQueueEntry; author: Actor }): React.JSX.Element {
  const stage = MERGE_QUEUE_STAGE_LABEL[mergeQueueStage(entry.state)];

  return (
    <VisuallyHidden>
      <ReplayMask>{`, #${entry.pullRequest.number}, ${stage}, ${actorName(author)}`}</ReplayMask>
    </VisuallyHidden>
  );
}

/** When GitHub estimates the pull request merges, counted down; nothing where it gives no estimate. */
function MergeEstimate({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const at = entry.estimatedMergeAt;

  return at === null || at === undefined ? null : <Time at={at} look={TIME_LOOK.UNTIL} />;
}

/**
 * The cells a pull request's row draws, in a task's row's order: its number
 * where a task's key stands, its stage where a task's status does, how its
 * merge group's checks stand where a task counts its sub-tasks, who opened
 * it where a task's creator stands, and when it should merge where a task's
 * time does, so its columns line up as the rows of a task's Overview, Home,
 * and a person's page do.
 */
const QUEUE_ROW_CELLS = [
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.CREATOR,
  TASK_ROW_CELL.UPDATED,
] as const satisfies readonly TaskRowCell[];

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
    // Note that the section is pulled out by a row's inset on each side, as a task's Overview's are, so its marks stand on the title's edge.
    <div className="merge-queue-repository -mx-row-inset">
      <GroupHeader
        look={GROUP_LOOK.SECTION}
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
        actionsShown={GROUP_ACTIONS.AT_REST}
        actions={<OpenOnGitHubButton url={queue.url} />}
      >
        <TaskRows
          label={queue.repository}
          cells={QUEUE_ROW_CELLS}
          more={false}
          edges={TASK_ROW_EDGES.UNCHOSEN}
          moves
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
                  [TASK_ROW_CELL.STATUS]: (
                    <StageGlyph
                      stage={mergeQueueStage(entry.state)}
                      number={entry.pullRequest.number}
                    />
                  ),
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
      </GroupHeader>
    </div>
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
        {WORDS.UNREAD}
      </ErrorState>
    );
  }

  if (repositories === undefined) return <RowsSkeleton label={WORDS.READING} />;

  if (repositories.length === 0) {
    return <EmptyState icon={<GLYPH.QUEUED />}>{WORDS.EMPTY}</EmptyState>;
  }

  return <Queues repositories={repositories} marked={marked} onOpen={onOpen} />;
}

/** Every repository's line, under one motion, so the line glides up as its front merges. */
function Queues({
  repositories,
  marked,
  onOpen,
}: {
  repositories: readonly MergeQueueRepository[];
  marked: string | undefined;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const root = useRef<HTMLElement>(null);
  const pictures = useRepositoryPictures();

  // Note that every repository's numbers stand as wide as the widest on the page, so the titles start on one edge from list to list.
  const fit = useMemo(
    () =>
      taskRowFit(
        repositories.flatMap((queue) =>
          queue.entries.map((entry) => ({ key: numberWords(entry.pullRequest.number) })),
        ),
      ),
    [repositories],
  );

  return (
    <ListMotion root={root} change={repositories}>
      <Stack ref={root} gap={GAP.BLOCK}>
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
    </ListMotion>
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
