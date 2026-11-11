// comment-screens.tsx -- one thread of a task's description comments, pushed from the task's Overview: its comments as a thread's messages, the words it stands on as its heading, and the reply field docked at its foot.

import { agentName } from "@repo/features/model-label";
import { taskKey } from "@repo/features/workspace-key";
import {
  AskNote,
  BAR_TITLE,
  Composer,
  EmptyState,
  GlassDock,
  PATH_PART,
  Screen,
  ThreadPage,
  useColors,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useOpenLink } from "../open-link.js";
import {
  threadMessages,
  threadOpen,
  useCommentReply,
  useTaskComments,
} from "../tasks/use-comments.js";
import { useTaskOverview } from "../tasks/use-tasks.js";

/** The panel's words for a thread: what its field says before anything is typed, how a resolved one ended, and what stands for words since deleted. */
const WORDS = {
  REPLY: "Reply",
  RESOLVED: "Resolved",
  GONE: "Original content deleted",
  NOT_FOUND: "Comment not found",
} as const;

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
  const agentNames = new Map(
    (overview?.agents ?? []).map(({ agent }) => [agent.id, agentName(agent)] as const),
  );
  const task = overview?.task;
  const key =
    task?.number === undefined || overview?.workspace === undefined
      ? undefined
      : taskKey(overview.workspace.name, task.number);
  const path = [task?.name, key].filter((step): step is string => step !== undefined);
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
          <EmptyState title={WORDS.NOT_FOUND} symbol="text.bubble" />
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
              messages={threadMessages(thread, agentNames)}
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
