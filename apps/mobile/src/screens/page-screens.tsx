// page-screens.tsx -- a page an agent showed on its task, opened whole in the app's one web view, from the agent's transcript or the task's Overview, its threads' words tinted in it and Comment offered on words selected in it.

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import type { PagePicked } from "@repo/features/page-pick";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { VERB } from "@repo/features/words";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BUTTON_LOOK,
  EmptyState,
  GLYPH,
  glyphSymbol,
  Screen,
  SealedPage,
  StackBarMenu,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { PAGE_NEWEST, usePageHtml } from "../agents/use-agent.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { openInSafari } from "../open-link.js";
import { usePageShownCount } from "../page-shown.js";
import { useSurfaceOpen } from "../surface-open.js";
import { threadOpen, useTaskComments } from "../tasks/use-comments.js";
import { useFoundTask } from "../tasks/use-found-task.js";
import { pageMarks, threadsOn } from "../tasks/use-page-comments.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";
import { useOpenCommentThread } from "./comment-screens.js";
import {
  type CommentedPage,
  useOpenNewPageComment,
  useOpenPageThreads,
} from "./page-comment-screens.js";

/** What stands in a page's place where it could not be read. */
const PAGE_WORDS = {
  FAILED: "The page could not be read.",
  MORE: "More",
  TRY_AGAIN: "Try again",
  COMMENTS: "Comments",
  COMMENT_ON_PAGE: "Comment on page",
} as const;

/**
 * The comments on a page as its screen offers them: its threads, followed
 * while it stands; the elements they are on, marked in the page; Comment,
 * which opens a new thread on the words selected; a press on an element
 * marked, which opens its thread, or the page's list where several stand
 * on it; and the page's list itself. A thread names the version drawn,
 * whose words were selected, so none starts until one is drawn. Note that
 * Comment is offered as soon as the task is known, since the web view sets
 * its menu up only as it first stands (`SealedPage`).
 */
function usePageCommenting(
  page: Omit<CommentedPage, "taskId" | "version"> & {
    readonly taskId: string | undefined;
    readonly version: number | undefined;
  },
) {
  const { taskId, pageId, version, title } = page;
  const threads = useTaskComments(taskId, pageId);
  const openThread = useOpenCommentThread();
  const openNew = useOpenNewPageComment();
  const openList = useOpenPageThreads();
  const marks = useMemo(() => pageMarks(threads), [threads]);

  const commented =
    taskId === undefined || version === undefined ? undefined : { taskId, pageId, version, title };

  const onOpenMark = (path: string) => {
    const onIt = threadsOn(threads, path);
    const [only] = onIt;

    if (taskId === undefined || only === undefined) return;

    if (onIt.length === 1) openThread(taskId, only.id, pageId);
    else openList(taskId, pageId);
  };

  return {
    threads,
    open: threads.filter(threadOpen).length,
    marks,
    onOpenMark,
    onComment:
      taskId === undefined
        ? undefined
        : ({ path, quote, section }: PagePicked) => {
            if (commented !== undefined) openNew(commented, { path, quote, section });
          },
    onCommentPage: commented === undefined ? undefined : () => openNew(commented, undefined),
    onList: taskId === undefined ? undefined : () => openList(taskId, pageId),
  };
}

/** The page's address on vespin.dev, under its workspace and its task; none until both are read. */
function usePageAddress(
  workspaceId: string | undefined,
  taskId: string | undefined,
  pageId: string,
): string | undefined {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = workspaces.find(({ id }) => id === workspaceId);

  if (workspace === undefined || taskId === undefined) return undefined;

  return linkOf(
    { kind: LINK_DESTINATION.PAGE, taskId: taskId, pageId },
    workspace.slug ?? workspace.id,
  );
}

/** A page's version, by its task and its workspace, and the name it is opened under until its own is read; a link names no version, so it opens at the newest. */
type PageOpened = {
  readonly workspaceId: string | undefined;
  readonly taskId: string | undefined;
  readonly pageId: string;
  readonly version: number | undefined;
  readonly title: string;
  /** Whether the page's task was found nowhere, so the page can never be read. */
  readonly lost?: boolean;
};

/** A route's version as its screen opens it: the number it names, or none for a link, which names none. */
export function openedVersion(version: string): number | undefined {
  return version === "" ? undefined : Number(version);
}

/**
 * The version a page opens at: the one its opener named, else the newest
 * the task's pages hold, as the panel opens a page's link, those pages
 * followed while the page stands; none until they are read, and `missing`
 * where they hold no such page or could not be read.
 */
function useVersionOf(taskId: string | undefined, pageId: string, named: number | undefined) {
  const acts = useHostActs();
  const follows = named === undefined ? taskId : undefined;
  useLiveFollow(follows, (id) => acts[ACT_KIND.TASKS_PAGES_FOLLOW]({ taskId: id }));

  const { data: held } = useQuery({
    ...appStateQuery,
    select: (state) =>
      follows === undefined ? undefined : state[LIVE_READ.PAGES][PAGE_OWNER.TASK][follows],
  });

  if (named !== undefined) return { version: named, missing: false };
  const pages = held?.rows;
  const newest = pages?.find(({ id }) => id === pageId)?.version;

  // Note that pages the service could not read count as missing until a later answer brings them, as the follow tries again on its own, rather than reading for good.
  return {
    version: newest,
    missing: pages === undefined ? held?.failed === true : newest === undefined,
  };
}

