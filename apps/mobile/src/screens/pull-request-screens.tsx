// pull-request-screens.tsx -- one agent's pull request on its own screen: where it stands, its checks and reviews held live, its merge or Remove from queue under its heading in every window, as the panel's head stands it, and Open on GitHub in the bar's ⋯.

import {
  type AgentOverviewPullRequest,
  CHECK_STATE,
  type PullRequestCheck,
} from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { pullRequestActivity } from "@repo/features/ios-system-activity";
import {
  CHECK_WORDS,
  checksCountOf,
  checksSummaryOf,
  conversationCount,
  isLivePullRequest,
  isMergeWrite,
  MERGE_ACTION,
  MERGE_BUSY_WORDS,
  MERGE_METHOD_WORDS,
  MERGE_PRESS_WORDS,
  MERGE_WORDS,
  type MergeAction,
  mergeActionFor,
  mergeSentence,
  PULL_REQUEST_READ_WORDS,
  PULL_REQUEST_STATE_LABEL,
  QUEUE_WARNING,
  queuedLabel,
  REVIEW_WORDS,
  reviewersOf,
} from "@repo/features/pull-request-model";
import {
  type MergeMethod,
  PULL_REQUEST_ACTION,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { workingTime } from "@repo/features/time-format";
import type { AppHostRead } from "@repo/host/app-state";
import {
  BAR_TITLE,
  BUZZ,
  buzz,
  CHECK_LOOK,
  CHECK_SUMMARY_LOOK,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  MarkRow,
  MergeActRow,
  PATH_PART,
  PUSH_ROW_GOES,
  PullRequestHead,
  REVIEW_LOOK,
  RowList,
  Screen,
  STATUS_TONE,
  useColors,
  WriteNoteRow,
} from "@repo/ui-native";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useAgentPullRequests, useFollowedAgent } from "../agents/use-agent.js";
import { openInSafari } from "../open-link.js";
import {
  type PullRequestKey,
  type PullRequestWrites,
  usePullRequestParts,
  usePullRequestRetry,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";

/** What the bar's ⋯ menu offers beside the merge, in the panel's words. */
const MENU_WORDS = {
  MORE: "More",
  COPY_GITHUB_LINK: "Copy GitHub link",
  OPEN_ON_GITHUB: "Open on GitHub",
  REFRESH: "Refresh",
  TRY_AGAIN: "Try again",
} as const;

/** The id the comments row stands under, beside the checks' and the reviewers'. */
const COMMENTS_ROW = "comments";

/** The least a check must have run to say how long, as the panel's checks say it. */
const RAN_AT_LEAST_MS = 1_000;

/** What a read holds once it landed; none while it is on its way or failed. */
function landedOf<Answer extends object>(
  read: AppHostRead<Answer> | undefined,
): Exclude<Answer, { failure: unknown }> | undefined {
  const rows = read?.rows;

  if (rows === undefined || "failure" in rows) return undefined;

  // SAFETY: an answer view is its answer or a failure, and the failure was ruled out above.
  return rows as Exclude<Answer, { failure: unknown }>;
}

/** Whether a read failed before any answer landed, which its place says rather than reading on for good. */
function failedOf(read: AppHostRead<object> | undefined): boolean {
  return read?.failed === true || (read?.rows !== undefined && "failure" in read.rows);
}

/** What ends a check's row: how long it ran, or where it stands where it ran for no time or runs still. */
function checkDetail(check: PullRequestCheck): string {
  if (
    check.state !== CHECK_STATE.PENDING &&
    check.startedAt !== null &&
    check.completedAt !== null
  ) {
    const ran = check.completedAt - check.startedAt;

    if (ran >= RAN_AT_LEAST_MS) return workingTime(ran);
  }

  return CHECK_WORDS[check.state];
}

/** Copies the pull request's GitHub address, with the system's tap of success, or says on the console why it could not. */
function copyLink(url: string): void {
  setStringAsync(url)
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The pull request's link could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
}

/** What a press asks before it sends: its question, and what the question says under it; the pull request by its number and title where it says nothing of its own. */
interface MergeAsk {
  readonly title: string;
  readonly message?: string | undefined;
}

/** A merge's question, the one a pull request's card asks too, so a merge asks the same wherever it is pressed. */
const MERGE_ASK: MergeAsk = { title: MERGE_WORDS.MERGE_QUESTION };

/** The merge's press as the pull request stands: its words, whether it is the screen's one prominent act, the change it sends, and what it asks first. */
interface MergePress {
  readonly words: string;
  readonly prominent: boolean;
  /** The change to send; none where the queue takes it out, as Remove from queue does. */
  readonly request: PullRequestActionRequest | undefined;
  /** What it asks before it sends; none where it only takes back what was asked for, as Disable auto-merge does. */
  readonly ask: MergeAsk | undefined;
}

/** The press for `action`, by the method chosen where it names one; none where it offers nothing, or names a method none is allowed. */
function mergePressOf(
  action: MergeAction | undefined,
  method: MergeMethod | undefined,
  headSha: string,
): MergePress | undefined {
  switch (action) {
    case MERGE_ACTION.MERGE:
      if (method === undefined) return undefined;

      return {
        words: MERGE_PRESS_WORDS[method],
        prominent: true,
        request: { action: PULL_REQUEST_ACTION.MERGE, method, headSha },
        ask: MERGE_ASK,
      };
    case MERGE_ACTION.ENABLE_AUTO_MERGE:
      if (method === undefined) return undefined;

      return {
        words: MERGE_WORDS.ENABLE_AUTO_MERGE,
        prominent: false,
        request: { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha },
        ask: MERGE_ASK,
      };
    case MERGE_ACTION.MERGE_WHEN_READY:
      return {
        words: MERGE_WORDS.MERGE_WHEN_READY,
        prominent: true,
        request: { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha },
        ask: MERGE_ASK,
      };
    case MERGE_ACTION.DISABLE_AUTO_MERGE:
      return {
        words: MERGE_WORDS.DISABLE_AUTO_MERGE,
        prominent: false,
        request: { action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE },
        ask: undefined,
      };
    case MERGE_ACTION.DEQUEUE:
      return {
        words: MERGE_WORDS.DEQUEUE,
        prominent: false,
        request: undefined,
        ask: { title: MERGE_WORDS.DEQUEUE_QUESTION, message: QUEUE_WARNING },
      };
    // Note that the page offers no bypass of the base's rules, which asks first; GitHub's own does.
    case MERGE_ACTION.BYPASS:
    case undefined:
      return undefined;
  }
}

/** The merge's press as a screen draws it: its words, busy in its own while a change is out, what it asks first, and what sends it once asked. */
interface ShownPress {
  readonly words: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  readonly ask: MergeAsk | undefined;
  readonly send: () => void;
}

/** The merge the pull request offers as it stands, by GitHub's live state; none where it isn't live. */
function offeredActionOf(
  pullRequest: AgentOverviewPullRequest | undefined,
): MergeAction | undefined {
  return pullRequest !== undefined && isLivePullRequest(pullRequest)
    ? mergeActionFor(pullRequest)
    : undefined;
}

/** The press the pull request offers as it stands, wherever the screen draws it; none where it offers nothing. */
function shownPressOf(
  pullRequest: AgentOverviewPullRequest | undefined,
  method: MergeMethod | undefined,
  writes: PullRequestWrites,
): ShownPress | undefined {
  const press = mergePressOf(
    offeredActionOf(pullRequest),
    method,
    pullRequest?.merging?.headSha ?? "",
  );

  if (press === undefined) return undefined;
  const pending = isMergeWrite(writes.pending) ? writes.pending : undefined;
  const { request } = press;

  return {
    words: pending === undefined ? press.words : MERGE_BUSY_WORDS[pending],
    prominent: press.prominent,
    disabled: writes.pending !== undefined,
    ask: press.ask,
    send: () => {
      void writes.write(request ?? { action: PULL_REQUEST_ACTION.DEQUEUE });
    },
  };
}

/** The ways to merge the pull request offers a choice of as it stands: the repository's, while its press merges or arms auto-merge; none otherwise. */
function methodsOffered(pullRequest: AgentOverviewPullRequest | undefined): readonly MergeMethod[] {
  const live = pullRequest !== undefined && isLivePullRequest(pullRequest);
  const action = live ? mergeActionFor(pullRequest) : undefined;
  const chooses = action === MERGE_ACTION.MERGE || action === MERGE_ACTION.ENABLE_AUTO_MERGE;

  return chooses ? (pullRequest?.merging?.methods ?? []) : [];
}

/**
 * The bar's one act, the ⋯ menu, grouped as the panel's and Mail's are:
 * Copy GitHub link and Open on GitHub, then Refresh. The merge stands in
 * the page under the heading, where the panel's head stands it, so the
 * bar's title keeps its place.
 */
function PullRequestToolbar({
  url,
  onRefresh,
}: {
  readonly url: string | undefined;
  readonly onRefresh: () => void;
}) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={MENU_WORDS.MORE}>
        {url === undefined ? null : (
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.LINK)} onPress={() => copyLink(url)}>
              {MENU_WORDS.COPY_GITHUB_LINK}
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon={glyphSymbol(GLYPH.OPEN_EXTERNALLY)}
              onPress={() => openInSafari(url)}
            >
              {MENU_WORDS.OPEN_ON_GITHUB}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
        <Stack.Toolbar.Menu inline>
          <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.RETRY)} onPress={onRefresh}>
            {MENU_WORDS.REFRESH}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/**
 * One agent's pull request, by the agent and its number, on a screen of its
 * own: its path in the bar, the repository and its number, small and muted;
 * its heading, where it stands as the panel's pill says it and its
 * branches, with GitHub's sentence of whether it merges; its checks, how
 * they went counted beside their heading, each with how long it ran and
 * opening its run on GitHub; and its reviewers, where each stands, with
 * how many comments its conversation holds, which opens it on GitHub. Its
 * parts are held live while the screen is in focus, and a pull down reads
 * them again. The merge's one press merges, or arms auto-merge where the
 * repository merges through a queue, once its question is answered, as a
 * pull request's card on the agent page asks it, so a merge asks the same
 * wherever it is pressed; Remove from queue asks first too, as the
 * panel's does, and Disable auto-merge, which only takes back, doesn't. It stands
 * under the heading in every window, as wide as its words, as the panel's
 * head stands Merge under the title, and as a split button where the
 * repository merges more than one way.
 * The bar's ⋯ menu opens it on GitHub, where its diff and comments are
 * read.
 */
