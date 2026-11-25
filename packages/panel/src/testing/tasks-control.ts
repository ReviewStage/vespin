import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentTranscriptKey,
  type AgentTranscriptPage,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import {
  type AgentOlderAnswer,
  applyMessagesPage,
  type ListedAgent,
} from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASK_REGION, TASKS_PAGE } from "@repo/features/tasks-model";
import type {
  AppHostRead,
  AppInboxSlice,
  AppInboxWaitingItem,
  AppTranscript,
} from "@repo/host/app-state";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { createElement, type ReactElement } from "react";
import type { AgentRoute } from "../agent-route.js";
import type { PlaceLeave } from "../places/place-leave.js";
import type { TaskRoute } from "../task-route.js";
import type { RepositoryChooser } from "../tasks/repository-chip.js";
import { MAIN_TAB, SIDE_PANEL_WIDTH } from "../tasks/task-tab-model.js";
import {
  AGENT_RENAME_TERMS,
  type AgentsControl,
  agentArchiveMutation,
  agentDeleteMutation,
  agentRenameMutation,
  agentsArchiveMutation,
  type TaskAgentsControl,
} from "../tasks/use-agents.js";
import { HISTORY_READ } from "../tasks/use-description-history.js";
import {
  NEW_TASK_UNSHOWN,
  type NewTask,
  type NewTaskShown,
  NewTaskShownContext,
} from "../tasks/use-new-task.js";
import { DRAWN_KINDS } from "../tasks/use-side-panel.js";
import {
  type TasksControl,
  taskMoveMutation,
  type VersionHistoryControl,
} from "../tasks/use-tasks-tab.js";
import type { HomeRoute, RoutedViews, UnknownWorkspaceRoute } from "../workspace-routes.js";
import {
  handHostReads,
  handState,
  holdTranscripts,
  stateWith,
  type TranscriptsHeld,
} from "./app-state.js";
import { writeAppState } from "./copy-feedback.js";
import { outboxed, unsendOutbox } from "./outbox.js";

const ignore = () => undefined;

/** The workspace an agent the task list carries stands in where a test names none. */
const LISTED_WORKSPACE_ID = "workspace-listed";

/** An agent as the task list carries it: with the workspace and repository its own row names, a test's own where given, else one workspace and no repository. */
export function listedAgent(
  agent: Omit<ListedAgent, "workspaceId" | "repository">,
  place: Partial<Pick<ListedAgent, "workspaceId" | "repository">> = {},
): ListedAgent {
  return {
    ...agent,
    workspaceId: place.workspaceId ?? LISTED_WORKSPACE_ID,
    repository: place.repository ?? null,
  };
}

/** An open item as main's read of the account carries it into what waits: its id, its agent, what it asks, and when it was posted. */
/** A page as the host pushes it: caught up where it came back with nothing on it, unless it says otherwise. */
function pushedPage(page: AgentMessagesAnswerView | AgentTranscriptPage): AgentTranscriptPage {
  if ("failure" in page || "caughtUp" in page) return page;

  return { ...page, caughtUp: page.messages.length === 0 };
}

/** A page a test's host tells of a transcript, as the service answers one or as the host's follow tells it. */
export type ToldPage = AgentMessagesAnswerView | AgentTranscriptPage;

/**
 * A transcript as a test's host holds it once `pages` were told on it in
 * turn: each readable page's messages joined on by id, or a newest page
 * that does not meet them, or was read at another rewind, in their place;
 * its word on the agent the last's, and each counted; a page that could not
 * be read standing beside what was held, and one the account does not reach
 * in its place.
 */
export function transcriptTold(pages: readonly ToldPage[]): AppHostRead<AppTranscript> {
  let held: AppTranscript = { messages: [], pages: 0 };

  for (const page of pages.map(pushedPage)) {
    if ("failure" in page) {
      held =
        page.failure === AGENT_CALL_FAILURE.NOT_FOUND
          ? { messages: [], pages: held.pages, failure: page }
          : { ...held, failure: page };
      continue;
    }

    const { messages, cursor, before, newest, ...word } = page;
    const ids = new Set(messages.map((message) => message.id));
    const meets = before === undefined || held.messages.some((message) => ids.has(message.id));

    const replaces =
      newest === true &&
      (held.messages.length === 0 || !meets || word.rewound !== held.word?.rewound);

    const { failure: _failure, before: heldBefore, ...standing } = held;

    // Note that a newest page naming no older page holds the whole transcript, so nothing stands below it.
    const below =
      replaces || (newest === true && before === undefined) ? before : (heldBefore ?? before);

    held = {
      ...standing,
      messages: replaces ? messages : applyMessagesPage(held.messages, messages),
      ...(below === undefined ? undefined : { before: below }),
      cursor,
      word,
      pages: held.pages + 1,
    };
  }

  return { rows: held };
}