/**
 * One version of a page, opened whole in the app's one web view, sealed
 * from the network and from navigation, under the system's header naming
 * it, with a ⋯ that comments on the page whole and opens it in the
 * browser, and, where the page has threads, a comments glyph counting the
 * open ones, which lists them. The words its threads quote stand tinted in
 * the page, a press in one opening its thread, and Comment stands in the
 * menu over words selected in it. It reads until its task is known.
 */
export function PageScreen({
  workspaceId,
  taskId,
  pageId,
  version: asked,
  title,
  lost = false,
}: PageOpened) {
  useSurfaceOpen(PRODUCT_SURFACE.PAGE, pageId);
  const { version, missing } = useVersionOf(taskId, pageId, asked);
  // Note that a link's page is read at its newest at once, beside the task's pages, which name a later version should one land while it stands.
  const readAt = version ?? (taskId === undefined ? undefined : PAGE_NEWEST);
  const html = usePageHtml(taskId, pageId, readAt);
  const { again } = html;

  // Note that a page read stands even where the task's pages could not be read.
  const read = "html" in html.read || !(missing || lost) ? html.read : { failed: true as const };
  const address = usePageAddress(workspaceId, taskId, pageId);
  const named = "title" in read && read.title !== "" ? read.title : title;
  const shown = usePageShownCount(asked !== undefined, "html" in read);
  // Note that the version a comment is left on is the one the web view draws, which stands while a later version is read, as `SealedPage` keeps it, so a comment never pairs one version's words with another's number.
  const [drawn, setDrawn] = useState<number | undefined>(undefined);

  if ("html" in read && read.version !== drawn) setDrawn(read.version);
  const comments = usePageCommenting({ taskId, pageId, version: drawn, title: named });

  const actions = [
    ...(comments.onCommentPage === undefined
      ? []
      : [
          {
            label: PAGE_WORDS.COMMENT_ON_PAGE,
            symbol: GLYPH.COMMENT,
            onPress: comments.onCommentPage,
          },
        ]),
    ...(address === undefined
      ? []
      : [
          {
            label: VERB.OPEN_IN_BROWSER,
            symbol: GLYPH.OPEN_EXTERNALLY,
            onPress: () => openInSafari(address),
          },
        ]),
  ];

  const failed = (
    <EmptyState
      title={PAGE_WORDS.FAILED}
      symbol={GLYPH.FAILED}
      action={{ label: PAGE_WORDS.TRY_AGAIN, onPress: again, look: BUTTON_LOOK.BORDERED }}
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: named }} />
      {actions.length === 0 ? null : (
        <Stack.Toolbar placement="right">
          {comments.threads.length === 0 || comments.onList === undefined ? null : (
            <Stack.Toolbar.Button
              icon={glyphSymbol(GLYPH.COMMENT)}
              accessibilityLabel={PAGE_WORDS.COMMENTS}
              onPress={comments.onList}
            >
              {PAGE_WORDS.COMMENTS}
              {comments.open === 0 ? null : (
                <Stack.Toolbar.Badge>{`${comments.open}`}</Stack.Toolbar.Badge>
              )}
            </Stack.Toolbar.Button>
          )}
          <Stack.Toolbar.View>
            <StackBarMenu
              menu={{ label: PAGE_WORDS.MORE, symbol: GLYPH.MORE, choices: [], actions }}
            />
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      )}
      {/* Note that the page stands as the screen's root, outside its SwiftUI host, since the web view sizes itself to the screen. */}
      {/* Note that the web view is drawn while the page is still read, its loading ground over it, so WebKit starts beside the read rather than after it. */}
      {"failed" in read ? (
        <Screen>{failed}</Screen>
      ) : (
        <SealedPage
          html={"html" in read ? read.html : undefined}
          title={named}
          onLoaded={shown}
          marks={comments.marks}
          onComment={comments.onComment}
          onOpenMark={comments.onOpenMark}
        />
      )}
    </>
  );
}

/** A page a task's Overview lists, opened by its task, its id, and the version the list holds, in the task's own workspace, which a later workspace switch leaves as it is. */
export function TaskPageScreen() {
  const {
    id = "",
    task = "",
    workspace = "",
    version = "",
    title = "",
  } = useLocalSearchParams<{
    id: string;
    task: string;
    workspace: string;
    version: string;
    title: string;
  }>();

  return (
    <TaskPage
      pageId={id}
      taskId={task}
      workspaceId={workspace === "" ? undefined : workspace}
      version={openedVersion(version)}
      title={title}
    />
  );
}

/**
 * A page a task's Overview lists or a link names, in the workspace its route
 * names, by id or as a link's slug, or the one chosen where it names none.
 * A task a link names by number is found first, as a task's link finds one
 * (`useFoundTask`), and one found nowhere says the page could not be read.
 */
function TaskPage({
  workspaceId: named,
  taskId,
  ...opened
}: Omit<PageOpened, "taskId"> & { readonly taskId: string }) {
  const chosen = useTasksWorkspace();
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = named === undefined ? chosen : workspaceOfSlug(workspaces, named);
  const found = useFoundTask(taskId, named ?? chosen?.id);

  return (
    <PageScreen
      {...opened}
      workspaceId={workspace?.id ?? chosen?.id}
      taskId={found.taskId}
      lost={found.taskId === undefined && !found.seeking}
    />
  );
}
