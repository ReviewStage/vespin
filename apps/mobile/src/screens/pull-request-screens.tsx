// pull-request-screens.tsx -- one pull request on its own screen, by its workspace, its repository, and its number, whoever opened it: where it stands, its checks, reviewers and conversation held live, a row each pushing its checks and the files it changes, its conversation inline under them, its merge or Remove from queue under its heading in every window, as the panel's head stands it, its title edited from a tap on it, on its state chip the changes to where it stands (Ready for review, Convert to draft, Close, Reopen), and in the bar's ⋯ Copy GitHub link and Open on GitHub, as the panel's are.

import {
  type AgentOverviewPullRequest,
  type CheckSummary,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type ReviewThread,
} from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { filesWords } from "@repo/features/changed-files";
import {
  iosAgentPullRequestOf,
  iosPullRequestChaptersRoute,
  iosPullRequestChecksRoute,
  iosPullRequestCommentRoute,
  iosPullRequestFilesRoute,
  iosPullRequestReviewRoute,
  iosPullRequestThreadRoute,
} from "@repo/features/ios-app-links";
import { pullRequestActivity } from "@repo/features/ios-system-activity";
import { GITHUB_PAGE, gitHubPageLink, samePullRequest } from "@repo/features/link-grammar";
import { MERGE_QUEUE_PAGE_WORDS } from "@repo/features/merge-queue-model";
import { formatCount } from "@repo/features/number-format";
import {
  CHAPTERS_SHOWN,
  CHAPTERS_WORDS,
  type ChaptersShown,
  chaptersShown,
} from "@repo/features/pull-request-chapters-shown";
import {
  CHECK_SUMMARY_WORDS,
  CLOSE_WORDS,
  checksCountOf,
  checksSummaryOf,
  conversationCount,
  descriptionFolds,
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
  REVIEW_PANEL_WORDS,
  REVIEW_WORDS,
  reactionsLine,
  reviewersOf,
  THREAD_ACT_WORDS,
  threadLineSpan,
  threadStateWords,
  unresolvedThreadCount,
  unresolvedWords,
} from "@repo/features/pull-request-model";
import {
  type MergeMethod,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import { SHOW_LESS_WORDS, SHOW_MORE_WORDS } from "@repo/features/words";
import { answerFailed, landedAnswer } from "@repo/host/app-state-reads";
import {
  askForName,
  BAR_TITLE,
  BUZZ,
  buzz,
  CHECK_SUMMARY_LOOK,
  ConfirmAsk,
  ConversationEntryRow,
  EmptyState,
  type FieldAct,
  type FieldMenu,
  GLYPH,
  type Glyph,
  githubFace,
  LIST_LOOK,
  LinkRow,
  ListSection,
  LoadingRow,
  MarkRow,
  MergeActRow,
  markdownShows,
  NOTICE_KIND,
  PATH_PART,
  PullRequestHead,
  REVIEW_LOOK,
  ROW_ACTION_TONE,
  type RowAction,
  type RowCount,
  RowList,
  Screen,
  STATUS_TONE,
  StackBarMenu,
  ThreadRow,
  useColors,
  useFailureNotices,
  useMinute,
  WORDS_EDGE,
  WordsRow,
  WriteNoteRow,
} from "@repo/ui-native";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { useAgentPullRequests, useFollowedAgent, useShownAgent } from "../agents/use-agent.js";
import { MERGE_QUEUE_ROUTE, useMergeQueueOn } from "../merge-queue/merge-queue-on.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { reactionMenu } from "../pull-requests/reaction-menu.js";
import {
  type PullRequestKey,
  type PullRequestWrites,
  usePullRequestParts,
  usePullRequestRetry,
  usePullRequestWrites,
} from "../pull-requests/use-pull-request.js";
import { usePullRequestChapters } from "../pull-requests/use-pull-request-chapters.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab } from "../tab-route.js";

/** What the bar's ⋯ menu and the state chip are named, in the panel's words. */
const MENU_WORDS = {
  MORE: "More",
  /** What the state chip's menu is heard as before where it stands, as the panel's pill is named "Pull request Open". */
  STATE: "Pull request",
  COPY_GITHUB_LINK: "Copy GitHub link",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/** The id of the row that opens the conversation on GitHub, where its read failed or left earlier entries there. */
const OPENS_ROW = { ON_GITHUB: "on-github" } as const;

/** What joins the parts of the head's merge sentence. */
const SENTENCE_PART = " · ";

/** The heading of a pull request's conversation, as the panel's tab heads it. */
const CONVERSATION_WORDS = "Conversation";

/** The ids of the rows that push a screen of their own: the checks, and the files changed. */
const PAGE_ROW = {
  CHECKS: "checks",
  CHAPTERS: "chapters",
  FILES: "files",
  COMMENT: "comment",
} as const;

/** What those rows say, as the screens they push are titled. */
const PAGE_ROW_WORDS = {
  CHECKS: "Checks",
  CHAPTERS: CHAPTERS_WORDS.CHAPTERS,
  FILES_CHANGED: "Files changed",
  COMMENT: "Comment",
} as const;

function gitHubPullRequestUrl(key: PullRequestKey): string {
  return gitHubPageLink({
    kind: GITHUB_PAGE.PULL_REQUEST,
    repository: key.repository,
    number: key.number,
  });
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

/** A set with `id` added where it was missing, and taken away where it stood. */
function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);

  if (!next.delete(id)) next.add(id);

  return next;
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

/** What the Files changed row counts, as the panel's tab counts the files: how many, heard with its noun. */
function filesRowCount(files: number): RowCount {
  return {
    words: formatCount(files),
    tone: STATUS_TONE.NEUTRAL,
    heard: filesWords(files),
  };
}

/**
 * What the Checks row counts, as the panel's tab counts the checks
 * (`checksCount`): how they went, by its glyph in its tone from the first
 * frame, and how many once read (`checksCountOf`): those that failed, those
 * still running, or every one once they passed; nothing where neither
 * stands.
 */
function checksRowCount(
  summary: CheckSummary | undefined,
  checks: readonly PullRequestCheck[] | undefined,
): RowCount | undefined {
  if (summary === undefined) return undefined;
  const look = CHECK_SUMMARY_LOOK[summary];
  const count = checks === undefined ? undefined : checksCountOf(checks, summary);

  if (look === undefined && count === undefined) return undefined;
  const words = count === undefined ? "" : formatCount(count);

  return {
    words,
    tone: look?.tone ?? STATUS_TONE.NEUTRAL,
    glyph: look?.symbol,
    heard: [words, CHECK_SUMMARY_WORDS[summary]].filter((part) => part !== "").join(" "),
  };
}

/** What the Chapters row says of where they stand beside its glyph, to a reader who cannot see it, as the panel's tab says it. */
const CHAPTERS_ROW_HEARD = {
  GENERATING: "generating",
  FAILED: "failed",
  STALE: "out of date",
} as const;

/**
 * What the Chapters row counts, as the panel's Chapters tab does
 * (`chaptersTabCount`): the wait's mark while they are made, a cross in
 * the danger tone where the generation failed, and once ready their count,
 * in the attention tone under a warning where new commits came since, as
 * `headKnown` lets it say; nothing while there are none.
 */
function chaptersRowCount(shown: ChaptersShown, headKnown: boolean): RowCount | undefined {
  switch (shown.kind) {
    case CHAPTERS_SHOWN.GENERATING:
      return {
        words: "",
        tone: STATUS_TONE.NEUTRAL,
        glyph: GLYPH.CHECK_RUNNING,
        heard: CHAPTERS_ROW_HEARD.GENERATING,
      };
    case CHAPTERS_SHOWN.GENERATION_FAILED:
      return {
        words: "",
        tone: STATUS_TONE.DANGER,
        glyph: GLYPH.REMOVE,
        heard: CHAPTERS_ROW_HEARD.FAILED,
      };
    case CHAPTERS_SHOWN.READY: {
      const words = formatCount(shown.chapters.length);

      return shown.stale && headKnown
        ? {
            words,
            tone: STATUS_TONE.ATTENTION,
            glyph: GLYPH.FAILED,
            heard: `${words}, ${CHAPTERS_ROW_HEARD.STALE}`,
          }
        : { words, tone: STATUS_TONE.NEUTRAL, heard: words };
    }

    default:
      return undefined;
  }
}

/** The glyph each change to where the pull request stands leads its item with, the panel's own. */
const STATE_ACTION_GLYPHS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: GLYPH.PULL_REQUEST,
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: GLYPH.PULL_REQUEST_DRAFT,
  [PULL_REQUEST_ACTION.CLOSE]: GLYPH.PULL_REQUEST_CLOSED,
  [PULL_REQUEST_ACTION.REOPEN]: GLYPH.PULL_REQUEST,
} as const satisfies Record<PullRequestStateAction, Glyph>;

/** One change to where the pull request stands, as its state chip offers it. */
interface StateChange {
  readonly action: PullRequestStateAction;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** The heading of a pull request's description, as the task page heads its own. */
const DESCRIPTION_WORDS = "Description";

/**
 * The bar's one act, the ⋯ menu, as the panel's toolbar ⋯ offers it on the
 * pull request: Copy GitHub link and Open on GitHub. Its title is edited
 * from a tap on it, and where it stands is changed from its state chip, as
 * the panel's title and pill change them, so the menu repeats neither. It
 * offers no Refresh, since a pull down on the page reads it again in every
 * window, as Mail's menu offers none, and a read that failed says so in the
 * page's place with Try again. The merge stands in the page under the
 * heading, where the panel's head stands it, so the bar's title keeps its
 * place.
 */
function PullRequestToolbar({ url }: { readonly url: string | undefined }) {
  return (
    <Stack.Toolbar placement="right">
      {/* Note that ⋯ is SwiftUI's own menu, as every other bar's ⋯ stands (`StackBarMenu`), dimmed until the pull request's address is read. */}
      <Stack.Toolbar.View>
        <StackBarMenu
          menu={{
            label: MENU_WORDS.MORE,
            symbol: GLYPH.MORE,
            choices: [],
            disabled: url === undefined,
            actions:
              url === undefined
                ? []
                : [
                    {
                      label: MENU_WORDS.COPY_GITHUB_LINK,
                      symbol: GLYPH.LINK,
                      onPress: () => copyLink(url),
                    },
                    {
                      label: MENU_WORDS.OPEN_ON_GITHUB,
                      symbol: GLYPH.OPEN_EXTERNALLY,
                      onPress: () => openInSafari(url),
                    },
                  ],
          }}
        />
      </Stack.Toolbar.View>
    </Stack.Toolbar>
  );
}

/**
 * One agent's pull request, by the agent and its number, on a screen of its
 * own: its path in the bar, the repository and its number, small and muted;
 * its heading, where it stands as the panel's pill says it and its
 * branches, with GitHub's sentence of whether it merges; its description
 * as its author wrote it, in Markdown, where it has one; a row for its
 * checks and a row for the files it changes, each counting them as the
 * panel's tabs do, the checks by how they went and how many, and the files
 * by how many where its agent's listing counts them, their lines standing
 * after its branches, and a row for its chapters between them, counting
 * them as the panel's Chapters tab does and held live with the page, each
 * row pushing its own screen, as GitHub's app pushes its Checks and
 * Files changed; its reviewers' faces in its heading, each wearing where
 * they stand, as the panel's people line draws them; and its conversation
 * inline, as GitHub's app runs its timeline under the page: each comment
 * and review by who wrote it, where a review left them and when, a short
 * plain preview of its words that a press opens whole in Markdown, and each
 * review thread under the review that started it, by its file and lines,
 * opened to its comments; the earlier entries a read left on GitHub
 * counted first, opening there. The Description and the Conversation each
 * fold under their headings, as the panel's do, and open again on a second
 * tap. Its
 * parts are held live while the screen is in focus, and a pull down reads
 * them again. The merge's one press merges, or arms auto-merge where the
 * repository merges through a queue, once its question is answered, as a
 * pull request's card on the agent page asks it, so a merge asks the same
 * wherever it is pressed; Remove from queue asks first too, as the
 * panel's does, and Disable auto-merge, which only takes back, doesn't. It stands
 * under the heading in every window, as wide as its words, as the panel's
 * head stands Merge under the title, and as a split button where the
 * repository merges more than one way.
 * Review beside its title opens the member's review on a screen of its
 * own, as the panel's phone stands Review beside its title, where it says
 * Comment, Approve, or Request changes and is sent on GitHub as the member.
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
  const chapters = usePullRequestChapters(key);
  const [chosen, setChosen] = useState<MergeMethod | undefined>(undefined);
  const [unfolded, setUnfolded] = useState(false);
  // The conversation's entries and threads opened whole, by their row's id.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const now = useMinute();
  // The merge whose question stands, by what the pull request offered when it was pressed.
  const [asked, setAsked] = useState<AskedPress | undefined>(undefined);
  const pullRequest = landedAnswer(parts.pullRequest)?.pullRequest ?? undefined;
  const checks = landedAnswer(parts.checks)?.pullRequest?.checks;
  const conversation = landedAnswer(parts.conversation)?.pullRequest ?? undefined;
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
  const mergeQueueOn = useMergeQueueOn();
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

  // Note that a thread is resolved or opened again as the panel's thread does, by GitHub's id for it, on the member's own sign-in; one the read names no id for offers neither, and every act stands dimmed while a change is out, as the merge's does.
  const threadActs = (thread: ReviewThread): readonly RowAction[] => {
    const threadId = thread.id;

    if (threadId === undefined) return [];

    return [
      thread.resolved
        ? {
            label: THREAD_ACT_WORDS.REOPEN,
            symbol: GLYPH.RESTORE,
            tone: ROW_ACTION_TONE.NEUTRAL,
            disabled: writes.pending !== undefined,
            onPress: () =>
              void writes.write({ action: PULL_REQUEST_ACTION.UNRESOLVE_THREAD, threadId }),
          }
        : {
            label: THREAD_ACT_WORDS.RESOLVE,
            symbol: GLYPH.RESOLVED,
            tone: ROW_ACTION_TONE.DONE,
            disabled: writes.pending !== undefined,
            onPress: () =>
              void writes.write({ action: PULL_REQUEST_ACTION.RESOLVE_THREAD, threadId }),
          },
    ];
  };

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

  // Note that the state chip offers the changes, as the panel's pill opens them where it says where the pull request stands; none once merged, where nothing changes.
  // A queued pull request's chip offers View merge queue first, while the account has the page on, as the panel's pill does, opening it on this pull request's row.
  const viewQueue: readonly FieldAct[] =
    inQueue && mergeQueueOn
      ? [
          {
            label: MERGE_QUEUE_PAGE_WORDS.VIEW,
            symbol: GLYPH.QUEUED,
            destructive: false,
            disabled: false,
            onPress: () =>
              router.push({ pathname: onOwnTab(MERGE_QUEUE_ROUTE), params: { pr: url } }),
          },
        ]
      : [];

  const stateMenu: FieldMenu | undefined =
    changes.length === 0 && viewQueue.length === 0
      ? undefined
      : {
          label: MENU_WORDS.STATE,
          choices: [],
          actions: [
            ...viewQueue,
            ...changes.map((change) => ({
              label: PULL_REQUEST_STATE_ACTION_WORDS[change.action],
              symbol: STATE_ACTION_GLYPHS[change.action],
              destructive: change.action === PULL_REQUEST_ACTION.CLOSE,
              disabled: change.disabled,
              onPress: change.onPress,
            })),
          ],
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
      <PullRequestToolbar url={url} />
    </>
  );

  if (title === undefined || state === undefined) {
    const failed = answerFailed(parts.pullRequest);

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

  // Note that how the checks went is said from the first frame, by the merge read's word for them or what the agent published, and their own read's once it lands, as the panel's Checks tab counts them.
  const summary =
    checks === undefined
      ? (pullRequest?.merging?.checks ?? listed?.checks)
      : checksSummaryOf(checks);

  // Note that a pull request with no description, one read from a service before it, or one that holds only HTML GitHub's page hides (a template's comments, a bot's badges), shows no Description section, rather than the panel's "No description provided.", since the phone draws no empty section.
  const description = pullRequest?.body ?? "";
  // Note that the review threads still unresolved are said beside GitHub's sentence, as a branch that requires them resolved holds the merge for them, so the reader sees why before scrolling to them.
  const unresolvedCount = conversation === undefined ? 0 : unresolvedThreadCount(conversation);
  const unresolved = unresolvedCount === 0 ? undefined : unresolvedWords(unresolvedCount);
  const described = markdownShows(description, { hidesHtml: true });
  // Note that a long description stands folded to its first lines, faded at its foot, until Show more, so the rows and the conversation under it stay a short scroll away, as GitHub's app folds a long body.
  const folds = descriptionFolds(description);
  const folded = folds && !unfolded;

  const reviewers =
    pullRequest === undefined
      ? []
      : reviewersOf(
          pullRequest.requested,
          conversation?.reviewers ?? [],
          pullRequest.author?.login,
        );

  // Each row a press pushes a screen of its own for, by its id: the checks, the files changed, and a new comment.
  const pushes = new Map<string, string>([
    [PAGE_ROW.CHECKS, iosPullRequestChecksRoute(key)],
    [PAGE_ROW.CHAPTERS, iosPullRequestChaptersRoute(key)],
    [PAGE_ROW.FILES, iosPullRequestFilesRoute(key)],
    [PAGE_ROW.COMMENT, iosPullRequestCommentRoute(key)],
  ]);

  // Note that a review thread GitHub names an id for opens on a screen of its own, where it is replied to, by its row's id, its first comment's page; one it names none for opens in place.
  const threadRoutes = new Map(
    (conversation?.conversation ?? []).flatMap((entry) =>
      (entry.threads ?? []).flatMap((thread) => {
        const first = thread.comments[0];

        return first === undefined || thread.id === undefined
          ? []
          : [[first.url, iosPullRequestThreadRoute(key, thread.id)] as const];
      }),
    ),
  );

  return page(
    <RowList
      look={LIST_LOOK.PLAIN}
      onSelect={(row) => {
        const route = pushes.get(row);

        const thread = threadRoutes.get(row);

        if (route !== undefined) {
          router.push(onOwnTab(route));
        } else if (thread !== undefined) {
          router.push(onOwnTab(thread));
        } else if (row === OPENS_ROW.ON_GITHUB) {
          openInSafari(url);
        } else {
          // Note that any other row is a conversation's entry or thread, which a press opens whole or folds again.
          setOpened((was) => toggled(was, row));
        }
      }}
      onRefresh={retry}
    >
      <ListSection>
        <PullRequestHead
          title={shownTitle ?? title}
          review={
            pullRequest === undefined
              ? undefined
              : {
                  label: REVIEW_PANEL_WORDS.OPEN,
                  onPress: () => router.push(onOwnTab(iosPullRequestReviewRoute(key))),
                }
          }
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
              ? [mergeSentence(pullRequest, action, { queueShown: true }), unresolved]
                  .filter((part) => part !== undefined)
                  .join(SENTENCE_PART)
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
          lines={
            listed === undefined
              ? undefined
              : { additions: listed.additions, deletions: listed.deletions }
          }
          reviewers={reviewers.map((reviewer) => ({
            by: githubFace(reviewer.by),
            state: reviewer.state,
          }))}
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
        <ListSection title={DESCRIPTION_WORDS} foldable>
          <WordsRow
            words={description}
            repository={agent?.repository}
            onOpenLink={openLink}
            hidesHtml
            edge={WORDS_EDGE.ROWS}
            folded={folded}
            reactions={reactionsLine(conversation?.descriptionReactions ?? [])}
            menuGroups={[
              reactionMenu(
                conversation?.descriptionSubject,
                conversation?.descriptionReactions,
                writes,
              ),
            ]}
            last={!folds}
          />
          {folds ? (
            <LinkRow
              symbol={folded ? GLYPH.FOLDED : GLYPH.UNFOLDED}
              label={folded ? SHOW_MORE_WORDS : SHOW_LESS_WORDS}
              onPress={() => setUnfolded(folded)}
            />
          ) : null}
        </ListSection>
      ) : null}
      <ListSection>
        <MarkRow
          id={PAGE_ROW.CHECKS}
          mark={{ symbol: GLYPH.CHECKS, tone: STATUS_TONE.NEUTRAL }}
          title={PAGE_ROW_WORDS.CHECKS}
          count={checksRowCount(summary, checks)}
          pushes
        />
        <MarkRow
          id={PAGE_ROW.CHAPTERS}
          mark={{ symbol: GLYPH.CHAPTERS, tone: STATUS_TONE.NEUTRAL }}
          title={PAGE_ROW_WORDS.CHAPTERS}
          count={chaptersRowCount(
            chaptersShown(chapters.answer, chapters.generating, {
              pullRequest: pullRequest?.merging?.headSha,
              files: pullRequest?.merging?.headSha,
            }),
            pullRequest?.merging?.headSha !== undefined,
          )}
          pushes
        />
        <MarkRow
          id={PAGE_ROW.FILES}
          mark={{ symbol: GLYPH.CHANGES, tone: STATUS_TONE.NEUTRAL }}
          title={PAGE_ROW_WORDS.FILES_CHANGED}
          count={listed === undefined ? undefined : filesRowCount(listed.changedFiles)}
          pushes
        />
      </ListSection>
      <ListSection
        title={CONVERSATION_WORDS}
        count={conversation === undefined ? undefined : conversationCount(conversation)}
        foldable
      >
        {conversation === undefined ? (
          answerFailed(parts.conversation) ? (
            <MarkRow
              id={OPENS_ROW.ON_GITHUB}
              mark={{ symbol: GLYPH.THREAD, tone: STATUS_TONE.NEUTRAL }}
              title={PULL_REQUEST_READ_WORDS.CONVERSATION_FAILED}
              opens={url}
            />
          ) : (
            <LoadingRow words={PULL_REQUEST_READ_WORDS.READING_CONVERSATION} />
          )
        ) : conversation.conversation.length === 0 && conversation.earlier === 0 ? (
          <MarkRow
            id={OPENS_ROW.ON_GITHUB}
            mark={{ symbol: GLYPH.THREAD, tone: STATUS_TONE.NEUTRAL }}
            title={PULL_REQUEST_READ_WORDS.NO_CONVERSATION}
          />
        ) : (
          <>
            {conversation.earlier === 0 ? null : (
              <MarkRow
                id={OPENS_ROW.ON_GITHUB}
                mark={{ symbol: GLYPH.THREAD, tone: STATUS_TONE.NEUTRAL }}
                title={PULL_REQUEST_READ_WORDS.earlierCount(conversation.earlier)}
                opens={url}
              />
            )}
            {conversation.conversation.flatMap((entry) => [
              <ConversationEntryRow
                key={entry.url}
                id={entry.url}
                by={githubFace(entry.by)}
                standing={
                  entry.state === undefined
                    ? undefined
                    : { mark: REVIEW_LOOK[entry.state], words: REVIEW_WORDS[entry.state] }
                }
                at={entry.at}
                now={now}
                words={entry.markdown ?? entry.body}
                open={opened.has(entry.url)}
                repository={agent?.repository}
                onOpenLink={openLink}
                reactions={reactionsLine(entry.reactions ?? [])}
                submenus={reactionMenu(entry.subject, entry.reactions, writes)}
              />,
              // Note that a thread is named by its first comment's page, which no other row shares.
              ...(entry.threads ?? []).flatMap((thread) => {
                const first = thread.comments[0];

                if (first === undefined) return [];

                return [
                  <ThreadRow
                    key={first.url}
                    id={first.url}
                    path={thread.path}
                    lines={threadLineSpan(thread)}
                    states={threadStateWords(thread)}
                    comments={thread.comments.map((comment) => ({
                      id: comment.url,
                      by: githubFace(comment.by),
                      at: comment.at,
                      words: comment.markdown ?? comment.body,
                    }))}
                    count={thread.comments.length + thread.more}
                    now={now}
                    open={opened.has(first.url)}
                    repository={agent?.repository}
                    onOpenLink={openLink}
                    acts={threadActs(thread)}
                  />,
                ];
              }),
            ])}
          </>
        )}
        {conversation === undefined ? null : (
          <MarkRow
            id={PAGE_ROW.COMMENT}
            mark={{ symbol: GLYPH.COMMENT, tone: STATUS_TONE.NEUTRAL }}
            title={PAGE_ROW_WORDS.COMMENT}
            pushes
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