/**
 * Answers the window's holds on transcripts as the host would, beside the
 * document and acts handed by now: the pages `pagesOf` names for a
 * transcript, told on it in turn and laid once it is held; or, where `held`
 * names one of them, the pages before it, and the rest once its release
 * lands, where a window still holds it. Answers with how the test's host
 * lays a transcript anew, and the holds asked and let go.
 */
export function pushedTranscripts(
  pagesOf: (transcript: AgentTranscriptKey) => readonly ToldPage[],
  held?: { readonly page: number; readonly release: Promise<void> },
): TranscriptsHeld {
  /** Whether the release has landed, after which a hold is laid every page. */
  let released = held === undefined;
  void held?.release.then(() => {
    released = true;
  });

  const told: TranscriptsHeld = holdTranscripts(
    handHostReads({}).deliverTranscripts,
    (transcript) => {
      const pages = pagesOf(transcript);

      if (!released) {
        // Note that a transcript let go reads nothing more, so the rest lands only while a window holds it.
        void held?.release.then(() => {
          if (heldNow(told, transcript)) told.lay(transcript, transcriptTold(pages));
        });
      }

      const laid = released ? pages : pages.slice(0, held?.page ?? pages.length);

      return laid.length === 0 ? undefined : transcriptTold(laid);
    },
  );

  return told;
}

/** Whether a window holds `transcript` now: it asked for it more often than it let it go. */
function heldNow(held: TranscriptsHeld, transcript: AgentTranscriptKey): boolean {
  const same = (other: AgentTranscriptKey) =>
    other.agentId === transcript.agentId && other.callId === transcript.callId;

  return held.asked.filter(same).length > held.closed.filter(same).length;
}

/** A test's host telling a transcript's pages as it reads them, and the holds the window asked of it, in order. */
export interface TranscriptsTelling {
  /** Tells `page` on what the host holds of `transcript`, laid on the document at once. */
  readonly tell: (transcript: AgentTranscriptKey, page: ToldPage) => void;
  /** Lays an older page before the messages the host holds of `transcript`, as the host lays one a window read. */
  readonly layOlder: (transcript: AgentTranscriptKey, older: AgentOlderAnswer) => void;
  readonly asked: readonly AgentTranscriptKey[];
  readonly closed: readonly AgentTranscriptKey[];
}

/** What a test's host was told of one transcript: its pages, and the older pages laid before them, in turn. */
interface Told {
  readonly pages: readonly ToldPage[];
  readonly older: readonly AgentOlderAnswer[];
}

/** A transcript as a test's host holds it once `told`: its pages told in turn, each older page laid before them. */
function heldOf({ pages, older }: Told): AppHostRead<AppTranscript> {
  const { rows = { messages: [], pages: 0 } } = transcriptTold(pages);

  return {
    rows: older.reduce<AppTranscript>((held, page) => {
      const ids = new Set(held.messages.map((message) => message.id));
      const { before: _laid, ...rest } = held;

      return {
        ...rest,
        messages: [...page.messages.filter((message) => !ids.has(message.id)), ...held.messages],
        ...(page.before === undefined ? undefined : { before: page.before }),
      };
    }, rows),
  };
}

/**
 * Answers the window's holds on transcripts as the host would, beside the
 * document and acts handed by now, laying only what the test told: each
 * page told on what the host holds of its transcript, laid as the window
 * holds it, and at once while it does, as a page the host read lands.
 */
