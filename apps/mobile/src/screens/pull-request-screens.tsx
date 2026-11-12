// pull-request-screens.tsx -- one agent's pull request on its own screen: where it stands, its checks and reviews held live, its merge or Remove from queue in the bar or, in a regular window, under its checks, and Open on GitHub in the bar.

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
  CHECK_LOOK,
  CHECK_SUMMARY_LOOK,
  ConfirmAsk,
  EmptyState,
  LIST_LOOK,
  ListSection,
  MarkRow,
  MergeActRow,
  PATH_PART,
  PullRequestHead,
  REVIEW_LOOK,
  RowList,
  Screen,
  STATUS_TONE,
  useColors,
  WriteNoteRow,
} from "@repo/ui-native";
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
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

/** What the bar's ⋯ menu offers beside the merge. */
const MENU_WORDS = {
  MORE: "More",
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

/** The press the bar offers as the pull request stands: its words, whether it is the screen's one prominent act, and the change it sends. */
interface MergePress {
  readonly words: string;
  readonly prominent: boolean;
  /** The change to send; none where it asks first, as Remove from queue does. */
  readonly request: PullRequestActionRequest | undefined;
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
      };
    case MERGE_ACTION.ENABLE_AUTO_MERGE:
      if (method === undefined) return undefined;

      return {
        words: MERGE_WORDS.ENABLE_AUTO_MERGE,
        prominent: false,
        request: { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha },
      };
    case MERGE_ACTION.MERGE_WHEN_READY:
      return {
        words: MERGE_WORDS.MERGE_WHEN_READY,
        prominent: true,
        request: { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha },
      };
    case MERGE_ACTION.DISABLE_AUTO_MERGE:
      return {
        words: MERGE_WORDS.DISABLE_AUTO_MERGE,
        prominent: false,
        request: { action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE },
      };
    case MERGE_ACTION.DEQUEUE:
      return { words: MERGE_WORDS.DEQUEUE, prominent: false, request: undefined };
    // Note that the bar offers no bypass of the base's rules, which asks first; GitHub's own does.
    case MERGE_ACTION.BYPASS:
    case undefined:
      return undefined;
  }
}

