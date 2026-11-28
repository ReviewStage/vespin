// comment-screens.tsx -- one thread of a task's description comments, in the comment sheet over the task: its comments as a thread's messages, the words it stands on as its heading, Resolve or Reopen in its bar, and the reply field docked at its foot; and a new thread on one block of the description, its words as the heading and the comment field docked under them.

import { PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import { descriptionBlocks } from "@repo/features/description-blocks";
import { COMMENT_NOTE } from "@repo/features/description-comment-notes";
import { DESCRIPTION_COMMENT_SCOPE } from "@repo/features/description-comment-wire";
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
  NO_GROUND,
  NOTICE_KIND,
  PATH_PART,
  Screen,
  ThreadPage,
  useColors,
  useFailureNotices,
} from "@repo/ui-native";
import { randomUUID } from "expo-crypto";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMemberPictures } from "../member-pictures.js";
import { LINK_OPENS, useOpenLink } from "../open-link.js";
import { useSheetAtHalf } from "../sheet-stack.js";
import {
  type CommentReply,
  forgetStartDrafts,
  type StartSpan,
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
  CLOSE: "Close",
} as const;

/** The comment sheet's routes: a thread, by its id and its task, and a new thread on words of the task's description. */
const COMMENT_ROUTE = {
  THREAD: "/task-comment",
  NEW: "/task-comment/new",
} as const;

/** Opens a thread of a task's description in the comment sheet over the screen in front. */
export function useOpenCommentThread(): (taskId: string, threadId: string) => void {
  const router = useRouter();

  return (taskId, threadId) =>
    router.push({ pathname: COMMENT_ROUTE.THREAD, params: { id: threadId, task: taskId } });
}

/** A new thread's span: a block's, by its Markdown offsets and the words it quotes, or words selected, with the Markdown they were measured in. */
type NewCommentSpan =
  | { readonly from: number; readonly to: number; readonly quote: string }
  | {
      readonly from: number;
      readonly to: number;
      readonly quote: string;
      readonly text: string;
    };

/** Opens a new thread on a span of a task's description in the comment sheet over the screen in front: a block's, found again in the description, or words selected, kept with the Markdown they were measured in. */
export function useOpenNewComment(): (taskId: string, span: NewCommentSpan) => void {
  const router = useRouter();

  return (taskId, span) => {
    const { from, to, quote } = span;
    const params = { task: taskId, from: `${from}`, to: `${to}`, quote };

    if (!("text" in span)) {
      router.push({ pathname: COMMENT_ROUTE.NEW, params });

      return;
    }

    const held = randomUUID();
    const block = { from, to, quote, scope: DESCRIPTION_COMMENT_SCOPE.WORDS };
    selectedSpans.set(held, { text: span.text, block });
    router.push({ pathname: COMMENT_ROUTE.NEW, params: { ...params, held } });
  };
}

/**
 * The comment sheet's bar: the task's path as its title, small and muted as
 * a page of the task names it, and the sheet's close at its leading edge.
 * Note that at half height the sheet stands on its own glass, so its page
 * paints no ground there (`useSheetAtHalf`).
 */
