// comment-screens.tsx -- one thread of a task's description comments, pushed from the task's Overview: its comments as a thread's messages, the words it stands on as its heading, and the reply field docked at its foot; and a new thread on one block of the description, its words as the heading and the comment field docked under them.

import { type DescriptionBlock, descriptionBlocks } from "@repo/features/description-blocks";
import { COMMENT_NOTE } from "@repo/features/description-comment-notes";
import { agentName } from "@repo/features/model-label";
import { readFailedWords, readingWords } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import {
  AskNote,
  BAR_TITLE,
  BUTTON_LOOK,
  Composer,
  EmptyState,
  GLYPH,
  GlassDock,
  PATH_PART,
  Screen,
  ThreadPage,
  useColors,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useMemberPictures } from "../member-pictures.js";
import { useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";
import {
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

/** What the page says where the description could not be read, beside Try again. */
const DESCRIPTION_UNREAD = readFailedWords("the description");

/** What a failed read offers. */
const TRY_AGAIN = "Try again";

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
 * this screen's place, as a document's comment opens its thread once
 * posted. A send that did not land keeps its
 * words and says why in the field's head. The block is kept as it stood
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
  } = useLocalSearchParams<{ task: string; from: string; to: string; quote: string }>();

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
  const start = useCommentStart(overview?.task.id ?? taskId, held?.text ?? body, block);
  const path = commentPath(overview);

  const send = () => {
    void start.send().then((threadId) => {
      if (threadId === undefined) return;
      router.replace({
        pathname: onOwnTab("/tasks/comments/[id]"),
        params: { id: threadId, task: overview?.task.id ?? taskId },
      });
    });
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
          <BlockState overview={overview} />
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