export function tellingTranscripts(): TranscriptsTelling {
  /** What was told of each transcript, by its agent and then its worker's call or the agent's own. */
  const told = new Map<string, Map<string | undefined, Told>>();

  const toldOf = (transcript: AgentTranscriptKey) =>
    told.get(transcript.agentId)?.get(transcript.callId);

  const held = holdTranscripts(handHostReads({}).deliverTranscripts, (transcript) => {
    const was = toldOf(transcript);

    return was === undefined ? undefined : heldOf(was);
  });

  const tellOn = (transcript: AgentTranscriptKey, more: (was: Told) => Told) => {
    const ofAgent = told.get(transcript.agentId) ?? new Map<string | undefined, Told>();
    const next = more(ofAgent.get(transcript.callId) ?? { pages: [], older: [] });
    told.set(transcript.agentId, ofAgent.set(transcript.callId, next));

    if (heldNow(held, transcript)) held.lay(transcript, heldOf(next));
  };

  return {
    asked: held.asked,
    closed: held.closed,
    tell: (transcript, page) =>
      tellOn(transcript, (was) => ({ ...was, pages: [...was.pages, page] })),
    layOlder: (transcript, older) =>
      tellOn(transcript, (was) => ({ ...was, older: [...was.older, older] })),
  };
}

export function waitingOf(item: InboxItem): AppInboxWaitingItem {
  return { id: item.id, agentId: item.agentId, title: item.title, postedAt: item.postedAt };
}

/** A task whose version history is shut, its history still being read, no version chosen, every press ignored. */
function versionHistoryControl(
  overrides: Partial<VersionHistoryControl> = {},
): VersionHistoryControl {
  return {
    open: false,
    list: { kind: HISTORY_READ.READING },
    selected: undefined,
    viewing: undefined,
    onSelect: ignore,
    spot: undefined,
    onOpenSections: ignore,
    onChooseSection: ignore,
    onCloseSections: ignore,
    listed: true,
    onList: ignore,
    onRetry: ignore,
    onRetryVersion: ignore,
    onLoadEarlier: () => Promise.resolve(false),
    onRestore: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    ...overrides,
  };
}

/** A repository chip's chooser for no workspace in particular, whose list the host holds (`LIVE_READ.REPOSITORY_LISTS`). */
export const NO_REPOSITORIES = {
  recent: [],
  openGitHub: ignore,
  pictures: true,
  manages: true,
} as const satisfies RepositoryChooser;

/**
 * The window's control of the open task (`TaskAgentsControl`) over a
 * control listing its agents, which stand as the agents New task holds
 * until the list carries them, so a test needs no collection to draw them.
 * Their pull requests and runs are read from the collections by `taskId`,
 * where a test stands them.
 */
export function taskAgentsOf(
  control: AgentsControl = agentsControl(),
  taskId?: string,
): TaskAgentsControl {
  const { agents, archived, pullRequests, ...acts } = control;
  const held = agents === undefined ? undefined : [...agents, ...(archived ?? [])];

  return {
    ...acts,
    // Note that a task named is followed, its agents standing beside whatever the collections list of it.
    rows: { taskId, followed: taskId !== undefined, held },
    rowNow: (agentId) => held?.find((agent) => agent.id === agentId),
    pullRequestNow: (agentId) => pullRequests.get(agentId),
    archivedIds: archived?.map((agent) => agent.id),
    workingIds: agents?.flatMap((agent) => (agentStillWriting(agent.status) ? [agent.id] : [])),
  };
}