function CommentSheetBar({
  path,
  half,
}: {
  readonly path: readonly string[];
  readonly half: boolean;
}) {
  const colors = useColors();
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: path.join(PATH_PART),
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: half ? NO_GROUND : colors.GROUND },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CLOSE}
          onPress={() => router.back()}
        >
          {WORDS.CLOSE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

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

/** The block or words a start is measured on, with the description's text it was measured in, kept for the field that sends it. */
interface MeasuredBlock {
  readonly text: string;
  readonly block: StartSpan;
}

/**
 * Words selected in the description for a new thread, by the key the new
 * thread's route names, with the Markdown they were measured in, which is
 * too large for a route to carry. Note that the field's Markdown may hold
 * words not saved yet, so the span is never found again in the description
 * as read, as a block's is.
 */
const selectedSpans = new Map<string, MeasuredBlock>();

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
 * Lets go of what the comment sheet holds of a description as the account
 * signs out: new threads' drafts, the words selected and the blocks refused
 * starts were measured on, each with the description's text, so the next
 * account on the phone never opens on another's words.
 */
export function useCommentDraftsSignOut(signedIn: boolean): void {
  const wasSignedIn = useRef(signedIn);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      forgetStartDrafts();
      selectedSpans.clear();
      refusedBlocks.clear();
      earlyRefusals.clear();
    }

    wasSignedIn.current = signedIn;
  }, [signedIn]);
}

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
  const half = useSheetAtHalf();
  const overview = useTaskOverview(taskId);
  // Note that a link opens on the tabs under the sheet, closing it, since a push from inside the sheet would stand the tabs again inside it.
  const openLink = useOpenLink(overview?.task.workspaceId, LINK_OPENS.OUT_OF_SHEET);
  const threads = useTaskComments(overview?.task.id);
  const thread = threads.find((each) => each.id === id);
  const reply = useCommentReply(taskId, id);
  const media = useCommentMedia(overview?.task.id, thread);
  const settle = useCommentSettle(taskId);
  const pictureOf = useMemberPictures();

  const router = useRouter();
  // Note that a thread stands only while it is in front, since a page opened over the sheet keeps it mounted.
  const standing = useIsFocused();

  useEffect(() => {
    if (!standing) return;

    const reopen = (reopening: Reopening) => {
      const { taskId: task, ...span } = reopening;
      router.replace({ pathname: COMMENT_ROUTE.NEW, params: { task, ...span } });
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
  }, [standing, id, router]);

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
      <CommentSheetBar path={path} half={half} />
      {thread === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={glyphSymbol(threadOpen(thread) ? GLYPH.CHECK : GLYPH.RESTORE)}
            accessibilityLabel={threadOpen(thread) ? WORDS.RESOLVE : WORDS.REOPEN}
            onPress={() => settle(thread)}
          >
            {threadOpen(thread) ? WORDS.RESOLVE : WORDS.REOPEN}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      {thread === undefined ? (
        <Screen clear={half}>
          <ThreadMissing taskId={taskId} overview={overview} />
        </Screen>
      ) : (
        <GlassDock bar={<Composer {...composer} />}>
          <Screen clear={half}>{page}</Screen>
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
    held,
  } = useLocalSearchParams<{
    task: string;
    from: string;
    to: string;
    quote: string;
    again?: string;
    held?: string;
  }>();

  return <NewComment taskId={taskId} from={from} to={to} quote={quote} again={again} held={held} />;
}

/** A new thread on one block of a task's description, as `NewCommentScreen` describes it. */
function NewComment({
  taskId,
  from,
  to,
  quote,
  again,
  held: selected,
}: {
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  readonly quote: string;
  /** The thread id a refused start went under, whose field this opens again on the block it was measured on. */
  readonly again?: string | undefined;
  /** The key words selected in the description were kept under (`selectedSpans`). */
  readonly held?: string | undefined;
}) {
  const router = useRouter();
  const half = useSheetAtHalf();
  const overview = useTaskOverview(taskId);
  // Note that a link opens on the tabs under the sheet, closing it, since a push from inside the sheet would stand the tabs again inside it.
  const openLink = useOpenLink(overview?.task.workspaceId, LINK_OPENS.OUT_OF_SHEET);
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
    again !== undefined
      ? refusedBlocks.get(again)
      : selected === undefined
        ? undefined
        : selectedSpans.get(selected),
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
    router.replace({ pathname: COMMENT_ROUTE.THREAD, params: { id: threadId, task } });

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
      <CommentSheetBar path={path} half={half} />
      {block === undefined ? (
        <Screen clear={half}>{empty}</Screen>
      ) : (
        <GlassDock bar={<Composer {...composer} />}>
          <Screen clear={half}>{page}</Screen>
        </GlassDock>
      )}
    </>
  );
}
