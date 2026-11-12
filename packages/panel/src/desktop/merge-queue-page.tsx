/**
 * merge-queue-page.tsx -- the Merge queue page: every pull request GitHub's merge queues hold across the listed workspace's repositories, one card of rows per repository.
 *
 * Each repository stands under a head naming it and counting its entries,
 * over a card whose rows say, front first, who opened each pull request, its
 * title, its number, and its stage (`mergeQueueStage`) as a badge. A row
 * opens its pull request as the window opens a GitHub address
 * (`useOpenLink`): in its agent's Pull request tab where a listed task's
 * agent opened it, else on GitHub. The pull request the page was opened for,
 * from its Queued, is the row marked.
 *
 * The queues are read through the host as the page opens and again every
 * half minute while it stands, since GitHub tells the app nothing as a queue
 * moves; a read that fails once it has answered keeps what it held, and one
 * that fails with nothing held says so with its Try again, never as an empty
 * queue.
 */

import type {
  MergeQueueAnswer,
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
  Badge,
  DetailPage,
  EmptyState,
  ErrorState,
  GROUP_LOOK,
  GroupHeader,
  LIST_ROW_CURRENT,
  LIST_VARIANT,
  List,
  ListRow,
  PAGE_FRAME,
  STATUS_TONE,
  type StatusTone,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { askAct } from "../act.js";
import { failureShown } from "../failure-report.js";
import { MERGE_QUEUE_WORDS } from "../history-titles.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { RowsSkeleton } from "./person-frame.js";

const WORDS = {
  READING: "Reading the merge queues…",
  EMPTY: "Nothing is queued.",
  UNREAD: "The merge queues could not be read.",
  QUEUED: "queued",
} as const;

/** Who GitHub names a deleted account's pull request as, whose disc keeps the row's title in line with the rest. */
const GHOST_LOGIN = "ghost";

/** How often the queues are read again while the page stands. */
const READ_EVERY = Duration.seconds(30);

/** The tone each stage's badge is drawn in. */
const STAGE_TONE = {
  [MERGE_QUEUE_STAGE.WAITING]: STATUS_TONE.NEUTRAL,
  [MERGE_QUEUE_STAGE.CHECKING]: STATUS_TONE.WORKING,
  [MERGE_QUEUE_STAGE.MERGING]: STATUS_TONE.MERGED,
  [MERGE_QUEUE_STAGE.FAILING]: STATUS_TONE.DANGER,
} as const satisfies Record<MergeQueueStage, StatusTone>;

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

/** One pull request in a queue: who opened it, its title, its number, and its stage. */
function EntryRow({
  entry,
  marked,
  onOpen,
}: {
  entry: MergeQueueEntry;
  marked: boolean;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const { pullRequest } = entry;
  const { author } = pullRequest;
  const stage = mergeQueueStage(entry.state);

  return (
    <ListRow
      leading={
        <Avatar
          name={author?.login ?? GHOST_LOGIN}
          src={author?.avatarUrl}
          size={AVATAR_SIZE.ROW}
          decorative
        />
      }
      title={pullRequest.title}
      titleReplayMasked
      description={`#${pullRequest.number}`}
      meta={<Badge tone={STAGE_TONE[stage]}>{MERGE_QUEUE_STAGE_LABEL[stage]}</Badge>}
      current={marked ? LIST_ROW_CURRENT.ITEM : undefined}
      linkHref={pullRequest.url}
      onPress={() => onOpen(pullRequest.url)}
    />
  );
}

/** One repository's queue: its head, naming and counting it, over a card of its entries. */
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
    <section aria-label={queue.repository}>
      <GroupHeader
        look={GROUP_LOOK.SECTION}
        label={<ReplayMask>{queue.repository}</ReplayMask>}
        count={{ value: queue.entries.length, noun: WORDS.QUEUED }}
      />
      <List label={queue.repository} variant={LIST_VARIANT.CARD}>
        {queue.entries.map((entry) => (
          <EntryRow
            key={entry.pullRequest.url}
            entry={entry}
            marked={entry.pullRequest.url === marked}
            onOpen={onOpen}
          />
        ))}
      </List>
    </section>
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

  return (
    <>
      {repositories.map((queue) => (
        <RepositoryQueue key={queue.repository} queue={queue} marked={marked} onOpen={onOpen} />
      ))}
    </>
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
