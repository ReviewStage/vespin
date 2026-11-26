// merge-queue-screens.tsx -- the Merge queue screen: every pull request GitHub's merge queues hold across the workspace's repositories, each repository's line front first, as the panel's Merge queue page draws them.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { isBotLogin } from "@repo/features/github-login";
import {
  MERGE_QUEUE_PAGE_WORDS,
  MERGE_QUEUE_READ_EVERY,
  mergeQueueChecksStanding,
  mergeQueueHeard,
} from "@repo/features/merge-queue-model";
import type { MergeQueueEntry, MergeQueueRepository } from "@repo/features/merge-queue-wire";
import { repositoryLabel } from "@repo/features/task-list-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  EmptyState,
  FACE_KIND,
  GLYPH,
  LIST_LOOK,
  ListSection,
  type LongPressGroup,
  MergeQueueRow,
  ROW_ACTION_TONE,
  RowList,
  Screen,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { Stack, useLocalSearchParams } from "expo-router";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useKeeping } from "../keeping.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useSurfaceOpen } from "../surface-open.js";

/** Where the screen's read is kept among the app's queries. */
const QUERY_ROOT = { MERGE_QUEUE: "merge-queue" } as const;

/** What a row's and a section's menus offer, in the panel's words. */
const MENU_WORDS = {
  COPY_GITHUB_LINK: "Copy GitHub link",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/** Who opened a pull request where GitHub names no account, as the panel says a deleted one. */
const DELETED_ACCOUNT = "Deleted account";

/** A GitHub address's Open on GitHub and Copy GitHub link, as one group of a menu. */
function gitHubActs(url: string, copy: (words: string) => void): LongPressGroup {
  return [
    {
      label: MENU_WORDS.OPEN_ON_GITHUB,
      symbol: GLYPH.OPEN_EXTERNALLY,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => openInSafari(url),
    },
    {
      label: MENU_WORDS.COPY_GITHUB_LINK,
      symbol: GLYPH.LINK,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => copy(url),
    },
  ];
}

/** Who opened the pull request, by their face: an App's bot's square or a person's letter, their picture where GitHub gives one; none for a deleted account. */
function authorFace(entry: MergeQueueEntry) {
  const { author } = entry.pullRequest;

  if (author === null) return undefined;

  return {
    name: author.login,
    picture: author.avatarUrl === "" ? undefined : author.avatarUrl,
    kind: isBotLogin(author.login) ? FACE_KIND.APP : FACE_KIND.PERSON,
  };
}

/** One repository's line: its section, headed by its owner's picture, its label, and how many it holds, over its pull requests front first. */
function RepositoryQueue({
  queue,
  label,
  copy,
}: {
  readonly queue: MergeQueueRepository;
  readonly label: string;
  readonly copy: (words: string) => void;
}) {
  const count = queue.entries.length;

  return (
    <ListSection
      title={label}
      count={count}
      repository={queue.repository}
      act={{
        label: MENU_WORDS.OPEN_ON_GITHUB,
        heard: `${MENU_WORDS.OPEN_ON_GITHUB}, ${label}`,
        onPress: () => openInSafari(queue.url),
      }}
      menu={[gitHubActs(queue.url, copy)]}
    >
      {queue.entries.map((entry) => {
        const author = authorFace(entry);

        return (
          <MergeQueueRow
            key={entry.pullRequest.url}
            id={entry.pullRequest.url}
            number={entry.pullRequest.number}
            title={entry.pullRequest.title}
            checks={mergeQueueChecksStanding(entry)}
            author={author}
            estimatedMergeAt={entry.estimatedMergeAt ?? undefined}
            heard={mergeQueueHeard(entry, author?.name ?? DELETED_ACCOUNT)}
            menu={[gitHubActs(entry.pullRequest.url, copy)]}
          />
        );
      })}
    </ListSection>
  );
}

/**
 * The Merge queue screen of the workspace the phone works in, the pull
 * request at `?pr=` marked. The queues are read through the host as the
 * screen opens, every half minute while it stands, since GitHub tells the
 * app nothing as a queue moves, and on a pull; a read that fails once it
 * has answered keeps what it held, and one that fails with nothing held says
 * so with its Try again, never as an empty queue. A row opens its pull
 * request's own screen (`useOpenLink`), and its long press, as a section's
 * header, opens it on GitHub or copies its link.
 */
export function MergeQueueScreen() {
  const { pr } = useLocalSearchParams<{ pr?: string }>();
  const acts = useHostActs();
  const keeping = useKeeping();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const workspaceId = useChosenWorkspace(workspaces).chosen?.id;
  const openLink = useOpenLink(workspaceId);
  useSurfaceOpen(PRODUCT_SURFACE.MERGE_QUEUE);

  const read = useQuery({
    queryKey: [QUERY_ROOT.MERGE_QUEUE, workspaceId],
    queryFn: async () => {
      if (workspaceId === undefined) throw new Error("No workspace is chosen.");

      return await acts[ACT_KIND.WORKSPACE_MERGE_QUEUE_READ]({ workspaceId });
    },
    enabled: workspaceId !== undefined,
    refetchOnMount: "always",
    refetchInterval: Duration.toMillis(MERGE_QUEUE_READ_EVERY),
    retry: false,
  });

  const repositories = read.data?.repositories;
  const refresh = () => read.refetch().then(() => undefined);

  const empty =
    repositories === undefined && read.isError ? (
      <EmptyState
        title={MERGE_QUEUE_PAGE_WORDS.UNREAD}
        symbol={GLYPH.FAILED}
        readFailed
        retry={() => void read.refetch()}
      />
    ) : repositories === undefined ? (
      <EmptyState title={MERGE_QUEUE_PAGE_WORDS.READING} symbol={GLYPH.QUEUED} loading />
    ) : repositories.length === 0 ? (
      <EmptyState title={MERGE_QUEUE_PAGE_WORDS.EMPTY} symbol={GLYPH.QUEUED} />
    ) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: MERGE_QUEUE_PAGE_WORDS.TITLE }} />
      <Screen>
        <RowList
          look={LIST_LOOK.PLAIN}
          selected={pr}
          onSelect={openLink}
          onRefresh={refresh}
          empty={empty}
        >
          {(repositories ?? []).map((queue) => (
            <RepositoryQueue
              key={queue.repository}
              queue={queue}
              label={repositoryLabel(queue.repository, repositories ?? [])}
              copy={keeping.copyWords}
            />
          ))}
        </RowList>
      </Screen>
    </>
  );
}
