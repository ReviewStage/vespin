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
  GLYPH_INK,
  GlyphSlot,
  GROUP_ACTIONS,
  GROUP_LOOK,
  GroupHeader,
  LIST_ROW_CURRENT,
  List,
  ListMotion,
  ListRow,
  PAGE_FRAME,
  RepositoryPicture,
  Stack,
  TIME_LOOK,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import {
  type Actor,
  actorName,
  DELETED_ACCOUNT_ACTOR,
  githubLoginActor,
} from "@repo/ui/actor-model";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { useRef } from "react";
import { askAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { failureShown } from "../failure-report.js";
import { MERGE_QUEUE_WORDS } from "../history-titles.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { HOME_ROW_CONTEXT, HOME_ROW_META } from "../tasks/home-row.js";
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

/** Where a pull request stands in the queue, as its row leads with it: its queued mark while it waits its turn, else the glyph for how its merge group's checks stand; either in a glyph's slot, so every row's title starts on one edge. */
function StageGlyph({
  stage,
  number,
}: {
  stage: MergeQueueStage;
  number: number;
}): React.JSX.Element {
  const check = STAGE_CHECK[stage];

  return (
    <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.MEDIUM}>
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
    </GlyphSlot>
  );
}

/** When GitHub estimates the pull request merges, counted down; nothing where it gives no estimate. */
function MergeEstimate({ entry }: { entry: MergeQueueEntry }): React.JSX.Element | null {
  const at = entry.estimatedMergeAt;

  return at === null || at === undefined ? null : <Time at={at} look={TIME_LOOK.UNTIL} />;
}

/** What a row says at its end: its stage, spoken only, how its checks stand where it has any, who opened it, by their mark and to a reader by their name, and when GitHub estimates it merges. */
function RowMeta({ entry }: { entry: MergeQueueEntry }): React.JSX.Element {
  const checks = checksWords(entry.checks);
  const author = authorActor(entry);

  return (
    <span className={HOME_ROW_META}>
      <VisuallyHidden>{`${MERGE_QUEUE_STAGE_LABEL[mergeQueueStage(entry.state)]}, `}</VisuallyHidden>
      {checks === undefined ? null : (
        <span className={HOME_ROW_CONTEXT}>
          <ReplayMask>{checks}</ReplayMask>
        </span>
      )}
      <ActorMark actor={author} size={ACTOR_SIZE.INLINE} />
      <VisuallyHidden>
        <ReplayMask>{`, ${actorName(author)}, `}</ReplayMask>
      </VisuallyHidden>
      <MergeEstimate entry={entry} />
    </span>
  );
}

/** One repository's line: its section's head over its pull requests, front first. */
function RepositoryQueue({
  queue,
  label,
  pictures,
  marked,
  onOpen,
}: {
  queue: MergeQueueRepository;
  /** The words the page says for the repository (`repositoryLabel`). */
  label: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
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
        <List label={queue.repository} moves>
          {queue.entries.map((entry) => (
            <ListRow
              key={entry.pullRequest.url}
              motionKey={entry.pullRequest.url}
              leading={
                <StageGlyph
                  stage={mergeQueueStage(entry.state)}
                  number={entry.pullRequest.number}
                />
              }
              title={pullRequestLabelOf(entry.pullRequest)}
              titleReplayMasked
              meta={<RowMeta entry={entry} />}
              current={entry.pullRequest.url === marked ? LIST_ROW_CURRENT.ITEM : undefined}
              linkHref={entry.pullRequest.url}
              onPress={() => onOpen(entry.pullRequest.url)}
            />
          ))}
        </List>
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

  return (
    <ListMotion root={root} change={repositories}>
      <Stack ref={root} gap={GAP.BLOCK}>
        {repositories.map((queue) => (
          <RepositoryQueue
            key={queue.repository}
            queue={queue}
            label={repositoryLabel(queue.repository, repositories)}
            pictures={pictures}
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
