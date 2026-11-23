// pull-request-screens.tsx -- one pull request on its own screen, by its workspace, its repository, and its number, whoever opened it: where it stands, its checks and reviews held live, its merge or Remove from queue under its heading in every window, as the panel's head stands it, and on its state chip and in the bar's ⋯ the changes to where it stands (Ready for review, Convert to draft, Close, Reopen), and Open on GitHub.

import { githubAvatarUrl } from "@repo/features/account-picture";
import {
  type AgentOverviewPullRequest,
  CHECK_STATE,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
} from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { iosAgentPullRequestOf, iosPullRequestFilesRoute } from "@repo/features/ios-app-links";
import { pullRequestActivity } from "@repo/features/ios-system-activity";
import { GITHUB_PAGE, gitHubPageLink, samePullRequest } from "@repo/features/link-grammar";
import {
  CHECK_WORDS,
  CLOSE_WORDS,
  checksCountOf,
  checksSummaryOf,
  conversationCount,
  isLivePullRequest,
  isMergeWrite,
  isStateAction,
  MERGE_ACTION,
  MERGE_BUSY_WORDS,
  MERGE_METHOD_WORDS,
  MERGE_PRESS_WORDS,
  MERGE_WORDS,
  type MergeAction,
  mergeActionFor,
  mergeSentence,
  PULL_REQUEST_READ_WORDS,
  PULL_REQUEST_STATE_ACTION_WORDS,
  PULL_REQUEST_STATE_LABEL,
  PULL_REQUEST_TITLE_WORDS,
  type PullRequestStateAction,
  pullRequestStateActions,
  QUEUE_WARNING,
  queuedLabel,
  REVIEW_WORDS,
  reviewersOf,
} from "@repo/features/pull-request-model";
import {
  type MergeMethod,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { workingTime } from "@repo/features/time-format";
import type { AppHostRead } from "@repo/host/app-state";
import {
  askForName,
  BAR_TITLE,
  BUZZ,
  buzz,
  CHECK_LOOK,
  CHECK_SUMMARY_LOOK,
  ConfirmAsk,
  EmptyState,
  FACE_KIND,
  type FieldMenu,
  GLYPH,
  type Glyph,
  githubFace,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  LoadingRow,
  MARK_FACE,
  MarkRow,
  MergeActRow,
  markdownShows,
  NOTICE_KIND,
  PATH_PART,
  PullRequestHead,
  REVIEW_LOOK,
  RowList,
  Screen,
  STATUS_TONE,
  useColors,
  useFailureNotices,
  WordsRow,
  WriteNoteRow,
} from "@repo/ui-native";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { useAgentPullRequests, useFollowedAgent, useShownAgent } from "../agents/use-agent.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import {
  type PullRequestKey,
  type PullRequestWrites,
  usePullRequestParts,
  usePullRequestRetry,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab } from "../tab-route.js";

/** What the bar's ⋯ menu offers beside the merge, in the panel's words. */
const MENU_WORDS = {
  MORE: "More",
  /** What the state chip's menu is heard as before where it stands, as the panel's pill is named "Pull request Open". */
  STATE: "Pull request",
  FILES_CHANGED: "Files changed",
  COPY_GITHUB_LINK: "Copy GitHub link",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/** The id the comments row stands under, beside the checks' and the reviewers'. */
const COMMENTS_ROW = "comments";

/** The least a check must have run to say how long, as the panel's checks say it. */
const RAN_AT_LEAST_MS = 1_000;

function gitHubPullRequestUrl(key: PullRequestKey): string {
  return gitHubPageLink({
    kind: GITHUB_PAGE.PULL_REQUEST,
    repository: key.repository,
    number: key.number,
  });
}

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

/** The App that runs a check, by the logo GitHub's avatar host serves for it, beside the check's mark, as the panel's check rows draw it; none where it has no such avatar. */
function checkFace(check: PullRequestCheck) {
  const picture = githubAvatarUrl(check.avatarUrl);

  if (picture === undefined) return undefined;

  return {
    of: { name: check.app ?? check.name, picture, kind: FACE_KIND.APP },
    stands: MARK_FACE.BESIDE,
  };
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
  readonly request: PullRequestActionRequest;
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
        request: { action: PULL_REQUEST_ACTION.DEQUEUE },
        ask: { title: MERGE_WORDS.DEQUEUE_QUESTION, message: QUEUE_WARNING },
      };
    // Note that the page offers no bypass of the base's rules, which asks first; GitHub's own does.
    case MERGE_ACTION.BYPASS:
    case undefined:
      return undefined;
  }
}

