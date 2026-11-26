// comment-screens.tsx -- one thread of a task's description comments, pushed from the task's Overview: its comments as a thread's messages, the words it stands on as its heading, Resolve or Reopen in its bar, and the reply field docked at its foot; and a new thread on one block of the description, its words as the heading and the comment field docked under them.

import { PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import { type DescriptionBlock, descriptionBlocks } from "@repo/features/description-blocks";
import { COMMENT_NOTE } from "@repo/features/description-comment-notes";
import { agentName, providerOf } from "@repo/features/model-label";
import { PICTURE_OWNER } from "@repo/features/picture-source-wire";
import { readFailedWords, readingWords } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import {
  AskNote,
  AttachedPictures,
  BAR_TITLE,
  BUTTON_LOOK,
  Composer,
  EmptyState,
  GLYPH,
  GlassDock,
  glyphSymbol,
  NOTICE_KIND,
  PATH_PART,
  Screen,
  ThreadPage,
  useColors,
  useFailureNotices,
} from "@repo/ui-native";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useMemberPictures } from "../member-pictures.js";
import { useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import {
  type CommentReply,
  threadMessages,
  threadOpen,
  useCommentMedia,
  useCommentReply,
  useCommentSettle,
  useCommentStart,
  useTaskComments,
  useTaskCommentsHeld,
  useTaskCommentsRetry,
} from "../tasks/use-comments.js";
import { type TaskOverview, useTaskOverview } from "../tasks/use-tasks.js";
import { PicturesProvider } from "../use-pictures.js";
import { TaskMissing } from "./task-missing.js";

/** The panel's words for a thread: what its field says before anything is typed, how a resolved one ended, and what stands for words since deleted. */
const WORDS = {
  REPLY: "Reply",
  ADD_COMMENT: "Add a comment",
  RESOLVED: "Resolved",
  GONE: "Original content deleted",
  NOT_FOUND: "Comment not found",
  RESOLVE: "Resolve",
  REOPEN: "Reopen",
} as const;

/** A comment field's head: the pictures it carries, each taken off on a press, and what its last send or a picture's bound said; none while it holds neither. */
function fieldHead(pictures: CommentReply["pictures"], note: string | undefined) {
  if (pictures.attached.length === 0 && note === undefined) return undefined;

  return (
    <>
      <AttachedPictures pictures={pictures.attached} onDetach={pictures.detach} />
      {note === undefined ? null : <AskNote words={note} />}
    </>
  );
}

/** What a thread's page says while the task's comments are first read. */
const READING_COMMENTS = readingWords("the comments");

/** What a thread's page says where the task's comments could not be read, beside Try again. */
const COMMENTS_UNREAD = readFailedWords("the comments");

/** What the description is called while it is first read. */
const READING_DESCRIPTION = readingWords("the description");

/** What the page says where the description could not be read, beside Try again. */
const DESCRIPTION_UNREAD = readFailedWords("the description");

const TRY_AGAIN = "Try again";

/** Where a refused start's field opens again: its task, its block's span and words, and the thread id it went under. */
type Reopening = {
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  readonly quote: string;
  readonly again: string;
};

/**
 * How each thread standing in front puts the field its start was refused
 * from back in its own place, by the thread's id. Note that a new thread
 * opens before the service has taken it, so a refusal reopens its field only
 * where the person still looks at it, and says so in the failure notice
 * anywhere else; and that the thread's own page does the reopening, since
 * only it knows where it now stands on its tab's stack.
 */
const standingThreads = new Map<string, (reopening: Reopening) => void>();

/** The threads a send opened whose page has not yet stood, so a refusal that comes first waits for it. */
const openingThreads = new Set<string>();

/** Refusals that came before their thread's page stood, by the thread's id, which the page reopens as it first stands. */
const earlyRefusals = new Map<string, Reopening>();

/** The block a refused start was measured on, with the description's text it was measured in, kept for the field it reopens. */
interface MeasuredBlock {
  readonly text: string;
  readonly block: DescriptionBlock;
}

/**
 * The blocks refused starts were measured on, by the thread id each went
 * under, which the reopened field's route names. Note that the field takes
 * the block and text the send was measured in rather than finding the block
 * again in the description as it now stands, which an edit since may have
 * moved, and that the text is too large for a route to carry. The words,
 * their key and why are kept with the block's draft (`useCommentStart`).
 */
const refusedBlocks = new Map<string, MeasuredBlock>();

/**
 * What a new comment's page shows where it has no block to answer: the
 * spinner while the description is first read, its failure with Try again
 * where the read failed, and that the block has no words once it's read.
 */
function BlockState({ overview }: { readonly overview: TaskOverview | undefined }) {
  if (overview?.document !== undefined) {
    return <EmptyState title={COMMENT_NOTE.NO_WORDS} symbol={GLYPH.COMMENT} />;
  }

  const retry = overview?.documentRetry;

  if (retry === undefined) {
    return <EmptyState title={READING_DESCRIPTION} symbol={GLYPH.COMMENT} loading />;
  }

  return (
    <EmptyState
      title={DESCRIPTION_UNREAD}
      symbol={GLYPH.COMMENT}
      action={{ label: TRY_AGAIN, onPress: retry, look: BUTTON_LOOK.BORDERED }}
    />
  );
}

/**
 * What a thread's page draws where it holds no thread: the task's own
 * missing state while the task is not held (`TaskMissing`); reading while
 * its comments are on their way; their read's failure with Try again; and
 * Comment not found only once they are read and hold no such thread, so a
 * thread opened from a link never says it is gone before its read lands.
 */
function ThreadMissing({
  taskId,
  overview,
}: {
  readonly taskId: string;
  readonly overview: TaskOverview | undefined;
}) {
  const held = useTaskCommentsHeld(overview?.task.id);
  const retry = useTaskCommentsRetry(overview?.task.id);

  if (overview === undefined) return <TaskMissing taskId={taskId} notFound={WORDS.NOT_FOUND} />;

  if (retry !== undefined) {
    return (
      <EmptyState
        title={COMMENTS_UNREAD}
        symbol={GLYPH.COMMENT}
        action={{ label: TRY_AGAIN, onPress: retry, look: BUTTON_LOOK.BORDERED }}
      />
    );
  }

  if (!held) return <EmptyState title={READING_COMMENTS} symbol={GLYPH.COMMENT} loading />;

  return <EmptyState title={WORDS.NOT_FOUND} symbol={GLYPH.NOT_FOUND} />;
}

/** A comment screen's path, as the bar names it: the task's name and its key. */
function commentPath(overview: TaskOverview | undefined): readonly string[] {
  const task = overview?.task;

  const key =
    task?.number === undefined || overview?.workspace === undefined
      ? undefined
      : taskKey(overview.workspace.name, task.number);

  return [task?.name, key].filter((step): step is string => step !== undefined);
}

/** The words a thread stands on, as its heading quotes them, or that they are gone where every one was deleted. */
function quoteOf(quote: string, anchored: boolean): string {
  return anchored && quote.trim() !== "" ? `“${quote.trim()}”` : WORDS.GONE;
}

/**
 * One thread of a task's description, named by the route's `id` on the
 * task its `task` names: the words it stands on as its heading, Resolved
 * under them once it is, its comments, each by its writer, and the reply
 * field docked over its foot, which answers it whether it stands open or
 * resolved, as the panel's thread does, what a reply that did not land
 * said standing in the field's head. The task's path stands small in
 * the bar, as a page of the task's does, and the bar's trailing button
 * resolves the thread, or reopens it once resolved, as the panel's check
 * on its first comment does. Opened from a split view's detail, it is
 * pushed on the tab's own stack over the whole window, as a compact window
 * pushes it.
 */
export function CommentThreadScreen() {
  const { id = "", task: taskId = "" } = useLocalSearchParams<{ id: string; task: string }>();

  return <CommentThread threadId={id} taskId={taskId} />;
}

/** One thread of a task's description, as `CommentThreadScreen` describes it. */
function CommentThread({
  threadId: id,
  taskId,
}: {
  readonly threadId: string;
  readonly taskId: string;
}) {
  const colors = useColors();
  const overview = useTaskOverview(taskId);
  const openLink = useOpenLink(overview?.task.workspaceId);
  const threads = useTaskComments(overview?.task.id);
  const thread = threads.find((each) => each.id === id);
  const reply = useCommentReply(taskId, id);
  const media = useCommentMedia(overview?.task.id, thread);
  const settle = useCommentSettle(taskId);
  const pictureOf = useMemberPictures();

  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  // Note that a thread stands only while it is in front, since a page pushed over it on the tab's stack, or another tab, keeps it mounted.
  const standing = useIsFocused();

  useEffect(() => {
    if (!standing) return;

    const reopen = (reopening: Reopening) => {
      const { taskId: task, ...span } = reopening;
      router.replace({ pathname: onOwnTab("/tasks/comments/new"), params: { task, ...span } });
    };

    standingThreads.set(id, reopen);
    openingThreads.delete(id);
    const early = earlyRefusals.get(id);

    if (early !== undefined) {
      earlyRefusals.delete(id);
      reopen(early);
    }

    return () => {
      standingThreads.delete(id);
    };
  }, [standing, id, router, onOwnTab]);

  const agents = new Map(
    (overview?.agents ?? []).map(
      ({ agent }) =>
        [agent.id, { name: agentName(agent), harness: providerOf(agent.model) }] as const,
    ),
  );

  const task = overview?.task;
  const path = commentPath(overview);

  const composer = {
    placeholder: WORDS.REPLY,
    words: reply.words,
    onWords: reply.onWords,
    sendable: reply.sendable,
    onSend: reply.send,
    head: fieldHead(reply.pictures, reply.note),
    onAdd: reply.pictures.attach,
    onDropPictures: reply.pictures.drop,
  };

  // Note that each picture of the thread reads its own source where it is drawn, under the task it belongs to, so one landing draws that picture alone.
  const page =
    thread === undefined || task === undefined ? undefined : (
      <PicturesProvider
        owner={PICTURE_OWNER.TASK}
        ownerId={task.id}
        kind={PRODUCT_PICTURE_KIND.COMMENT}
      >
        <ThreadPage
          quoted
          path={path}
          status={task.status}
          title={quoteOf(thread.quote, thread.anchor !== undefined)}
          messages={threadMessages(thread, agents, pictureOf, media)}
          repository={task.repository}
          onOpenLink={openLink}
          standing={threadOpen(thread) ? undefined : WORDS.RESOLVED}
        />
      </PicturesProvider>
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {thread === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={glyphSymbol(threadOpen(thread) ? GLYPH.CHECK : GLYPH.RESTORE)}
            accessibilityLabel={threadOpen(thread) ? WORDS.RESOLVE : WORDS.REOPEN}
            onPress={() => settle(thread)}
          />
        </Stack.Toolbar>
      )}
      {thread === undefined ? (
        <Screen>
          <ThreadMissing taskId={taskId} overview={overview} />
        </Screen>
      ) : (
        <GlassDock bar={<Composer {...composer} />}>
          <Screen>{page}</Screen>
        </GlassDock>
      )}
    </>
  );
}

