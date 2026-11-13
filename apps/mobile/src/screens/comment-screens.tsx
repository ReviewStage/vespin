// comment-screens.tsx -- one thread of a task's description comments, pushed from the task's Overview: its comments as a thread's messages, the words it stands on as its heading, and the reply field docked at its foot; and a new thread on one block of the description, its words as the heading and the comment field docked under them.

import { type DescriptionBlock, descriptionBlocks } from "@repo/features/description-blocks";
import { COMMENT_NOTE } from "@repo/features/description-comment-notes";
import { agentName } from "@repo/features/model-label";
import { readingWords } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import {
  AskNote,
  BAR_TITLE,
  Composer,
  EmptyState,
  GLYPH,
  GlassDock,
  NOTICE_KIND,
  PATH_PART,
  Screen,
  ThreadPage,
  useColors,
  useFailureNotices,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useMemberPictures } from "../member-pictures.js";
import { useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import {
  type RefusedStart,
  threadMessages,
  threadOpen,
  useCommentReply,
  useCommentStart,
  useTaskComments,
} from "../tasks/use-comments.js";
import { type TaskOverview, useTaskOverview } from "../tasks/use-tasks.js";

/** The panel's words for a thread: what its field says before anything is typed, how a resolved one ended, and what stands for words since deleted. */
const WORDS = {
  REPLY: "Reply",
  ADD_COMMENT: "Add a comment",
  RESOLVED: "Resolved",
  GONE: "Original content deleted",
  NOT_FOUND: "Comment not found",
} as const;

/** What the description is called while it is first read. */
const READING_DESCRIPTION = readingWords("the description");

/**
 * The threads whose page stands on some tab, by their ids. Note that a new
 * thread opens before the service has taken it, so a refusal reopens its
 * field only where the person still looks at it, and says so in the failure
 * notice anywhere else.
 */
const standingThreads = new Set<string>();

/** A refused start, as the route that reopens its field carries it; none where the route names none. */
function refusedOf(params: {
  readonly words?: string;
  readonly note?: string;
  readonly key?: string;
  readonly thread?: string;
}): RefusedStart | undefined {
  const { words, note, key, thread } = params;

  return words === undefined || note === undefined || key === undefined || thread === undefined
    ? undefined
    : { words, note, key, threadId: thread };
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
 * the bar, as a page of the task's does.
 */
export function CommentThreadScreen() {
  const { id = "", task: taskId = "" } = useLocalSearchParams<{ id: string; task: string }>();
  const colors = useColors();
  const openLink = useOpenLink();
  const overview = useTaskOverview(taskId);
  const threads = useTaskComments(overview?.task.id);
  const thread = threads.find((each) => each.id === id);
  const reply = useCommentReply(taskId, id);
  const pictureOf = useMemberPictures();

  useEffect(() => {
    standingThreads.add(id);

    return () => {
      standingThreads.delete(id);
    };
  }, [id]);

  const agentNames = new Map(
    (overview?.agents ?? []).map(({ agent }) => [agent.id, agentName(agent)] as const),
  );

  const task = overview?.task;
  const path = commentPath(overview);

  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {thread === undefined ? (
        <Screen>
          <EmptyState title={WORDS.NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
        </Screen>
      ) : (
        <GlassDock
          bar={
            <Composer
              placeholder={WORDS.REPLY}
              words={reply.words}
              onWords={reply.onWords}
              sendable={reply.sendable}
              onSend={reply.send}
              head={reply.note === undefined ? undefined : <AskNote words={reply.note} />}
            />
          }
        >
          <Screen>
            <ThreadPage
              path={path}
              status={task?.status}
              title={quoteOf(thread.quote, thread.anchor !== undefined)}
              messages={threadMessages(thread, agentNames, pictureOf)}
              repository={task?.repository}
              onOpenLink={openLink}
              standing={threadOpen(thread) ? undefined : WORDS.RESOLVED}
            />
          </Screen>
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
  const params = useLocalSearchParams<{
    task: string;
    from: string;
    to: string;
    quote: string;
    words?: string;
    note?: string;
    key?: string;
    thread?: string;
  }>();

  const { task: taskId = "", from = "", to = "", quote = "" } = params;

  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const colors = useColors();
  const openLink = useOpenLink();
  const overview = useTaskOverview(taskId);
  const body = overview?.document?.document.body ?? "";

  // Note that the block must still quote the words it was opened on, so an edit that put other words at the same offsets before this read finds nothing rather than the wrong block.
  const found = useMemo(
    () =>
      descriptionBlocks(body).find(
        (each) => `${each.from}` === from && `${each.to}` === to && each.quote === quote,
      ),
    [body, from, to, quote],
  );

  // Note that the block is kept as it stood when first found, with the text it was measured in, because an edit elsewhere moves its offsets while it is being commented on, and the service carries a span measured in that text over to the text as it stands.
  const [held, setHeld] = useState<{ readonly text: string; readonly block: DescriptionBlock }>();

  if (held === undefined && found !== undefined) setHeld({ text: body, block: found });
  const block = held?.block;
  const [again] = useState(() => refusedOf(params));
  const notices = useFailureNotices();
  const start = useCommentStart(overview?.task.id ?? taskId, held?.text ?? body, block, again);
  const path = commentPath(overview);
  const task = overview?.task.id ?? taskId;

  // Note that the start is a declared write, drawn under its own id at once, so its thread opens in this screen's place as it goes; a refusal reopens this field on the words, under the same key, where the thread still stands in front.
  const send = () => {
    const threadId = start.send((refused) => {
      if (!standingThreads.has(refused.threadId)) {
        notices.say({ kind: NOTICE_KIND.REFUSED, words: refused.note });

        return;
      }

      router.replace({
        pathname: onOwnTab("/tasks/comments/new"),
        params: {
          task,
          from,
          to,
          quote,
          words: refused.words,
          note: refused.note,
          key: refused.key,
          thread: refused.threadId,
        },
      });
    });

    if (threadId === undefined) return;
    router.replace({ pathname: onOwnTab("/tasks/comments/[id]"), params: { id: threadId, task } });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {block === undefined ? (
        <Screen>
          <EmptyState
            title={overview?.document === undefined ? READING_DESCRIPTION : COMMENT_NOTE.NO_WORDS}
            symbol={GLYPH.COMMENT}
          />
        </Screen>
      ) : (
        <GlassDock
          bar={
            <Composer
              placeholder={WORDS.ADD_COMMENT}
              autoFocus
              words={start.words}
              onWords={start.onWords}
              sendable={start.sendable}
              onSend={send}
              head={start.note === undefined ? undefined : <AskNote words={start.note} />}
            />
          }
        >
          <Screen>
            <ThreadPage
              path={path}
              status={overview?.task.status}
              title={quoteOf(block.quote ?? "", true)}
              messages={[]}
              repository={overview?.task.repository}
              onOpenLink={openLink}
            />
          </Screen>
        </GlassDock>
      )}
    </>
  );
}