/** The merge's press as a screen draws it: its words, busy in its own while a change is out, what it asks first, and the change it sends. */
interface ShownPress {
  readonly words: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  readonly ask: MergeAsk | undefined;
  readonly request: PullRequestActionRequest;
}

/** A press whose question stands, as it was when pressed: the pull request it was pressed on, what that offered, the change it sends, and its question's words, so neither a live read landing under the question nor an older route turning to another pull request changes what it says or where it sends. */
interface AskedPress {
  readonly on: PullRequestKey;
  readonly action: MergeAction;
  readonly request: PullRequestActionRequest;
  readonly words: string;
  readonly ask: MergeAsk;
}

/** Whether two keys name the same pull request. */
function sameKey(one: PullRequestKey, other: PullRequestKey): boolean {
  return (
    one.workspaceId === other.workspaceId &&
    one.repository === other.repository &&
    one.number === other.number
  );
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
  pending: PullRequestWrites["pending"],
): ShownPress | undefined {
  const press = mergePressOf(
    offeredActionOf(pullRequest),
    method,
    pullRequest?.merging?.headSha ?? "",
  );

  if (press === undefined) return undefined;
  const busy = isMergeWrite(pending) ? pending : undefined;

  return {
    words: busy === undefined ? press.words : MERGE_BUSY_WORDS[busy],
    prominent: press.prominent,
    disabled: pending !== undefined,
    ask: press.ask,
    request: press.request,
  };
}

/** The ways to merge the pull request offers a choice of as it stands: the repository's, while its press merges or arms auto-merge; none otherwise. */
function methodsOffered(pullRequest: AgentOverviewPullRequest | undefined): readonly MergeMethod[] {
  const live = pullRequest !== undefined && isLivePullRequest(pullRequest);
  const action = live ? mergeActionFor(pullRequest) : undefined;
  const chooses = action === MERGE_ACTION.MERGE || action === MERGE_ACTION.ENABLE_AUTO_MERGE;

  return chooses ? (pullRequest?.merging?.methods ?? []) : [];
}

/** The glyph each change to where the pull request stands leads its item with, the panel's own. */
const STATE_ACTION_GLYPHS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: GLYPH.PULL_REQUEST,
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: GLYPH.PULL_REQUEST_DRAFT,
  [PULL_REQUEST_ACTION.CLOSE]: GLYPH.PULL_REQUEST_CLOSED,
  [PULL_REQUEST_ACTION.REOPEN]: GLYPH.PULL_REQUEST,
} as const satisfies Record<PullRequestStateAction, Glyph>;