/** A task with no agents and no repository, every press ignored. */
export function agentsControl(overrides: Partial<AgentsControl> = {}): AgentsControl {
  const onArchive: AgentsControl["onArchive"] =
    overrides.onArchive ??
    (() => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }));

  return {
    me: undefined,
    agents: [],
    archived: [],
    agentIds: [],
    // A task with no archived agent holds exactly the agents given.
    heldIds: overrides.agentIds ?? [],
    keywords: [],
    readSkills: undefined,
    draft: undefined,
    onNewDraft: () => "draft",
    onForkDraft: () => "draft",
    onContinueDraft: () => "draft",
    onSuggestDraft: () => "draft",
    onDropFork: ignore,
    onDraftChange: ignore,
    onHandDraft: ignore,
    onTaskStarted: ignore,
    onDraftHeld: ignore,
    onDiscardDraft: ignore,
    startPrompt: () => Promise.resolve(undefined),
    startFork: () => Promise.resolve(undefined),
    startBlank: () => Promise.resolve(undefined),
    startSuggestion: () => Promise.resolve(undefined),
    onRetryList: ignore,
    models: undefined,
    modelsFailed: false,
    macs: undefined,
    readModels: ignore,
    onUnarchive: undefined,
    continueAgent: undefined,
    start: {
      available: false,
      busy: false,
      onPress: () => Promise.resolve(undefined),
    },
    onStop: () => Promise.resolve(false),
    onRewind: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onClear: () => Promise.resolve(true),
    onMove: () => Promise.resolve(false),
    onRetry: () => Promise.resolve(false),
    onChoose: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onSwitchServers: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onPermissionMode: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onFace: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onAnswerApproval: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onOpenIntegrations: ignore,
    onOpenApiKeys: ignore,
    archiving: false,
    rename: {
      ...AGENT_RENAME_TERMS,
      options: agentRenameMutation(() =>
        Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED, cause: undefined }),
      ),
    },
    onArchive,
    // A question's archive is the same archive, as the test answers it.
    archiveAgent: agentArchiveMutation(({ agentId, archived, asked }) =>
      onArchive(agentId, archived, asked === undefined ? {} : { asked }),
    ),
    // And a selection's archive is each agent's, as the test answers it.
    archiveAgents: agentsArchiveMutation(({ agentIds, archived, asked }) =>
      Promise.all(
        agentIds.map((agentId) =>
          onArchive(agentId, archived, asked === undefined ? {} : { asked }),
        ),
      ),
    ),
    deleteAgent: agentDeleteMutation(() =>
      Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED, cause: undefined }),
    ),
    // An agent read again stands as the control's list has it.
    readAgent: (agentId) =>
      Promise.resolve(
        [...(overrides.agents ?? []), ...(overrides.archived ?? [])].find(
          (agent) => agent.id === agentId,
        ),
      ),
    readTranscript: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    pullRequests: new Map(),
    answerInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    messageInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    startInboxThread: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
    // The host's record draws each message sent, keeps one refused, and lets one go, over whatever the test answers.
    onMessage: outboxed(
      overrides.onMessage ?? (() => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED })),
    ),
    onUnsend: overrides.onUnsend ?? unsendOutbox,
  };
}

/**
 * Hands the window main's document with its inbox read holding the slices
 * given, nothing in the rest, and the account's feed holding each task's
 * items given, none where none are; written into the test's Query client
 * too, so a case that draws synchronously finds them in its first frame.
 */
export function handInbox(
  inbox: Partial<AppInboxSlice>,
  fed: Readonly<Record<string, readonly InboxItem[]>> = {},
): void {
  const patch = {
    inbox: { ...stateWith({}, {}).inbox, ...inbox },
    [LIVE_READ.INBOX_ITEMS]: { rows: { [INBOX_SCOPE_KIND.TASK]: fed } },
  };

  handState({}, patch);
  writeAppState(stateWith({}, patch));
}

/** A leave guard no page asks through, so every way out goes at once. */
export const NO_LEAVE_ASK: PlaceLeave = {
  stand: () => () => undefined,
  pass: (leave) => leave(),
  arrive: (move, landed) => {
    move(true);
    landed();
  },
  free: () => true,
  stays: ignore,
  stayed: () => false,
  along: ignore,
};

/** The Board, a person's page, the Automations pages, and the Inbox standing nowhere, as a step's name and Copy link read them. */
export const VIEWS_AWAY: RoutedViews = {
  board: false,
  person: { userId: undefined, name: undefined, workspace: undefined },
  automations: undefined,
  automationName: undefined,
  mergeQueue: false,
  inbox: { open: false, chosen: undefined, narrowed: undefined },
  admin: undefined,
  settings: undefined,
};

/** An agent's page's route standing nowhere, for a tasks tab drawn with no router to stand it. */
export const AGENT_AWAY: AgentRoute = {
  agentId: undefined,
  workspace: undefined,
  onOpen: ignore,
};

/** A workspace not there for the reader standing nowhere, for a tasks tab drawn with no router to stand it. */
export const UNKNOWN_WORKSPACE_AWAY: UnknownWorkspaceRoute = {
  workspace: undefined,
  onOpen: ignore,
};

