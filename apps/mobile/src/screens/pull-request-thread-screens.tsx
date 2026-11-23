// pull-request-thread-screens.tsx -- a pull request's review thread on a screen of its own, pushed from its row in the conversation: its comments as a thread's messages, its file and lines as the heading, Resolve or Reopen in the bar, and the reply field docked at its foot; and a new comment on the pull request, its field docked under the pull request's title.

import { PULL_REQUEST_PART } from "@repo/features/agent-view";
import type { ReviewThread } from "@repo/features/agent-wire";
import {
  PULL_REQUEST_READ_WORDS,
  reactionsLine,
  THREAD_ACT_WORDS,
  THREAD_STATE_WORDS,
  threadLineSpan,
} from "@repo/features/pull-request-model";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { answerFailed, landedAnswer } from "@repo/host/app-state-reads";
import {
  AskNote,
  BAR_TITLE,
  Composer,
  EmptyState,
  GLYPH,
  GlassDock,
  githubFace,
  glyphSymbol,
  PATH_PART,
  Screen,
  type ThreadMessage,
  ThreadPage,
  useColors,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useOpenLink } from "../open-link.js";
import { reactionMenu } from "../pull-requests/reaction-menu.js";
import {
  type PullRequestKey,
  type PullRequestWrites,
  usePullRequestParts,
  usePullRequestRetry,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";

/** The parts these screens hold live: the pull request, for its title, and its conversation, for its threads. */
const THREAD_PARTS = [PULL_REQUEST_PART.PULL_REQUEST, PULL_REQUEST_PART.CONVERSATION] as const;

/** What the screens say beyond the thread's own words. */
const WORDS = {
  COMMENT: "Comment",
  NO_THREAD: "This thread is no longer on the pull request.",
} as const;

/** The pull request a route names, by its workspace, its repository's owner and name, and its number. */
function useRouteKey(): PullRequestKey {
  const {
    workspace = "",
    owner = "",
    name = "",
    number = "",
  } = useLocalSearchParams<{ workspace: string; owner: string; name: string; number: string }>();

  return { workspaceId: workspace, repository: `${owner}/${name}`, number: Number(number) };
}

/** The review thread of `threads` GitHub names by `id`, wherever a review holds it. */
function threadById(
  entries: readonly { readonly threads?: readonly ReviewThread[] | undefined }[],
  id: string,
): ReviewThread | undefined {
  for (const entry of entries) {
    const found = entry.threads?.find((thread) => thread.id === id);

    if (found !== undefined) return found;
  }

  return undefined;
}

/** A thread's comments as a thread's messages, oldest first: who wrote each by their GitHub face, when, their words as written, and the reactions each wears, with Add reaction in its long press menu. */
function threadMessagesOf(
  thread: ReviewThread,
  writes: PullRequestWrites,
): readonly ThreadMessage[] {
  return thread.comments.map((comment) => ({
    id: comment.url,
    writer: { ...githubFace(comment.by), agent: false },
    at: comment.at,
    words: comment.markdown ?? comment.body,
    typed: false,
    media: [],
    reactions: reactionsLine(comment.reactions ?? []),
    menu: [reactionMenu(comment.subject, comment.reactions, writes)],
  }));
}

/** A field's words held while it is written, sent once by `send`, and cleared once the send went. */
function useField(send: (body: string) => Promise<boolean>, busy: boolean) {
  const [words, setWords] = useState("");
  const body = words.trim();

  return {
    words,
    onWords: setWords,
    sendable: body !== "" && !busy,
    onSend: () => {
      void send(body).then((went) => {
        if (went) setWords("");
      });
    },
  };
}

/**
 * One review thread of a pull request, by GitHub's id for it, pushed from
 * its row in the page's conversation, as a task's description thread is
 * pushed from its block: its comments as a thread's messages, each by who
 * wrote it on GitHub and in Markdown, its file and lines heading the page,
 * Resolved under them where it is, the bar's trailing button resolving it
 * or opening it again, and the reply field docked at its foot. A reply is
 * one change on GitHub on the member's own sign-in (`REPLY_TO_THREAD`), its
 * field cleared once it went, and GitHub's refusal standing in the field's
 * head in its own words. The thread is held live while the screen is in
 * front, so a reply or a resolve made anywhere lands on it.
 */
export function PullRequestThreadScreen() {
  const key = useRouteKey();
  const { threadId = "" } = useLocalSearchParams<{ threadId: string }>();
  const colors = useColors();
  const openLink = useOpenLink(key.workspaceId);
  const parts = usePullRequestParts(key, THREAD_PARTS);
  const retry = usePullRequestRetry(key);
  const writes = usePullRequestWrites(key);
  const conversation = landedAnswer(parts.conversation)?.pullRequest ?? undefined;
  const path = [key.repository, `#${key.number}`];

  const thread =
    conversation === undefined ? undefined : threadById(conversation.conversation, threadId);

  const lines = thread === undefined ? undefined : threadLineSpan(thread);

  const field = useField(
    (body) => writes.write({ action: PULL_REQUEST_ACTION.REPLY_TO_THREAD, threadId, body }),
    writes.pending !== undefined,
  );

  const settle = () => {
    if (thread === undefined) return;

    void writes.write({
      action: thread.resolved
        ? PULL_REQUEST_ACTION.UNRESOLVE_THREAD
        : PULL_REQUEST_ACTION.RESOLVE_THREAD,
      threadId,
    });
  };

  const empty =
    conversation === undefined ? (
      answerFailed(parts.conversation) ? (
        <EmptyState
          title={PULL_REQUEST_READ_WORDS.CONVERSATION_FAILED}
          symbol={GLYPH.FAILED}
          retry={() => void retry()}
        />
      ) : (
        <EmptyState
          title={PULL_REQUEST_READ_WORDS.READING_CONVERSATION}
          symbol={GLYPH.THREAD}
          loading
        />
      )
    ) : (
      <EmptyState title={WORDS.NO_THREAD} symbol={GLYPH.THREAD} />
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
            icon={glyphSymbol(thread.resolved ? GLYPH.RESTORE : GLYPH.CHECK)}
            accessibilityLabel={
              thread.resolved ? THREAD_ACT_WORDS.REOPEN : THREAD_ACT_WORDS.RESOLVE
            }
            disabled={writes.pending !== undefined}
            onPress={settle}
          />
        </Stack.Toolbar>
      )}
      {thread === undefined ? (
        <Screen>{empty}</Screen>
      ) : (
        <GlassDock
          bar={
            <Composer
              placeholder={THREAD_ACT_WORDS.REPLY}
              {...field}
              head={writes.note === undefined ? undefined : <AskNote words={writes.note.words} />}
            />
          }
        >
          <Screen>
            <ThreadPage
              path={path}
              title={lines === undefined ? thread.path : `${thread.path} ${lines}`}
              messages={threadMessagesOf(thread, writes)}
              repository={key.repository}
              onOpenLink={openLink}
              standing={thread.resolved ? THREAD_STATE_WORDS.RESOLVED : undefined}
            />
          </Screen>
        </GlassDock>
      )}
    </>
  );
}