/** One change to where the pull request stands, as the bar's ⋯ offers it. */
interface StateChange {
  readonly action: PullRequestStateAction;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** The heading of a pull request's description, as the task page heads its own. */
const DESCRIPTION_WORDS = "Description";

/**
 * The bar's one act, the ⋯ menu, grouped as the panel's and Mail's are:
 * Edit title, as a task's ⋯ offers Rename, then Files changed, which opens
 * the files it changes on a screen of their own, then the changes to where
 * the pull request stands, as the panel's state pill
 * offers them, Close in red, then Copy GitHub link and Open on GitHub.
 * It offers no Refresh, since a pull down on the page reads it again in
 * every window, as Mail's menu offers none, and a read that failed says so
 * in the page's place with Try again. The merge stands in the page under
 * the heading, where the panel's head stands it, so the bar's title keeps
 * its place.
 */
function PullRequestToolbar({
  url,
  editTitle,
  changes,
  onFiles,
}: {
  readonly url: string | undefined;
  /** Opens the title's edit; none until the pull request is read, and dimmed while a change is out. */
  readonly editTitle: { readonly disabled: boolean; readonly onPress: () => void } | undefined;
  readonly changes: readonly StateChange[];
  /** Opens the files the pull request changes on a screen of their own. */
  readonly onFiles: () => void;
}) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon={glyphSymbol(GLYPH.MORE)} accessibilityLabel={MENU_WORDS.MORE}>
        {editTitle === undefined ? null : (
          <Stack.Toolbar.Menu inline>
            <Stack.Toolbar.MenuAction
              icon={glyphSymbol(GLYPH.RENAME)}
              disabled={editTitle.disabled}
              onPress={editTitle.onPress}
            >
              {PULL_REQUEST_TITLE_WORDS.EDIT}
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
        <Stack.Toolbar.Menu inline>
          <Stack.Toolbar.MenuAction icon={glyphSymbol(GLYPH.CHANGES)} onPress={onFiles}>
            {MENU_WORDS.FILES_CHANGED}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        {changes.length === 0 ? null : (
          <Stack.Toolbar.Menu inline>
            {changes.map((change) => (
              <Stack.Toolbar.MenuAction
                key={change.action}
                icon={glyphSymbol(STATE_ACTION_GLYPHS[change.action])}
                destructive={change.action === PULL_REQUEST_ACTION.CLOSE}
                disabled={change.disabled}
                onPress={change.onPress}
              >
                {PULL_REQUEST_STATE_ACTION_WORDS[change.action]}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        )}
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
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/**
 * One agent's pull request, by the agent and its number, on a screen of its
 * own: its path in the bar, the repository and its number, small and muted;
 * its heading, where it stands as the panel's pill says it and its
 * branches, with GitHub's sentence of whether it merges; its description
 * as its author wrote it, in Markdown, where it has one; its checks, how
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
 * read. Opened from a split view's detail, it is pushed on the tab's own
 * stack over the whole window, as a compact window pushes it.
 */
export function PullRequestScreen() {
  const {
    workspace = "",
    owner = "",
    name = "",
    number = "",
    agent,
  } = useLocalSearchParams<{
    workspace: string;
    owner: string;
    name: string;
    number: string;
    /** The agent it was opened from, which names it for Handoff. */
    agent?: string;
  }>();

  const key: PullRequestKey = {
    workspaceId: workspace,
    repository: `${owner}/${name}`,
    number: Number(number),
  };

  return <PullRequestPage pullRequest={key} agentId={agent} />;
}

/**
 * An agent's pull request by the agent and its number, as an older link,
 * handoff, or launch names it (`iosPullRequestRoute`): opened by its
 * repository and number once the agent is read, as every other way in
 * opens one, so it shows exactly the pull request the agent's repository
 * holds under that number.
 */
export function AgentPullRequestScreen() {
  const { id = "", number = "" } = useLocalSearchParams<{ id: string; number: string }>();
  const pulled = Number(number);
  const agent = useShownAgent(id);
  const [listed] = useAgentPullRequests(id);
  const key = iosAgentPullRequestOf(agent, listed, pulled);

  if (key === undefined) {
    return (
      <Screen>
        <EmptyState title={PULL_REQUEST_READ_WORDS.READING} symbol={GLYPH.PULL_REQUEST} loading />
      </Screen>
    );
  }

  return <PullRequestPage pullRequest={key} agentId={id} />;
}

/**
 * One pull request as `PullRequestScreen` describes it, by its workspace,
 * its repository, and its number, on its tab's stack. The agent it was
 * opened from, where one was, names it for Handoff and draws its title from
 * the task list's line while the pull request is read.
 */
function PullRequestPage({
  pullRequest: key,
  agentId = "",
}: {
  readonly pullRequest: PullRequestKey;
  readonly agentId?: string | undefined;
}) {
  const id = agentId;
  useSurfaceOpen(PRODUCT_SURFACE.PULL_REQUEST, String(key.number));
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const colors = useColors();
  const openLink = useOpenLink(key.workspaceId);
  const agent = useFollowedAgent(id);

  const listed = useAgentPullRequests(id).find(
    (each) => each.number === key.number && samePullRequest(each.url, gitHubPullRequestUrl(key)),
  );

  const parts = usePullRequestParts(key);
  const retry = usePullRequestRetry(key);
  const writes = usePullRequestWrites(key);
  const [chosen, setChosen] = useState<MergeMethod | undefined>(undefined);
  // The merge whose question stands, by what the pull request offered when it was pressed.
  const [asked, setAsked] = useState<AskedPress | undefined>(undefined);
  const pullRequest = landedOf(parts.pullRequest)?.pullRequest ?? undefined;
  const checks = landedOf(parts.checks)?.pullRequest?.checks;
  const conversation = landedOf(parts.conversation)?.pullRequest ?? undefined;
  const methods = pullRequest?.merging?.methods ?? [];
  // Note that the method chosen stands while the repository still allows it, else the first it allows, as the panel's does.
  const method = chosen !== undefined && methods.includes(chosen) ? chosen : methods[0];
  const queued = pullRequest?.merging?.queued ?? null;
  const title = pullRequest?.title ?? listed?.title;
  const state = pullRequest?.state ?? listed?.state;
  const url = pullRequest?.url ?? listed?.url ?? gitHubPullRequestUrl(key);
  const press = shownPressOf(pullRequest, method, writes.pending);
  const offered = offeredActionOf(pullRequest);

  // The title typed into Edit title, drawn in the title's place until GitHub answers, as the panel's title stands as typed; the pull request it was typed on, so another route never draws it.
  const [retitled, setRetitled] = useState<{
    readonly on: PullRequestKey;
    readonly title: string;
  }>();

  const shownTitle = retitled !== undefined && sameKey(retitled.on, key) ? retitled.title : title;
  const notices = useFailureNotices();
  // The pull request whose Close stands asked about, since it is or may be in the merge queue.
  const [closing, setClosing] = useState<PullRequestKey | undefined>(undefined);
  const asks = asked !== undefined && asked.action === offered && sameKey(asked.on, key);
  const open = pullRequest?.state === PULL_REQUEST_STATE.OPEN;
  const inQueue = open && queued !== null;
  // Note that a place in the queue left unread, as a read with no merge box leaves it, may be one, so Close asks of it as of one queued: only a read saying it holds it nowhere lets Close act at once, as the panel's does.
  const mayBeQueued = inQueue || (open && pullRequest?.merging === undefined);
  const closeAsks = closing !== undefined && sameKey(closing, key) && mayBeQueued;

  // Note that a question is dropped as soon as the pull request no longer offers what it asks about, rather than only when its alert says it went, so it never stands again by itself the next time it offers that.
  useEffect(() => {
    if (asked !== undefined && !asks) setAsked(undefined);
  }, [asked, asks]);
  useEffect(() => {
    if (closing !== undefined && !closeAsks) setClosing(undefined);
  }, [closing, closeAsks]);

  // Note that a Close that acted at once offers Reopen as its Undo, as the panel's toast does, since it can be taken back; one that may leave the queue asks first instead, since reopening does not queue it again.
  const close = () =>
    void writes.write({ action: PULL_REQUEST_ACTION.CLOSE }).then((went) => {
      if (!went) return;

      notices.say({
        kind: NOTICE_KIND.DONE,
        words: CLOSE_WORDS.CLOSED,
        undo: () => void writes.write({ action: PULL_REQUEST_ACTION.REOPEN }),
      });
    });

  const changes: readonly StateChange[] = (
    pullRequest === undefined ? [] : pullRequestStateActions(pullRequest.state, inQueue)
  ).map((action) => ({
    action,
    disabled: writes.pending !== undefined,
    onPress: () => {
      if (action !== PULL_REQUEST_ACTION.CLOSE) {
        void writes.write({ action });
      } else if (mayBeQueued) {
        setClosing(key);
      } else {
        close();
      }
    },
  }));

  // Note that the title is edited in the system's name alert, as a task is renamed, Return keeping the words; they stand in its place until GitHub answers, and the title as it was comes back where it refused them.
  const editTitle =
    pullRequest === undefined
      ? undefined
      : {
          disabled: writes.pending !== undefined,
          onPress: () =>
            askForName({
              title: PULL_REQUEST_TITLE_WORDS.EDIT,
              act: PULL_REQUEST_TITLE_WORDS.SAVE,
              name: pullRequest.title,
              onName: (typed) => {
                const kept = typed.slice(0, PULL_REQUEST_WRITE_BOUNDS.MAX_TITLE_CHARS).trim();
                setRetitled({ on: key, title: kept });
                void writes
                  .write({ action: PULL_REQUEST_ACTION.EDIT_TITLE, title: kept })
                  .finally(() => setRetitled(undefined));
              },
            }),
        };

  // Note that the state chip offers the same changes as the bar's ⋯, as the panel's pill opens them where it says where the pull request stands; none once merged, where nothing changes.
  const stateMenu: FieldMenu | undefined =
    changes.length === 0
      ? undefined
      : {
          label: MENU_WORDS.STATE,
          choices: [],
          actions: changes.map((change) => ({
            label: PULL_REQUEST_STATE_ACTION_WORDS[change.action],
            symbol: STATE_ACTION_GLYPHS[change.action],
            destructive: change.action === PULL_REQUEST_ACTION.CLOSE,
            disabled: change.disabled,
            onPress: change.onPress,
          })),
        };

  useScreenActivity((workspaces) =>
    agent === undefined || agent.taskId === null || title === undefined
      ? undefined
      : pullRequestActivity(
          {
            agentId: id,
            workspaceId: agent.workspaceId,
            taskId: agent.taskId,
            number: key.number,
            title,
          },
          workspaces,
        ),
  );
  const path = [key.repository, `#${key.number}`];

  const page = (view: ReactNode, asks?: ReactNode) => (
    <>
      {bar}
      <Screen>{view}</Screen>
      {asks}
    </>
  );

  const bar = (
    <>
      <Stack.Screen
        options={{
          title: path.join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      <PullRequestToolbar
        url={url}
        editTitle={editTitle}
        changes={changes}
        onFiles={() => router.push(onOwnTab(iosPullRequestFilesRoute(key)))}
      />
    </>
  );

  if (title === undefined || state === undefined) {
    const failed = failedOf(parts.pullRequest);

    return page(
      failed ? (
        <EmptyState
          title={PULL_REQUEST_READ_WORDS.FAILED}
          symbol={GLYPH.FAILED}
          retry={() => void retry()}
        />
      ) : (
        <EmptyState title={PULL_REQUEST_READ_WORDS.READING} symbol={GLYPH.PULL_REQUEST} loading />
      ),
    );
  }

  const action = pullRequest === undefined ? undefined : mergeActionFor(pullRequest);
  const summary = checks === undefined ? undefined : checksSummaryOf(checks);
  // Note that a pull request with no description, one read from a service before it, or one that holds only HTML GitHub's page hides (a template's comments, a bot's badges), shows no Description section, rather than the panel's "No description provided.", since the phone draws no empty section.
  const description = pullRequest?.body ?? "";
  const described = markdownShows(description, { hidesHtml: true });

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

  return page(
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
          title={shownTitle ?? title}
          titleEdit={
            editTitle === undefined || editTitle.disabled
              ? undefined
              : { heard: PULL_REQUEST_TITLE_WORDS.EDIT, onPress: editTitle.onPress }
          }
          number={key.number}
          state={state}
          queued={queued !== null || (pullRequest === undefined && listed?.queued === true)}
          stateLabel={
            // Note that a change to where it stands says itself while it is out, as the panel's pill reads "Closing…".
            isStateAction(writes.pending)
              ? `${PULL_REQUEST_STATE_ACTION_WORDS[writes.pending]}…`
              : queued !== null
                ? queuedLabel(queued.position)
                : PULL_REQUEST_STATE_LABEL[state]
          }
          stateMenu={stateMenu}
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
          opened={
            pullRequest === undefined
              ? undefined
              : {
                  by: pullRequest.author === undefined ? undefined : githubFace(pullRequest.author),
                  at: pullRequest.createdAt,
                  mergedAt: pullRequest.mergedAt,
                }
          }
          labels={pullRequest?.labels}
        />
        {writes.note === undefined ? null : (
          <WriteNoteRow words={writes.note.words} said={writes.note.said} />
        )}
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
              if (press.ask === undefined || offered === undefined) {
                void writes.write(press.request);
              } else {
                setAsked({
                  on: key,
                  action: offered,
                  request: press.request,
                  words: press.words,
                  ask: press.ask,
                });
              }
            }}
          />
        )}
      </ListSection>
      {described ? (
        <ListSection title={DESCRIPTION_WORDS}>
          <WordsRow
            words={description}
            repository={agent?.repository}
            onOpenLink={openLink}
            hidesHtml
          />
        </ListSection>
      ) : null}
      <ListSection
        title="Checks"
        count={
          checks === undefined || summary === undefined ? undefined : checksCountOf(checks, summary)
        }
        mark={summary === undefined ? undefined : CHECK_SUMMARY_LOOK[summary]}
      >
        {checks === undefined && !failedOf(parts.checks) ? (
          <LoadingRow words={PULL_REQUEST_READ_WORDS.READING_CHECKS} />
        ) : checks === undefined ? (
          <MarkRow
            id="checks-reading"
            mark={CHECK_LOOK[CHECK_STATE.PENDING]}
            title={PULL_REQUEST_READ_WORDS.CHECKS_FAILED}
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
              standing={CHECK_WORDS[check.state]}
              face={checkFace(check)}
              opens={check.url ?? undefined}
            />
          ))
        )}
      </ListSection>
      <ListSection title="Reviews" count={reviewers.length}>
        {reviewers.map((reviewer) => {
          const face = githubFace(reviewer.by);

          return (
            <MarkRow
              key={reviewer.by.login}
              id={reviewer.by.login}
              mark={REVIEW_LOOK[reviewer.state]}
              title={face.name}
              detail={REVIEW_WORDS[reviewer.state]}
              face={{ of: face, stands: MARK_FACE.LEAD }}
            />
          );
        })}
        {conversation === undefined && !failedOf(parts.conversation) ? (
          <LoadingRow words={PULL_REQUEST_READ_WORDS.READING_CONVERSATION} />
        ) : (
          <MarkRow
            id={COMMENTS_ROW}
            mark={{ symbol: GLYPH.THREAD, tone: STATUS_TONE.NEUTRAL }}
            title={
              conversation === undefined
                ? PULL_REQUEST_READ_WORDS.CONVERSATION_FAILED
                : PULL_REQUEST_READ_WORDS.commentCount(conversationCount(conversation))
            }
            opens={url}
          />
        )}
      </ListSection>
    </RowList>,
    <>
      <ConfirmAsk
        title={asked?.ask.title ?? MERGE_WORDS.MERGE_QUESTION}
        message={asked?.ask.message ?? `#${key.number} ${title}`}
        act={asked?.words ?? ""}
        presented={asks}
        onAct={() => {
          setAsked(undefined);

          if (asked !== undefined && asks) void writes.write(asked.request);
        }}
        onDismiss={() => setAsked(undefined)}
      />
      <ConfirmAsk
        title={CLOSE_WORDS.QUESTION}
        message={inQueue ? CLOSE_WORDS.QUEUED : CLOSE_WORDS.UNKNOWN}
        act={PULL_REQUEST_STATE_ACTION_WORDS[PULL_REQUEST_ACTION.CLOSE]}
        destructive
        presented={closeAsks}
        onAct={() => {
          setClosing(undefined);

          if (closeAsks) void writes.write({ action: PULL_REQUEST_ACTION.CLOSE });
        }}
        onDismiss={() => setClosing(undefined)}
      />
    </>,
  );
}