/** Home standing nowhere, for a tasks tab drawn with no router to stand it. */
export const HOME_AWAY: HomeRoute = {
  open: false,
  standingIn: undefined,
  onOpen: ignore,
  onTurn: ignore,
};

/** No task's own place standing, for a tab drawn with no router: none opens. */
export const TASK_AWAY: TaskRoute = {
  at: undefined,
  saved: undefined,
  atNow: () => undefined,
  savedNow: () => undefined,
  workspaceNow: () => undefined,
  onOpen: ignore,
};

/** No arrival counted, for a tab drawn with no router, whose window never moves. */
export const NO_ARRIVALS = (): number => 0;

/** A link read that always stands, for a tab drawn with no router, whose window never moves. */
export const UNMOVED_LINK_READS = (): (() => boolean) => () => true;

/** New task as the Tasks tab hands it, its dialog put away and every press ignored, but where `overrides` say otherwise. */
export function newTaskControl(overrides: Partial<NewTask> = {}): NewTask {
  return {
    onOpen: ignore,
    onOpenIn: ignore,
    onOpenInSection: ignore,
    onOpenRelated: ignore,
    onOpenForAutomation: ignore,
    workspaces: [],
    workspaceId: undefined,
    repositoriesIn: () => NO_REPOSITORIES,
    start: () => Promise.resolve(undefined),
    models: undefined,
    devices: undefined,
    modelsFailed: false,
    readModels: ignore,
    onClose: ignore,
    typedNames: new Map(),
    onShowMention: ignore,
    ...overrides,
  };
}

/** `element` under New task's moving state as the window provides it (`NewTaskShownContext`): shown nowhere, but where `shown` says otherwise. */
export function withNewTaskShown(
  shown: Partial<NewTaskShown>,
  element: ReactElement,
): ReactElement {
  return createElement(NewTaskShownContext, { value: { ...NEW_TASK_UNSHOWN, ...shown } }, element);
}

/** What a test sets of a Tasks tab, and the tasks and agents its window's task list holds (`tasks`, `listedAgents`), which the tab itself never carries. */
export type TasksControlOverrides = Partial<TasksControl> & {
  readonly tasks?: readonly TaskSummary[];
  readonly listedAgents?: readonly ListedAgent[];
};

/** A Tasks tab a test draws, and the tasks and agents its window's task list holds, which `overEveryTask` and `overListedTasks` stand the window's collections on. */
export type ListingTasksControl = TasksControl & {
  readonly listedTasks: readonly TaskSummary[];
  readonly listedAgents?: readonly ListedAgent[];
};

/** No task listed: what a tab built otherwise than by `tasksControl` lists. */
const NO_LISTED: readonly TaskSummary[] = [];

/** The tasks a test's tab lists (`tasksControl`'s `tasks`), carried along any copy spread from it; none for a tab built otherwise. */
export function listedTasksOf(tasks: TasksControl): readonly TaskSummary[] {
  return "listedTasks" in tasks && Array.isArray(tasks.listedTasks) ? tasks.listedTasks : NO_LISTED;
}

/** The agents a test's tab lists (`tasksControl`'s `listedAgents`), carried along any copy spread from it; none where it lists none. */
export function listedAgentsOf(tasks: TasksControl): readonly ListedAgent[] | undefined {
  return "listedAgents" in tasks && Array.isArray(tasks.listedAgents)
    ? tasks.listedAgents
    : undefined;
}

/**
 * A signed-in Tasks tab on screen on Home with no tasks, every
 * press ignored, bound for whichever task it is given as open.
 */
