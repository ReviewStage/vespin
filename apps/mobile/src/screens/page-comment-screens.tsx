// page-comment-screens.tsx -- the comments on a page an agent showed, in the comment sheet over the page: a new thread on words selected in it or on the page whole, its words as the heading and the comment field docked under them, and the page's threads as a list, each opening its thread in the same sheet.

import {
  Composer,
  EmptyState,
  GLYPH,
  GlassDock,
  LIST_LOOK,
  RowForEach,
  RowList,
  Screen,
  ThreadPage,
  useMinute,
} from "@repo/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { LINK_OPENS, useOpenLink } from "../open-link.js";
import { useSheetAtHalf } from "../sheet-stack.js";
import { threadOpen, useCommentSettle, useTaskComments } from "../tasks/use-comments.js";
import {
  type PageElement,
  type PageSpot,
  usePageCommentStart,
} from "../tasks/use-page-comments.js";
import { useTaskOverview } from "../tasks/use-tasks.js";
import {
  COMMENT_ROUTE,
  CommentSheetBar,
  commentPath,
  fieldHead,
  quoteOf,
  useOpenCommentThread,
} from "./comment-screens.js";
import { CommentRow } from "./task-screens.js";

/** The page comment sheet's routes: a new thread on a page, and the page's threads. */
const PAGE_COMMENT_ROUTE = {
  NEW: "/task-comment/page",
  THREADS: "/task-comment/page-threads",
} as const;

/** The words the page's comment sheets say. */
const WORDS = {
  ADD_COMMENT: "Add a comment",
  WHOLE_PAGE: "The whole page",
  NONE: "No comments on this page",
} as const;

/** A page a thread is started on: its task, its id, the version read, and its title, which heads a thread on the page whole. */
export interface CommentedPage {
  readonly taskId: string;
  readonly pageId: string;
  readonly version: number;
  readonly title: string;
}

/** Opens a new thread on a page in the comment sheet over it: on the element words were selected in, or on the page whole where none is named. */
export function useOpenNewPageComment(): (
  page: CommentedPage,
  element: PageElement | undefined,
) => void {
  const router = useRouter();

  return ({ taskId, pageId, version, title }, element) =>
    router.push({
      pathname: PAGE_COMMENT_ROUTE.NEW,
      params: { task: taskId, page: pageId, version: `${version}`, title, ...element },
    });
}

/** Opens a page's threads as a list in the comment sheet over it. */
export function useOpenPageThreads(): (taskId: string, pageId: string) => void {
  const router = useRouter();

  return (taskId, pageId) =>
    router.push({ pathname: PAGE_COMMENT_ROUTE.THREADS, params: { task: taskId, page: pageId } });
}

/**
 * A new thread on a page, named by the route's `task`, `page`, and
 * `version`, and the element its `path`, `quote`, and `section` name, or the
 * page whole where it names none, as Comment over words selected in it or
 * the page's ⋯ opens it: the words quoted as its heading, as the thread
 * will quote them, or the page's title, and the comment field docked over
 * its foot, whose send starts the thread and opens it in this screen's
 * place at once, as a description's new comment does.
 */
export function NewPageCommentScreen() {
  const {
    task = "",
    page = "",
    version = "",
    title = "",
    path,
    quote = "",
    section = "",
  } = useLocalSearchParams<{
    task: string;
    page: string;
    version: string;
    title: string;
    path?: string;
    quote?: string;
    section?: string;
  }>();

  // Note that the spot is kept as one value while the route stands, since its draft is kept by it.
  const spot = useMemo<PageSpot>(
    () => ({
      pageId: page,
      version: Number(version),
      element: path === undefined ? undefined : { path, quote, section },
    }),
    [page, version, path, quote, section],
  );

  return <NewPageComment taskId={task} spot={spot} title={title} />;
}

/** A new thread on a page, as `NewPageCommentScreen` describes it. */
function NewPageComment({
  taskId,
  spot,
  title,
}: {
  readonly taskId: string;
  readonly spot: PageSpot;
  readonly title: string;
}) {
  const router = useRouter();
  const half = useSheetAtHalf();
  const overview = useTaskOverview(taskId);
  // Note that a link opens on the tabs under the sheet, closing it, as a thread's does.
  const openLink = useOpenLink(overview?.task.workspaceId, LINK_OPENS.OUT_OF_SHEET);
  const task = overview?.task.id ?? taskId;
  const start = usePageCommentStart(task, spot);
  const path = commentPath(overview);

  // Note that the thread opens in this screen's place as the start goes, drawn under the id the start chose.
  const send = (typed: string): boolean => {
    const threadId = start.send(typed);

    if (threadId === undefined) return false;
    router.replace({
      pathname: COMMENT_ROUTE.THREAD,
      params: { id: threadId, task, page: spot.pageId },
    });

    return true;
  };

  const composer = {
    placeholder: WORDS.ADD_COMMENT,
    autoFocus: true,
    words: start.words,
    onWords: start.onWords,
    sendable: start.sendable,
    onSend: send,
    head: fieldHead(start.pictures, start.note),
    onAdd: start.pictures.attach,
    onDropPictures: start.pictures.drop,
  };

  const heading =
    spot.element === undefined
      ? title.trim() || WORDS.WHOLE_PAGE
      : quoteOf(spot.element.quote, true);

  return (
    <>
      <CommentSheetBar path={path} half={half} />
      <GlassDock bar={<Composer {...composer} />}>
        <Screen clear={half}>
          <ThreadPage
            quoted
            path={path}
            status={overview?.task.status}
            title={heading}
            messages={[]}
            repository={overview?.task.repository}
            onOpenLink={openLink}
          />
        </Screen>
      </GlassDock>
    </>
  );
}

/**
 * A page's threads, named by the route's `task` and `page`, as the page's
 * bar opens them: the open ones first, then the resolved, each a thread's
 * row, as the task's Comments section lists the description's, its press
 * opening the thread in the same sheet and its swipe resolving or
 * reopening it.
 */
export function PageThreadsScreen() {
  const { task = "", page = "" } = useLocalSearchParams<{ task: string; page: string }>();
  const half = useSheetAtHalf();
  const now = useMinute();
  const overview = useTaskOverview(task);
  const threads = useTaskComments(overview?.task.id, page);
  const settle = useCommentSettle(task);
  const openThread = useOpenCommentThread();

  const listed = useMemo(
    () => [...threads.filter(threadOpen), ...threads.filter((thread) => !threadOpen(thread))],
    [threads],
  );

  return (
    <>
      <CommentSheetBar path={commentPath(overview)} half={half} />
      <Screen clear={half}>
        <RowList
          look={LIST_LOOK.PLAIN}
          onSelect={(id) => openThread(task, id, page)}
          empty={
            listed.length === 0 ? (
              <EmptyState title={WORDS.NONE} symbol={GLYPH.COMMENT} />
            ) : undefined
          }
        >
          <RowForEach data={listed} keyOf={(thread) => thread.id}>
            {(thread) => <CommentRow thread={thread} now={now} onSettle={settle} />}
          </RowForEach>
        </RowList>
      </Screen>
    </>
  );
}
