/**
 * merge-queue-page.tsx -- the Merge queue page: every pull request GitHub's merge queues hold across the listed workspace's repositories, each repository's line drawn front first.
 *
 * Each repository stands on a card of its own, headed by GitHub's mark, its
 * name, how many it holds, and a way to its queue on GitHub, over its line
 * on a track (`TrackList`), front first, each node in its stage's tone, a
 * waiting one's hollow and a checking one's pulsing. Every row says who
 * opened the pull request, its title, its number, its task's name, and how
 * long it has been queued, and its stage at its end as words led by a dot
 * in its tone (`mergeQueueStage`). A
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
  CARD_LOOK,
  CARD_PADDING,
  Card,
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
  StatusWords,
  TIME_LOOK,
  Time,
  Tooltip,
  TRACK_NODE_LOOK,
  TrackList,
  type TrackNode,
  TrackRow,
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
  QUEUED: "queued",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/** Who GitHub names a deleted account's pull request as, whose disc keeps the row's title in line with the rest. */
const GHOST_LOGIN = "ghost";

/** How often the queues are read again while the page stands. */
const READ_EVERY = Duration.seconds(30);

/** The tone each stage is drawn in, its badge's, its node's, and its segment's; none for a pull request still waiting its turn, which stands at rest. */
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

/** A stage, as its words led by a dot in its tone. */
function StageWords({ stage }: { stage: MergeQueueStage }): React.JSX.Element {
  return (
    <StatusWords tone={STAGE_TONE[stage] ?? STATUS_TONE.NEUTRAL}>
      {MERGE_QUEUE_STAGE_LABEL[stage]}
    </StatusWords>
  );
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

/** What a row says under its title: its number, its task's name where it has one, and how long it has been queued. */
function RowFacts({ entry }: { entry: MergeQueueEntry }): React.JSX.Element {
  const number = `#${entry.pullRequest.number}`;

  return (
    <>
      {entry.task === null ? number : `${number} · ${entry.task.name}`}
      {" · "}
      <Time at={entry.enqueuedAt} look={TIME_LOOK.SINCE} />
    </>
  );
}

/** A pull request's node on the track, in its stage's tone: hollow while it waits, pulsing while its checks run. */
function nodeOf(stage: MergeQueueStage): TrackNode {
  return {
    tone: STAGE_TONE[stage],
    look: stage === MERGE_QUEUE_STAGE.WAITING ? TRACK_NODE_LOOK.HOLLOW : TRACK_NODE_LOOK.FILLED,
    pulse: stage === MERGE_QUEUE_STAGE.CHECKING,
  };
}

/** One repository's line: its head, the bar over it, its front on a card, and the rest on the track. */
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
    <Card look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.FLUSH}>
      <GroupHeader
        look={GROUP_LOOK.SECTION}
        glyph={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
        label={<ReplayMask>{queue.repository}</ReplayMask>}
        count={{ value: queue.entries.length, noun: WORDS.QUEUED }}
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
      />
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
            meta={<StageWords stage={mergeQueueStage(entry.state)} />}
            current={entry.pullRequest.url === marked ? LIST_ROW_CURRENT.ITEM : undefined}
            linkHref={entry.pullRequest.url}
            onPress={() => onOpen(entry.pullRequest.url)}
          />
        ))}
      </TrackList>
    </Card>
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

/** Every repository's line, under one motion, so a pull request glides from the track onto the front's card as the one before it merges. */
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