/**
 * A new comment on a pull request, at the foot of its conversation, as
 * GitHub's own box stands there: the pull request's title heading the
 * page and the comment field docked under it, taking the keyboard. A send
 * is one change on GitHub on the member's own sign-in (`COMMENT`), which
 * goes back to the pull request once it went, the comment standing in its
 * conversation as the page reads it again; GitHub's refusal stands in the
 * field's head in its own words, the words kept.
 */
export function PullRequestCommentScreen() {
  const key = useRouteKey();
  const colors = useColors();
  const router = useRouter();
  const openLink = useOpenLink(key.workspaceId);
  const parts = usePullRequestParts(key, THREAD_PARTS);
  const writes = usePullRequestWrites(key);
  const title = landedAnswer(parts.pullRequest)?.pullRequest?.title ?? `#${key.number}`;
  const path = [key.repository, `#${key.number}`];

  const field = useField(
    (body) =>
      writes.write({ action: PULL_REQUEST_ACTION.COMMENT, body }).then((went) => {
        if (went) router.back();

        return went;
      }),
    writes.pending !== undefined,
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      <GlassDock
        bar={
          <Composer
            placeholder={WORDS.COMMENT}
            {...field}
            head={writes.note === undefined ? undefined : <AskNote words={writes.note.words} />}
          />
        }
      >
        <Screen>
          <ThreadPage
            path={path}
            title={title}
            messages={[]}
            repository={key.repository}
            onOpenLink={openLink}
          />
        </Screen>
      </GlassDock>
    </>
  );
}