/**
 * A new thread on one block of a task's description, named by the route's
 * `from`, `to`, and `quote` (the block's words) on the task its `task`
 * names, as a long press on the block opens it: the block's words quoted as
 * its heading, as the thread they start will quote them, and the comment
 * field docked over its foot, whose send starts the thread and opens it in
 * this screen's place at once, as a document's comment opens its thread.
 * A send the service refused opens the field again on its words, with why
 * in its head, where the thread still stands, and says why in the failure
 * notice anywhere else. The block is kept as it stood
 * when the screen first found it, so an edit elsewhere in the description
 * never takes the field away; where the route names no block of the
 * description as read, it says so.
 */
export function NewCommentScreen() {
  const {
    task: taskId = "",
    from = "",
    to = "",
    quote = "",
    again,
  } = useLocalSearchParams<{
    task: string;
    from: string;
    to: string;
    quote: string;
    again?: string;
  }>();

  return <NewComment taskId={taskId} from={from} to={to} quote={quote} again={again} />;
}

/** A new thread on one block of a task's description, as `NewCommentScreen` describes it. */
function NewComment({
  taskId,
  from,
  to,
  quote,
  again,
}: {
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  readonly quote: string;
  /** The thread id a refused start went under, whose field this opens again on the block it was measured on. */
  readonly again?: string | undefined;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const colors = useColors();
  const overview = useTaskOverview(taskId);
  const openLink = useOpenLink(overview?.task.workspaceId);
  const body = overview?.document?.description.body ?? "";

  // Note that the block must still quote the words it was opened on, so an edit that put other words at the same offsets before this read finds nothing rather than the wrong block.
  const found = useMemo(
    () =>
      descriptionBlocks(body).find(
        (each) => `${each.from}` === from && `${each.to}` === to && each.quote === quote,
      ),
    [body, from, to, quote],
  );

  // Note that the block is kept as it stood when first found, with the text it was measured in, because an edit elsewhere moves its offsets while it is being commented on, and the service carries a span measured in that text over to the text as it stands.
  const [held, setHeld] = useState<MeasuredBlock | undefined>(() =>
    again === undefined ? undefined : refusedBlocks.get(again),
  );

  if (held === undefined && found !== undefined) setHeld({ text: body, block: found });
  const block = held?.block;
  const notices = useFailureNotices();
  const start = useCommentStart(overview?.task.id ?? taskId, held?.text ?? body, block);
  const path = commentPath(overview);
  const task = overview?.task.id ?? taskId;

  // Note that the start is a declared write, drawn under its own id at once, so its thread opens in this screen's place as it goes; a refusal reopens this field on the words, under the same key, where the thread still stands in front.
  const send = (typed: string): boolean => {
    if (held === undefined) return false;
    const measured = held;

    const threadId = start.send(typed, (refused, noticed) => {
      const reopening = { taskId: task, from, to, quote, again: refused.threadId };
      const reopen = standingThreads.get(refused.threadId);

      if (reopen !== undefined || openingThreads.has(refused.threadId)) {
        refusedBlocks.set(refused.threadId, measured);
      }

      if (reopen !== undefined) {
        reopen(reopening);

        return;
      }

      if (openingThreads.delete(refused.threadId)) {
        earlyRefusals.set(refused.threadId, reopening);

        return;
      }

      // Note that a refusal the offline notice already said is not said again.
      if (!noticed) notices.say({ kind: NOTICE_KIND.REFUSED, words: refused.note });
    });

    if (threadId === undefined) return false;
    // Note that the same words sent again go under the same thread's id, so a refusal parked for an earlier send of them is let go rather than reopening this one.
    earlyRefusals.delete(threadId);
    openingThreads.add(threadId);
    router.replace({ pathname: onOwnTab("/tasks/comments/[id]"), params: { id: threadId, task } });

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

  const empty = <BlockState overview={overview} />;

  const page =
    block === undefined ? undefined : (
      <ThreadPage
        quoted
        path={path}
        status={overview?.task.status}
        title={quoteOf(block.quote ?? "", true)}
        messages={[]}
        repository={overview?.task.repository}
        onOpenLink={openLink}
      />
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {block === undefined ? (
        <Screen>{empty}</Screen>
      ) : (
        <GlassDock bar={<Composer {...composer} />}>
          <Screen>{page}</Screen>
        </GlassDock>
      )}
    </>
  );
}