export function tasksControl(overrides: TasksControlOverrides = {}): ListingTasksControl {
  const { tasks: listedTasks = [], listedAgents, ...set } = overrides;
  const onMoveTask: TasksControl["onMoveTask"] = set.onMoveTask ?? (() => Promise.resolve(false));

  return {
    page: TASKS_PAGE.HOME,
    shown: true,
    signedIn: true,
    me: undefined,
    typedNames: new Map(),
    workspaces: [],
    workspace: undefined,
    onChooseWorkspace: ignore,
    onLeftWorkspace: ignore,
    onMoveTask,
    // A question's move and delete are the same move and delete, as the test answers them.
    moveTask: taskMoveMutation(({ taskId, workspaceId, quiet }) =>
      onMoveTask(taskId, workspaceId, { quiet }),
    ),
    activeTaskId: undefined,
    boundFor: set.activeTaskId,
    onPointTask: () => {},
    listFailed: false,
    listRead: true,
    region: { kind: TASK_REGION.NONE },
    copy: { onPress: ignore },
    mainTabs: {
      tabs: [MAIN_TAB.OVERVIEW],
      tab: MAIN_TAB.OVERVIEW,
      returnTab: undefined,
      openAgents: undefined,
      newTabAsked: false,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onMove: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      viewedAt: [],
      remembers: () => false,
      onViewedAt: ignore,
      onDoze: ignore,
      onWake: ignore,
    },
    sidePanel: {
      open: false,
      stop: undefined,
      fullScreen: false,
      fullScreenOnly: false,
      expands: true,
      newTabAsked: false,
      toggleAsked: false,
      tabs: DRAWN_KINDS,
      order: [],
      closedTabs: [],
      used: DRAWN_KINDS,
      pins: [],
      subagents: [],
      files: [],
      changes: [],
      pages: [],
      terminals: [],
      locals: [],
      lastTerminal: undefined,
      pullRequestViews: new Map(),
      onPullRequestView: () => undefined,
      strip: DRAWN_KINDS,
      tab: undefined,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      opened: 0,
      onToggle: ignore,
      onSetOpen: ignore,
      onToggleFullScreen: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      onToggleAskedAnswered: () => undefined,
      onChoose: ignore,
      onShow: ignore,
      onCarry: ignore,
      onClose: ignore,
      onCloseOn: ignore,
      onMove: ignore,
      onReopen: ignore,
      onPin: ignore,
      onUnpin: ignore,
      onRenamePins: ignore,
      onPlacePins: ignore,
      onOpen: ignore,
      agent: undefined,
      ownerOf: () => undefined,
      onOpenFile: ignore,
      onBrowseFile: ignore,
      onFileHistory: ignore,
      onResize: ignore,
      viewedAt: [],
      onViewedAt: ignore,
    },
    unreadTabs: [],
    pages: undefined,
    agents: taskAgentsOf(),
    history: versionHistoryControl(),
    onSelect: ignore,
    onResume: ignore,
    onRestoreTask: ignore,
    onStandTask: ignore,
    taskView: { taskId: undefined },
    onArriveTask: ignore,
    onShowAgent: ignore,
    onOpenHistory: ignore,
    onShowColumnTab: ignore,
    onShowPanelTab: ignore,
    tabKeys: undefined,
    onTabKeys: ignore,
    onTabKeysTaken: ignore,
    onShowSource: ignore,
    onShowTask: ignore,
    onShowMention: ignore,
    onOpenLink: ignore,
    messageReveal: undefined,
    onMessageRevealed: ignore,
    onRevealMessage: ignore,
    threadReveal: undefined,
    onThreadRevealed: ignore,
    onRevealThread: ignore,
    sectionReveal: undefined,
    commentReveal: undefined,
    onCommentRevealed: ignore,
    onSectionRevealed: ignore,
    onShowInbox: ignore,
    inboxShown: null,
    inboxView: {
      onClear: ignore,
      pages: undefined,
      onTaskAgents: () => undefined,
    },
    agentView: { agentId: undefined, onOpen: ignore },
    onThreadsShown: ignore,
    agentThreads: { shown: () => undefined, onOpen: ignore, onClose: ignore },
    onOpenPerson: ignore,
    atHome: false,
    taskPlaceStands: true,
    onAutomationRuns: ignore,
    onShowFile: ignore,
    onOpenPinnedTab: ignore,
    onReopenClosedTab: undefined,
    chosenPin: undefined,
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    relationMenu: undefined,
    onAddRelation: ignore,
    onRetryList: ignore,
    newTask: newTaskControl(),
    onLeaveTask: ignore,
    onGoHome: ignore,
    onLeaveRouted: ignore,
    onUnbindTask: ignore,
    typedNamesNow: () => set.typedNames ?? new Map(),
    onDraftName: ignore,
    agentsCarried: true,
    placeLeave: NO_LEAVE_ASK,
    ...set,
    // Note that the tasks given are laid last, over those a tab spread into `overrides` listed.
    listedTasks,
    ...(listedAgents === undefined ? undefined : { listedAgents }),
  };
}
