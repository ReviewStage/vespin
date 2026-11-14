/**
 * merge-queue-page.tsx -- the Merge queue page: every pull request GitHub's merge queues hold across the listed workspace's repositories, each repository's line drawn front first.
 *
 * Each repository is a section of the page, as a task's Overview draws its
 * own: a section's head (`GROUP_LOOK.SECTION`) with GitHub's mark, its name,
 * and a way to its queue on GitHub, over its line on a track (`TrackList`),
 * front first, each node in its stage's tone (`mergeQueueStage`), a waiting
 * one's hollow. Every spot in a row holds one kind of thing or nothing, so
 * no row says a thing twice: who opened the pull request, its title, under
 * it its number and how the queue's checks stand on it (how many passed, or
 * which failed), and at its end when GitHub estimates it merges. The stage
 * is drawn by the node alone, and spoken before the number for a reader the
 * node, which is decoration, says nothing to. A
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
import { ACT_KIND } from "@repo/host/acts";
import {
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  DetailPage,
  EmptyState,
  ErrorState,
  GAP,
  GROUP_ACTIONS,
  GROUP_LOOK,
  GroupHeader,
  IconButtonLink,
  LIST_ROW_CURRENT,
  ListMotion,
  MARK_PROVIDER,
  PAGE_FRAME,
  ProviderMark,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TIME_LOOK,
  Time,
  Tooltip,
  TRACK_NODE_LOOK,
  TrackList,
  type TrackNode,
  TrackRow,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { useRef } from "react";
import { askAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { failureShown } from "../failure-report.js";
import { MERGE_QUEUE_WORDS } from "../history-titles.js";
import { QUERY_ROOT } from "../query-keys.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { RowsSkeleton } from "./person-frame.js";

const WORDS = {
  READING: "Reading the merge queues…",
  EMPTY: "Nothing is queued.",
  UNREAD: "The merge queues could not be read.",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/** Who GitHub names a deleted account's pull request as, whose disc keeps the row's title in line with the rest. */
const GHOST_LOGIN = "ghost";

/** How often the queues are read again while the page stands. */
const READ_EVERY = Duration.seconds(30);

/** The tone each stage's node is drawn in; none for a pull request still waiting its turn, which stands at rest. */
const STAGE_TONE = {
  [MERGE_QUEUE_STAGE.WAITING]: undefined,
  [MERGE_QUEUE_STAGE.CHECKING]: STATUS_TONE.WORKING,
  [MERGE_QUEUE_STAGE.MERGING]: STATUS_TONE.MERGED,
  [MERGE_QUEUE_STAGE.FAILING]: STATUS_TONE.DANGER,
} as const satisfies Record<MergeQueueStage, StatusTone | undefined>;

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

/** Who opened the pull request, at `size`, GitHub's ghost for a deleted account. */
function AuthorFace({
  entry,
  size,
}: {
  entry: MergeQueueEntry;
  size: AvatarSize;
}): React.JSX.Element {
  const { author } = entry.pullRequest;

  return (
    <Avatar name={author?.login ?? GHOST_LOGIN} src={author?.avatarUrl} size={size} decorative />
  );
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

/** What a row says under its title: its stage, spoken only, its number, and how its checks stand where it has any. */
function RowFacts({ entry }: { entry: MergeQueueEntry }): React.JSX.Element {
  const checks = checksWords(entry.checks);

  return (
    <>
      <VisuallyHidden>{`${MERGE_QUEUE_STAGE_LABEL[mergeQueueStage(entry.state)]}, `}</VisuallyHidden>
      {`#${entry.pullRequest.number}`}
      {checks === undefined ? null : ` · ${checks}`}
    </>
  );
}

/** When GitHub estimates the pull request merges, counted down; nothing where it gives no estimate. */
function MergeEstimate({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const at = entry.estimatedMergeAt;

  return at === null || at === undefined ? null : <Time at={at} look={TIME_LOOK.UNTIL} />;
}

/** A pull request's node on the track, in its stage's tone: hollow while it waits. */
function nodeOf(stage: MergeQueueStage): TrackNode {
  return {
    tone: STAGE_TONE[stage],
    look: stage === MERGE_QUEUE_STAGE.WAITING ? TRACK_NODE_LOOK.HOLLOW : TRACK_NODE_LOOK.FILLED,
  };
}

/** One repository's line: its section's head over its pull requests on the track, front first. */
function RepositoryQueue({
  queue,
  marked,
  onOpen,
}: {
  queue: MergeQueueRepository;
  marked: string | undefined;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  return (
    // Note that the section is pulled out by a row's inset on each side, as a task's Overview's are, so its marks stand on the title's edge.
    <div className="-mx-row-inset">
      <GroupHeader
        look={GROUP_LOOK.SECTION}
        glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
        label={<ReplayMask>{queue.repository}</ReplayMask>}
        actionsShown={GROUP_ACTIONS.AT_REST}
        actions={
          <Tooltip label={WORDS.OPEN_ON_GITHUB}>
            <IconButtonLink
              icon={<GLYPH.OPEN_EXTERNALLY />}
              label={WORDS.OPEN_ON_GITHUB}
              href={queue.url}
              newTab
              onClick={linkPressOf((href) => appPlatform().openGitHub(href), queue.url)}
            />
          </Tooltip>
        }
      >
        <TrackList label={queue.repository} moves>
          {queue.entries.map((entry) => (
            <TrackRow
              key={entry.pullRequest.url}
              motionKey={entry.pullRequest.url}
              node={nodeOf(mergeQueueStage(entry.state))}
              leading={<AuthorFace entry={entry} size={AVATAR_SIZE.ROW} />}
              title={entry.pullRequest.title}
              titleReplayMasked
              description={<RowFacts entry={entry} />}
              descriptionReplayMasked
              meta={<MergeEstimate entry={entry} />}
              current={entry.pullRequest.url === marked ? LIST_ROW_CURRENT.ITEM : undefined}
              linkHref={entry.pullRequest.url}
              onPress={() => onOpen(entry.pullRequest.url)}
            />
          ))}
        </TrackList>
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

  return (
    <ListMotion root={root} change={repositories}>
      <Stack ref={root} gap={GAP.BLOCK}>
        {repositories.map((queue) => (
          <RepositoryQueue key={queue.repository} queue={queue} marked={marked} onOpen={onOpen} />
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