/** The merge's press as a screen draws it: its words, busy in its own while a change is out, and what a tap does. */
interface ShownPress {
  readonly words: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** The press the pull request offers as it stands, wherever the screen draws it; none where it offers nothing. */
function shownPressOf(
  pullRequest: AgentOverviewPullRequest | undefined,
  method: MergeMethod | undefined,
  writes: PullRequestWrites,
  onDequeue: () => void,
): ShownPress | undefined {
  const live = pullRequest !== undefined && isLivePullRequest(pullRequest);
  const action = live ? mergeActionFor(pullRequest) : undefined;
  const press = mergePressOf(action, method, pullRequest?.merging?.headSha ?? "");

  if (press === undefined) return undefined;
  const pending = isMergeWrite(writes.pending) ? writes.pending : undefined;
  const { request } = press;

  return {
    words: pending === undefined ? press.words : MERGE_BUSY_WORDS[pending],
    prominent: press.prominent,
    disabled: writes.pending !== undefined,
    onPress: () => {
      if (request === undefined) onDequeue();
      else void writes.write(request);
    },
  };
}

/**
 * The bar's acts: the merge's one press where the screen hands it one, and
 * the ⋯ menu, which opens the pull request on GitHub, chooses how to merge
 * where the repository allows more than one way, and reads it again.
 */
function PullRequestToolbar({
  pullRequest,
  url,
  press,
  method,
  onChoose,
  onRefresh,
}: {
  readonly pullRequest: AgentOverviewPullRequest | undefined;
  readonly url: string | undefined;
  readonly press: ShownPress | undefined;
  readonly method: MergeMethod | undefined;
  readonly onChoose: (method: MergeMethod) => void;
  readonly onRefresh: () => void;
}) {
  const colors = useColors();
  const live = pullRequest !== undefined && isLivePullRequest(pullRequest);
  const action = live ? mergeActionFor(pullRequest) : undefined;
  const methods = pullRequest?.merging?.methods ?? [];

  const chooses =
    methods.length > 1 &&
    (action === MERGE_ACTION.MERGE || action === MERGE_ACTION.ENABLE_AUTO_MERGE);

  // Note that these stand in the top bar in every window, never the bottom: expo-router shows a navigation controller's toolbar and never hides it again, so a bottom bar outlived the page. A regular window hands no press, since its top bar folds it into More, and draws it under the checks instead.
  return (
    <Stack.Toolbar placement="right">
      {press === undefined ? null : (
        <Stack.Toolbar.Button
          variant={press.prominent ? "prominent" : "plain"}
          tintColor={press.prominent ? colors.ACCENT : colors.TEXT}
          disabled={press.disabled}
          onPress={press.onPress}
        >
          {press.words}
        </Stack.Toolbar.Button>
      )}
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={MENU_WORDS.MORE}>
        {url === undefined ? null : (
          <Stack.Toolbar.MenuAction icon="safari" onPress={() => openInSafari(url)}>
            {MENU_WORDS.OPEN_ON_GITHUB}
          </Stack.Toolbar.MenuAction>
        )}
        {chooses
          ? methods.map((each) => (
              <Stack.Toolbar.MenuAction
                key={each}
                isOn={each === method}
                onPress={() => onChoose(each)}
              >
                {MERGE_METHOD_WORDS[each]}
              </Stack.Toolbar.MenuAction>
            ))
          : null}
        <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={onRefresh}>
          {MENU_WORDS.REFRESH}
        </Stack.Toolbar.MenuAction>
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
 * them again. The merge's one press acts at once as the panel's merge
 * control does, or arms auto-merge where the repository merges through a
 * queue, and Remove from queue asks first, as the panel's does; it stands
 * in the bar in a compact window, and in a regular one under the checks as
 * a large button, since a regular window's bar folds its acts into More.
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
  // Whether Remove from queue is being asked about.
  const [asking, setAsking] = useState(false);
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
  const press = shownPressOf(pullRequest, method, writes, () => setAsking(true));

  // Whether the pull request offers Remove from queue as it stands, which its question asks about.
  const dequeues =
    pullRequest !== undefined &&
    isLivePullRequest(pullRequest) &&
    mergeActionFor(pullRequest) === MERGE_ACTION.DEQUEUE;

  // Note that the question is dropped as soon as the queue no longer offers it, rather than only when its alert says it went, so it never stands again by itself the next time the pull request is queued.
  useEffect(() => {
    if (!dequeues) setAsking(false);
  }, [dequeues]);
  // Whether the press stands in the page, under the checks, rather than in the bar.
  const inPage = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;
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
      <PullRequestToolbar
        pullRequest={pullRequest}
        url={url}
        press={inPage ? undefined : press}
        method={method}
        onChoose={setChosen}
        onRefresh={() => void retry()}
      />
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
            symbol={failed ? "exclamationmark.triangle" : "arrow.triangle.pull"}
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
                  ? mergeSentence(pullRequest, action)
                  : undefined
              }
            />
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
                  title={check.name}
                  detail={checkDetail(check)}
                />
              ))
            )}
          </ListSection>
          {inPage && press !== undefined ? (
            <ListSection>
              <MergeActRow
                label={press.words}
                prominent={press.prominent}
                disabled={press.disabled}
                onPress={press.onPress}
              />
            </ListSection>
          ) : null}
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
              mark={{ symbol: "bubble.left", tone: STATUS_TONE.NEUTRAL }}
              title={
                conversation === undefined
                  ? failedOf(parts.conversation)
                    ? PULL_REQUEST_READ_WORDS.CONVERSATION_FAILED
                    : PULL_REQUEST_READ_WORDS.READING_CONVERSATION
                  : PULL_REQUEST_READ_WORDS.commentCount(conversationCount(conversation))
              }
              detail={url === undefined ? undefined : MENU_WORDS.OPEN_ON_GITHUB}
            />
          </ListSection>
        </RowList>
      </Screen>
      <ConfirmAsk
        title={MERGE_WORDS.DEQUEUE_QUESTION}
        message={QUEUE_WARNING}
        act={MERGE_WORDS.DEQUEUE}
        presented={asking && dequeues}
        onAct={() => {
          setAsking(false);
          void writes.write({ action: PULL_REQUEST_ACTION.DEQUEUE });
        }}
        onDismiss={() => setAsking(false)}
      />
    </>
  );
}
