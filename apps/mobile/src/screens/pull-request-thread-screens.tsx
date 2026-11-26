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
import {
  PULL_REQUEST_ACTION,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@repo/features/pull-request-write-wire";
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
  ScopePicker,
  type ThreadMessage,
  ThreadPage,
  useColors,
  wordsHandedBack,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useOpenLink } from "../open-link.js";
import { PR_MOCKUP, prMockup } from "../rig-pr-mockup.js";
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

/** A field's words held while it is written, sent once by `send` as Send took them out of the field, and laid back, ahead of anything typed since, where the send did not go. */
function useField(send: (body: string) => Promise<boolean>, busy: boolean) {
  const [words, setWords] = useState("");

  return {
    words,
    onWords: setWords,
    sendable: words.trim() !== "" && !busy,
    onSend: (typed: string) => {
      const body = typed.trim();

      if (body === "" || busy) return false;
      void send(body).then((went) => {
        if (!went) setWords((now) => wordsHandedBack(typed, now));
      });

      return true;
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
 * words taken out of the field as Send is pressed and laid back where GitHub
 * refused them, its refusal standing in the field's head in its own words. The thread is held live while the screen is in
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
          >
            {thread.resolved ? THREAD_ACT_WORDS.REOPEN : THREAD_ACT_WORDS.RESOLVE}
          </Stack.Toolbar.Button>
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

  if (prMockup() === PR_MOCKUP.REVIEW) return <RigReviewScreen />;

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

/** RIG ONLY: what the review page says, the panel's own words (`pull-request-review.tsx`). */
const RIG_REVIEW_WORDS = {
  TITLE: "Finish your review",
  LEGEND: "What the review says",
  LEAD: "Submitted on GitHub as you.",
} as const;

/** RIG ONLY: the review's choices, in the order GitHub's own review box and the panel's offer them. */
const RIG_REVIEW_EVENTS: readonly { readonly event: ReviewEvent; readonly label: string }[] = [
  { event: REVIEW_EVENT.COMMENT, label: "Comment" },
  { event: REVIEW_EVENT.APPROVE, label: "Approve" },
  { event: REVIEW_EVENT.REQUEST_CHANGES, label: "Request changes" },
];

/** RIG ONLY: the field's prompt by what the review says, as the panel's. */
function rigReviewPlaceholder(event: ReviewEvent): string {
  return event === REVIEW_EVENT.REQUEST_CHANGES
    ? "Summarize the requested changes"
    : "Leave a summary comment (optional)";
}

/**
 * RIG ONLY, proposal "Review": the panel's Finish your review on its own
 * page, pushed from the bar's Review: what the review says as the system's
 * segmented control over the pull request's title, and its summary in the
 * comment field docked at the foot, which may go empty for an approval.
 */
function RigReviewScreen() {
  const key = useRouteKey();
  const colors = useColors();
  const router = useRouter();
  const openLink = useOpenLink(key.workspaceId);
  const parts = usePullRequestParts(key, THREAD_PARTS);
  const writes = usePullRequestWrites(key);
  const [event, setEvent] = useState<ReviewEvent>(REVIEW_EVENT.APPROVE);
  const title = landedAnswer(parts.pullRequest)?.pullRequest?.title ?? `#${key.number}`;

  const field = useField(
    (body) =>
      writes.write({ action: PULL_REQUEST_ACTION.SUBMIT_REVIEW, event, body }).then((went) => {
        if (went) router.back();

        return went;
      }),
    writes.pending !== undefined,
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: RIG_REVIEW_WORDS.TITLE,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <GlassDock
        bar={
          <Composer
            placeholder={rigReviewPlaceholder(event)}
            {...field}
            sendable={writes.pending === undefined && (event === REVIEW_EVENT.APPROVE || field.sendable)}
            head={writes.note === undefined ? undefined : <AskNote words={writes.note.words} />}
          />
        }
      >
        <Screen>
          <ScopePicker
            label={RIG_REVIEW_WORDS.LEGEND}
            scopes={RIG_REVIEW_EVENTS.map((each) => ({
              label: each.label,
              selected: each.event === event,
              onPress: () => setEvent(each.event),
            }))}
          >
            <ThreadPage
              path={[key.repository, `#${key.number}`]}
              title={title}
              messages={[]}
              repository={key.repository}
              onOpenLink={openLink}
              standing={RIG_REVIEW_WORDS.LEAD}
            />
          </ScopePicker>
        </Screen>
      </GlassDock>
    </>
  );
}