export function PullRequestScreen() {
  const { id = "", number = "" } = useLocalSearchParams<{ id: string; number: string }>();
  const key: PullRequestKey = { agentId: id, number: Number(number) };
  useSurfaceOpen(PRODUCT_SURFACE.PULL_REQUEST, number);
  const colors = useColors();
  const agent = useFollowedAgent(id);
  const listed = useAgentPullRequests(id).find((each) => each.number === key.number);
  const parts = usePullRequestParts(key);
  const retry = usePullRequestRetry(key);
  const writes = usePullRequestWrites(key);
  const [chosen, setChosen] = useState<MergeMethod | undefined>(undefined);
  // The merge whose question stands, by what the pull request offered when it was pressed.
  const [asked, setAsked] = useState<MergeAction | undefined>(undefined);
  const pullRequest = landedOf(parts.pullRequest)?.pullRequest ?? undefined;
  const checks = landedOf(parts.checks)?.pullRequest?.checks;
  const conversation = landedOf(parts.conversation)?.pullRequest ?? undefined;
  const methods = pullRequest?.merging?.methods ?? [];
  // Note that the method chosen stands while the repository still allows it, else the first it allows, as the panel's does.
  const method = chosen !== undefined && methods.includes(chosen) ? chosen : methods[0];
  const queued = pullRequest?.merging?.queued ?? null;
  const title = pullRequest?.title ?? listed?.title;
  const state = pullRequest?.state ?? listed?.state;
  const url = pullRequest?.url ?? listed?.url;
  const press = shownPressOf(pullRequest, method, writes);
  const offered = offeredActionOf(pullRequest);

  // Note that a question is dropped as soon as the pull request no longer offers what it asks about, rather than only when its alert says it went, so it never stands again by itself the next time it offers that.
  useEffect(() => {
    if (asked !== offered) setAsked(undefined);
  }, [asked, offered]);
  useScreenActivity((workspaces) =>
    agent === undefined || title === undefined
      ? undefined
      : pullRequestActivity(
          {
            agentId: id,
            workspaceId: agent.workspaceId,
            taskId: agent.planId,
            number: key.number,
            title,
          },
          workspaces,
        ),
  );
  const path = [...(agent?.repository == null ? [] : [agent.repository]), `#${key.number}`];

  const bar = (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      <PullRequestToolbar url={url} onRefresh={() => void retry()} />
    </>
  );

  if (title === undefined || state === undefined) {
    const failed = failedOf(parts.pullRequest);

    return (
      <>
        {bar}
        <Screen>
          <EmptyState
            title={failed ? PULL_REQUEST_READ_WORDS.FAILED : PULL_REQUEST_READ_WORDS.READING}
            symbol={failed ? GLYPH.FAILED : GLYPH.PULL_REQUEST}
            loading={!failed}
            action={
              failed ? { label: MENU_WORDS.TRY_AGAIN, onPress: () => void retry() } : undefined
            }
          />
        </Screen>
      </>
    );
  }

  const action = pullRequest === undefined ? undefined : mergeActionFor(pullRequest);
  const summary = checks === undefined ? undefined : checksSummaryOf(checks);

  const reviewers =
    pullRequest === undefined
      ? []
      : reviewersOf(
          pullRequest.requested,
          conversation?.reviewers ?? [],
          pullRequest.author?.login,
        );

  // Each row a press opens, by its id: a check's run, and the conversation, on GitHub.
  const opens = new Map<string, string>();

  for (const check of checks ?? []) {
    if (check.url !== null) opens.set(check.url, check.url);
  }

  if (url !== undefined) opens.set(COMMENTS_ROW, url);

  return (
    <>
      {bar}
      <Screen>
        <RowList
          look={LIST_LOOK.PLAIN}
          onSelect={(row) => {
            const address = opens.get(row);

            if (address !== undefined) openInSafari(address);
          }}
          onRefresh={retry}
        >
          <ListSection>
            <PullRequestHead
              title={title}
              number={key.number}
              state={state}
              queued={queued !== null || (pullRequest === undefined && listed?.queued === true)}
              stateLabel={
                queued !== null ? queuedLabel(queued.position) : PULL_REQUEST_STATE_LABEL[state]
              }
              branches={
                pullRequest === undefined
                  ? undefined
                  : { base: pullRequest.base, head: pullRequest.head }
              }
              sentence={
                pullRequest !== undefined && isLivePullRequest(pullRequest)
                  ? mergeSentence(pullRequest, action, { queueShown: true })
                  : undefined
              }
            />
            {press === undefined ? null : (
              <MergeActRow
                label={press.words}
                prominent={press.prominent}
                disabled={press.disabled}
                methods={methodsOffered(pullRequest).map((each) => ({
                  label: MERGE_METHOD_WORDS[each],
                  on: each === method,
                  onPress: () => setChosen(each),
                }))}
                onPress={() => {
                  if (press.ask === undefined) press.send();
                  else setAsked(offered);
                }}
              />
            )}
            {writes.note === undefined ? null : (
              <WriteNoteRow words={writes.note.words} said={writes.note.said} />
            )}
          </ListSection>
          <ListSection
            title="Checks"
            count={
              checks === undefined || summary === undefined
                ? undefined
                : checksCountOf(checks, summary)
            }
            mark={summary === undefined ? undefined : CHECK_SUMMARY_LOOK[summary]}
          >
            {checks === undefined ? (
              <MarkRow
                id="checks-reading"
                mark={CHECK_LOOK[CHECK_STATE.PENDING]}
                title={
                  failedOf(parts.checks)
                    ? PULL_REQUEST_READ_WORDS.CHECKS_FAILED
                    : PULL_REQUEST_READ_WORDS.READING_CHECKS
                }
              />
            ) : checks.length === 0 ? (
              <MarkRow
                id="checks-none"
                mark={CHECK_LOOK[CHECK_STATE.SKIPPED]}
                title={PULL_REQUEST_READ_WORDS.NO_CHECKS}
              />
            ) : (
              checks.map((check) => (
                <MarkRow
                  key={check.url ?? check.name}
                  id={check.url ?? check.name}
                  mark={CHECK_LOOK[check.state]}
                  said={CHECK_WORDS[check.state]}
                  title={check.name}
                  detail={checkDetail(check)}
                  goes={check.url === null ? undefined : PUSH_ROW_GOES.OUT}
                />
              ))
            )}
          </ListSection>
          <ListSection title="Reviews" count={reviewers.length}>
            {reviewers.map((reviewer) => (
              <MarkRow
                key={reviewer.by.login}
                id={reviewer.by.login}
                mark={REVIEW_LOOK[reviewer.state]}
                title={reviewer.by.login}
                detail={REVIEW_WORDS[reviewer.state]}
              />
            ))}
            <MarkRow
              id={COMMENTS_ROW}
              mark={{ symbol: GLYPH.THREAD, tone: STATUS_TONE.NEUTRAL }}
              title={
                conversation === undefined
                  ? failedOf(parts.conversation)
                    ? PULL_REQUEST_READ_WORDS.CONVERSATION_FAILED
                    : PULL_REQUEST_READ_WORDS.READING_CONVERSATION
                  : PULL_REQUEST_READ_WORDS.commentCount(conversationCount(conversation))
              }
              goes={url === undefined ? undefined : PUSH_ROW_GOES.OUT}
            />
          </ListSection>
        </RowList>
      </Screen>
      <ConfirmAsk
        title={press?.ask?.title ?? MERGE_WORDS.MERGE_QUESTION}
        message={press?.ask?.message ?? `#${key.number} ${title}`}
        act={press?.words ?? ""}
        presented={asked !== undefined && asked === offered && press?.ask !== undefined}
        onAct={() => {
          setAsked(undefined);
          press?.send();
        }}
        onDismiss={() => setAsked(undefined)}
      />
    </>
  );
}
