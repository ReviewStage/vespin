import type { AgentPermissionMode } from "@repo/features/agent-approval-wire";
import {
  ARCHIVE_NOT_READY,
  CLEAR_FAILED,
  DELETE_FAILED,
  STOP_FAILED,
  STOP_NOTHING_YET,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentChangesPeople,
  type AgentPullRequest,
  type AgentRunsOnRequest,
  type AgentSummary,
  CONTEXT_WINDOW,
} from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import type {
  CatalogModel,
  MacOffer,
  ModelChoice,
  ModelProvider,
} from "@repo/features/models-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@repo/features/pull-request-chapters-view";
import { SENTRY_SEND_SPAN } from "@repo/features/sentry-tracing";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { type DraftSuggestion, sentOf } from "@repo/features/suggestion-model";
import { agentStillWriting } from "@repo/features/task-agents-model";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { TranscriptReader } from "@repo/features/transcript-copy";
import { ACT_KIND } from "@repo/host/acts";
import { OWN_PULL_REQUEST } from "@repo/host/app-state";
import type { PortActPayload } from "@repo/host/contract";
import { EXPERIMENT } from "@repo/settings";
import { STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  mutationOptions,
  type QueryClient,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Duration, Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOfferedModels } from "../account-choices.js";
import {
  type ActedResult,
  type ActResult,
  type AgentActAnswer,
  askAct,
  sendAct,
  type Unreached,
  unreachedAs,
} from "../act.js";
import { actMutation, sendMutation } from "../act-mutations.js";
import {
  DRAFT_PLACE,
  type Draft,
  type KeptDraft,
  type NewAgentPlace,
  useDraftWriter,
  useNewAgentDraft,
} from "../composer-drafts.js";
import type { ShownFailure } from "../failure-report.js";
import { modelsRetryMutation } from "../live-reads.js";
import type { RenameTerms } from "../rename-write.js";
import { rendererFork } from "../renderer-runtime.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { useToast } from "../toast.js";
import {
  type LocalWrite,
  pressLocal,
  pressRows,
  ROW_WRITE,
  type RowDoors,
  TOAST_ONLY_UNDO,
  toastOnlyUndo,
  withdrawUndo,
} from "../undo-stack.js";
import {
  appStateQuery,
  memoizedSelect,
  selectExperiment,
  selectPullRequestPublished,
} from "../use-app-state.js";
import type { ApprovalAnswerWriter, PermissionModeWriter } from "./agent-approvals.js";
import {
  archivedManyWords,
  archiveWords,
  choiceRequest,
  continueFailureNote,
  RENAME_FAILED,
  RETRY_FAILED,
  SERVERS_FAILED,
  START_FAILED_AWAY,
  START_NEEDS_TASK,
  startFailureNote,
} from "./agent-model.js";
import {
  agentMessagesQueryOptions,
  agentPageQueryOptions,
  repositorySkillsQueryOptions,
} from "./agent-reads.js";
import { type AgentFork, continueFork, forkStart } from "./fork-model.js";
import { type ByPullRequestTab, pullRequestAsked } from "./pull-request-number.js";
import { keptSkills } from "./repository-skills.js";
import type { SkillSource } from "./skill-picker.js";
import { useSuggestionSender } from "./suggestion-send.js";
import type { MessageSender } from "./use-agent-composer.js";
import type { ChoiceWriter } from "./use-agent-model.js";
import { useListedPullRequests } from "./use-agent-pull-request.js";
import type { ServersWriter } from "./use-agent-servers.js";
import type {
  InboxAnswerer,
  InboxImageReader,
  InboxMessenger,
  InboxThreadStarter,
} from "./use-task-inbox.js";

/** A pull request's chapters the port refused to answer, as the tab hears any answer that never came. */
const CHAPTERS_UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

/** Why a Start did not start, with the answer that said so, which a shown failure reports. */
type StartFailure = Failure & { readonly cause?: unknown };

/** An agent's act that never answered, settled as unanswered with the error beneath. */
const agentUnreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** An agent's rename as a mutation asks it: the agent, and the title already trimmed and changed. */
interface AgentRenameAsk {
  readonly agentId: string;
  readonly title: string;
}

/** An agent's rename as each surface renaming one holds it, a mutation of its own sent through `send`; the service's refusal is its answer's failure. */
export function agentRenameMutation(send: (asked: AgentRenameAsk) => Promise<AgentActAnswer>) {
  return mutationOptions({ mutationKey: [ACT_KIND.AGENTS_RENAME], mutationFn: send });
}

/** What an agent's delete answers: that it was deleted, or why not, an act that never arrived among them. */
type AgentDeleteAnswer =
  | ActResult<typeof ACT_KIND.AGENTS_DELETE>
  | Unreached<typeof AGENT_CALL_FAILURE.UNANSWERED>;

/** What a delete the service refused is said as, by why. */
function deleteAnswered(answer: AgentDeleteAnswer): ActedResult {
  if (!("failure" in answer)) return { status: ACTION_RESULT_STATUS.ACCEPTED };
  const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;

  return {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: notReady ? ARCHIVE_NOT_READY : DELETE_FAILED,
    cause: answer,
  };
}

/**
 * An agent's delete as the question asking it holds it, a mutation of its
 * own sent through `send`, answered as that question reads it. Note that
 * the delete answers once the task list carries it, so the page's agent
 * leaves with its row.
 */
export function agentDeleteMutation(send: (agentId: string) => Promise<AgentDeleteAnswer>) {
  return mutationOptions({
    mutationKey: [ACT_KIND.AGENTS_DELETE],
    mutationFn: (agentId: string) => send(agentId).then(deleteAnswered),
  });
}

/** An agent's delete as a question holds it. */
type AgentDeleteMutation = ReturnType<typeof agentDeleteMutation>;

/** An agent's rename as a surface holds it. */
type AgentRenameMutation = ReturnType<typeof agentRenameMutation>;

/** How an agent's rename is asked and read back, its refusal its answer's failure. */
export const AGENT_RENAME_TERMS = {
  ask: (agentId: string, title: string): AgentRenameAsk => ({ agentId, title }),
  asked: ({ agentId, title }: AgentRenameAsk) => ({ subjectId: agentId, name: title }),
  refused: (answer: AgentActAnswer) => "failure" in answer,
} satisfies RenameTerms<AgentActAnswer, AgentRenameAsk>;

/** No words to listen for, one array so a render that has none hands down the same one. */
const NO_KEYWORDS: readonly string[] = [];

/** No agent listed, as the list reads where it is not followed. */
const NO_LISTED_AGENTS: readonly AgentSummary[] = [];

/** No pull request a tab names by its number, one map so a draw that holds none hands down the same one. */
const NO_NUMBERED_PULL_REQUESTS: ByPullRequestTab<AgentPullRequest> = new Map();

/**
 * Each pull request a Pull request tab names by its number, by agent and
 * then number, as the host holds what was published of it
 * (`LIVE_READ.PULL_REQUEST_PUBLISHED`) while a surface holds it: the side
 * panel each numbered tab it draws, and the tab shown its own. A read that
 * failed, or named no pull request, holds none, and the agents' own stand
 * apart (`pullRequests`).
 */
const selectNumberedPullRequests = memoizedSelect(
  (state) => [selectPullRequestPublished(state)],
  (held): ByPullRequestTab<AgentPullRequest> => {
    const numbered = new Map<string, Map<number | undefined, AgentPullRequest>>();

    for (const [agentId, ofAgent] of Object.entries(held ?? {})) {
      for (const [number, read] of Object.entries(ofAgent)) {
        const rows = read.rows;

        if (number === OWN_PULL_REQUEST || rows === undefined || "failure" in rows) continue;

        if (rows.pullRequest === null) continue;
        const kept = numbered.get(agentId) ?? new Map<number | undefined, AgentPullRequest>();
        numbered.set(agentId, kept.set(Number(number), rows.pullRequest));
      }
    }

    return numbered.size === 0 ? NO_NUMBERED_PULL_REQUESTS : numbered;
  },
);

/** How long a read of the models may stay out before it is said as failed, past the host's own ten-second bound on the call it makes. */
const MODELS_READ_BOUND_MS = 15_000;
/**
 * use-agents.ts -- the open task's coding agents as one control: the agents and their status, a Start, a draft agent started on a prompt, the Stop, a message to one, a change of one's model, and the models the menus offer.
 *
 * The agents are the task list's, followed live in the host, which carries
 * every agent of the task, archived ones among them, and draws a rename, an
 * archive, a change of model, or a switch of MCP servers the moment it is
 * asked, kept until the list carries it (`@repo/host`'s
 * `task-list-collections.ts`), and a Start's agent before the Start answers.
 * Where no task is open, the agent named is read as its own page, for its
 * workspace, its repository, and the run that started it, and the list's
 * row of it stands over that read once the list carries it. A Start mints a key of its own
 * for the press, so a service that did not answer is asked again under the
 * same key on the next press of the same choice and answers the agent the
 * first press made rather than a second one; a press of another choice is
 * another request with a key of its own. The models the menu offers and
 * the account's default are read when the menu asks, so the menu shows the
 * catalog as it stands and the default as Settings last wrote it; a model or
 * effort picked in the Start menu is what that button's next Start runs on,
 * never the account's default; one picked on an agent's chip is written
 * on that agent alone, for its next step.
 *
 * A draft is an agent the developer opened from the column's "+" and has
 * not yet sent anything: it exists only here, so a draft let go leaves
 * nothing behind on the service. Its first message starts the agent with
 * those words as its task, in the task's place, under the draft's own key,
 * so a send asked again after the service did not answer is the same
 * agent; the agent's tab then opens as a Start's does. Each task has at
 * most one draft, held with the words written in it and the choice made on
 * its chip, so a draft keeps them while its tab is away and while the
 * developer visits another plan. Its words and files are the plan's kept
 * draft (`../composer-drafts.ts`), under the draft's key, so its words
 * outlast a relaunch too, and a plan holding them opens on its draft's tab
 * again, under the same key. A draft let go while it holds words or files
 * goes at once, and a toast offers Undo, which puts it back under the same
 * key, its chips, words, and files with it, and shows its tab again.
 *
 * New task's Agent mode starts its agent with its task, in the task's one
 * start (`use-tasks-tab.ts`): an agent that landed joins the list of the
 * task it started on where that task stands open (`onTaskStarted`), drawn
 * at once, before the task's list or the agent's transcript is read, its
 * words waiting in its queue while its first launch boots, and one
 * the service refused leaves the task a draft holding the words, the files,
 * and the model picked on New task's chip, where one was, with why
 * (`onHandDraft`), under the key that start carried, so its tab's Retry is
 * an agent's own Start on the task and answers the agent the first start
 * made where it made one.
 *
 * An agent may be archived on its own, which the service does only once a
 * turn it still runs is stopped. The archived agents are split from the
 * rest here: `agents` holds those standing, which is every tab, row, and
 * menu of the task, and `archived` the rest, which the summary keeps folded
 * away with an Unarchive on each. Once an archive lands, a toast offers Undo.
 *
 * An agent may be continued in a new one, which is a Start on the task
 * `from` that agent on its whole transcript, with the developer's words, where
 * they wrote some, as its note. Each agent continued holds a key of its own
 * until its Start lands, so a press asked again after the service did not
 * answer opens the agent the first press made; words or files of another
 * press are another request under a key of its own. Its tab opens as a
 * Start's does.
 */

/** How an archive was pressed: whether a question was asked first, which keeps it off ⌘Z. */
interface ArchivePress {
  readonly asked?: true;
}

/** An agent archived or brought back, as a mutation asks it, and whether a question was asked first. */
interface ArchiveAsk extends ArchivePress {
  readonly agentId: string;
  readonly archived: boolean;
}

/** An agent's archive as each place pressing it holds its own mutation over it, run through `run`, answering whether it was kept. */
export function agentArchiveMutation(run: (asked: ArchiveAsk) => Promise<ActedResult>) {
  return mutationOptions({ mutationKey: [ROW_WRITE.AGENT_ARCHIVE.kind], mutationFn: run });
}

/** An agent's archive, as a place pressing it holds it. */
type AgentArchiveMutation = ReturnType<typeof agentArchiveMutation>;

/** Several agents archived or brought back at once, as a selection asks it, and whether a question was asked first. */
interface ArchiveManyAsk extends ArchivePress {
  readonly agentIds: readonly string[];
  readonly archived: boolean;
}

/** Several agents' archive at once, as a selection pressing it holds its own mutation over it, run through `run`, answering whether each was kept, in order. */
export function agentsArchiveMutation(
  run: (asked: ArchiveManyAsk) => Promise<readonly ActedResult[]>,
) {
  return mutationOptions({ mutationKey: [ROW_WRITE.AGENT_ARCHIVE.kind], mutationFn: run });
}

/** Several agents' archive, as a selection pressing it holds it. */
type AgentsArchiveMutation = ReturnType<typeof agentsArchiveMutation>;

/** Who an agent's pull request names, as its Changes tab last read them, and the pull request's page they were read for. */
export interface HeldPeople {
  readonly url: string;
  readonly people: AgentChangesPeople;
}

/** Everything the "+" menu, the tabs, and the agent tab draw and press. */
export interface AgentsControl {
  /** The signed-in account's id, whose own agents carry no "Started by"; none while signed out, or for an identity stored without one. */
  me: string | undefined;
  /** The open task's agents in the order started, an archived one left out, or nothing before the task list carries the task. */
  agents: readonly AgentSummary[] | undefined;
  /** The open task's archived agents in the order started, or nothing before the task list carries the task. */
  archived: readonly AgentSummary[] | undefined;
  /** Every agent the followed task list carries, on any task or none, the archived ones among them, which names an agent of another task that wrote on the open task's description; none where the list is not followed or does not list the open task. */
  listed?: readonly AgentSummary[] | undefined;
  /** Reads the task list again where its read failed; the list follows itself otherwise, a task's agents among it. */
  onRetryList: () => void;
  /** The agent tabs the panel may show, by agent id; nothing before the task list carries the task. */
  agentIds: readonly string[] | undefined;
  /** Every agent of the task by id, an archived one among them, which its Inbox stands on, since an archived agent's items still stand; nothing before the task list carries the task. */
  heldIds: readonly string[] | undefined;
  /** The models the menu offers, as the host holds them for the account (`LIVE_READ.MODELS`); nothing before they are first read. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the models could not be read, or the newest ask of them ran past its bound, so the menu says so with Retry rather than reading for ever. */
  modelsFailed: boolean;
  /** Where the newest ask of the models made here stands, at the generation it took, which New task waits on. */
  modelsRead: ModelsRead;
  /** The member's devices a task's Runs on may name, as the models the host holds offered them: none listed where they offered none, and nothing before they are read. */
  macs: readonly MacOffer[] | undefined;
  /** Asks the host for the models again, as New task opening or the menu's Retry asks. */
  readModels: () => void;
  /** The open task's draft agent; nothing while it has none. */
  draft: AgentDraft | undefined;
  /** Opens a draft agent on the open task, or answers the one it has, by its key. */
  onNewDraft: () => string;
  /**
   * Forks one of the task's agents at one of its messages into the open
   * task's draft, opening one where it has none, or answers the draft it
   * joined, by its key: its words and files stay, and its chips start on
   * the source's model and effort and its MCP servers.
   */
  onForkDraft: (fork: AgentFork) => string;
  /**
   * Opens the open task's draft as a continue of one of its agents on its
   * whole transcript, or answers the draft it joined, by its key: the words
   * and files given are laid in after any the draft held, and its chips
   * start on the source's model and effort and its MCP servers. Nothing is
   * sent until the draft is.
   */
  onContinueDraft: (
    sourceId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ) => string;
  /**
   * Opens the open task's draft from a suggestion in another agent's reply,
   * or answers the draft that already holds it, by its key: the suggested
   * brief is laid in after any words the draft held, and its chip starts on
   * the model and effort the suggestion named. Nothing is sent until the
   * draft is, through the suggestion (`startSuggestion`).
   */
  onSuggestDraft: (
    suggestion: DraftSuggestion,
    words: string,
    choice: ModelChoice | undefined,
  ) => string;
  /** Lets the open task's draft's fork or suggestion go, leaving an ordinary draft with its words and chips. */
  onDropFork: () => void;
  /** Writes the open task's draft: the words in its box, the choice on its chip, the MCP servers it switched off, the mode its Permissions row picked, or that the refusal it was handed was let go. */
  onDraftChange: (
    change: Partial<
      Pick<
        AgentDraft,
        "prompt" | "choice" | "disabledServers" | "runsOn" | "permissionMode" | "refused"
      >
    >,
  ) => void;
  /**
   * Hands a task New task just started, whose agent the service refused, a
   * draft agent under the key that start carried, holding the words, the
   * files, the choice made on New task's chip, and why it was refused, which
   * its tab shows under the box with Retry.
   */
  onHandDraft: (taskId: string, handed: HandedDraft) => void;
  /**
   * Takes an agent New task started with its task: it joins the list where
   * that task stands open, or stands as that task's whole list until the
   * list is read, which is read again. Note that its words are no line of
   * its transcript yet, because they wait in its queue until its first
   * launch hands them off.
   */
  onTaskStarted: (taskId: string, agent: AgentSummary) => void;
  /** Changes the open task's draft's files from those it holds as the change lands. */
  onDraftAttachments: (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => void;
  /**
   * Lets the draft go; nothing was started, so nothing is left behind. One
   * that held words or files raises a toast whose Undo puts it back and
   * shows its tab (`onDraftRestored`).
   */
  onDiscardDraft: (draftId: string) => void;
  /**
   * Starts the draft's agent with the words as its prompt, never the task,
   * and the files attached to them, on the choice where one was made and else the account's default,
   * with the MCP servers the draft switched off, where `runsOn` names, else where the service decides,
   * in the mode `permissionMode` names, else the member's Default permissions; the
   * agent's tab opens as a Start's does. Answers why it did not start, or
   * nothing once it did.
   */
  startPrompt: (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers?: readonly string[],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ) => Promise<StartFailure | undefined>;
  /**
   * Starts the draft's fork: from its source at its message, under the
   * draft's key, with the box's words and files as a note where it holds
   * any, the MCP servers the draft switched off, the choice
   * where one was made, the place where one was picked, and the mode where one was picked; the agent's tab opens as a Start's does. Answers
   * why it did not start, or nothing once it did.
   */
  startFork: (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers?: readonly string[],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ) => Promise<StartFailure | undefined>;
  /**
   * Sends the draft through the suggestion it was opened from, once: the
   * box's words and files, the choice where one was made and else the
   * account's default, and the title and branch the suggestion named; the
   * agent's tab opens as a Start's does. Answers why nothing started, or
   * nothing once it did.
   */
  startSuggestion: (
    draftId: string,
    suggestion: DraftSuggestion,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers?: readonly string[],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ) => Promise<StartFailure | undefined>;
  /** Brings back the archived agent a surface draws alone, as its own page does; none from here, where every agent is a task's. */
  onUnarchive: (() => void | Promise<void>) | undefined;
  /** Continues one agent in a new one on its whole transcript, the developer's words and files as its note, its tab opening as a Start's does; present exactly while a Start could run. */
  continueAgent: AgentContinuer | undefined;
  start: {
    /** Whether a Start could run now: a task is open. */
    available: boolean;
    /** Whether a Start is out. */
    busy: boolean;
    /** Starts an agent on the choice given, or on the account's default with none; answers why it did not start, with the answer that said so as its cause, or nothing once it did or while it could not be pressed. */
    onPress: (choice?: ModelChoice) => Promise<StartFailure | undefined>;
    /** The agent a Start on the open task is still making, its tab standing under the press's key until the service answers; none while none is out. */
    pending?: StartingAgent | undefined;
  };
  /** Stops one agent, answering whether the service took the Stop, which the task list then carries; a refusal is said in a toast. */
  onStop: (agentId: string) => Promise<boolean>;
  /** Takes one agent back to just before one of the developer's lines, stopping it first. */
  onRewind: (agentId: string, messageId: string, restoreFiles?: boolean) => Promise<AgentActAnswer>;
  /** Starts one agent's harness on a fresh session in the same agent (`/clear`), answering whether the service did; a refusal is said in a toast. */
  onClear: (agentId: string) => Promise<boolean>;
  /** Sends one agent a message under the key the composer made. */
  onMessage: MessageSender;
  /**
   * A failed turn's Try again: sends again the lines the agent's failed turn
   * never took, or, where none was lost, the words given as the developer's
   * own; answers whether the service took it, a refusal said in a toast.
   */
  onRetry: (agentId: string, words: string) => Promise<boolean>;
  /** Changes one agent's model and effort for its next step, drawn at once by the host. */
  onChoose: ChoiceWriter;
  /** Switches one agent's MCP servers for its next turn on, drawn at once by the host; a refusal is said in a toast. */
  onSwitchServers: ServersWriter;
  /** Changes one agent's permission mode from its next turn, drawn at once by the host. */
  onPermissionMode: PermissionModeWriter;
  /** Answers one tool call an agent holds: allow, allow for the agent, or deny with words. */
  onAnswerApproval: ApprovalAnswerWriter;
  /** Opens Settings on its Integrations page, where an MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page at the provider's harness row, where the developer's key for it is; at the page's top where none is known. */
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  /** Whether an archive asked here is still out, the agent it took coming back should the service refuse it. */
  archiving: boolean;
  /** The rename a surface renaming an agent holds its own mutation over, drawn at once by the host, with how its refusal is asked, read back, and said. */
  rename: RenameTerms<AgentActAnswer, AgentRenameAsk> & { readonly options: AgentRenameMutation };
  /**
   * Archives one agent, a turn it still runs stopped first, or brings it
   * back, drawn at once by the host, and offering Undo in a toast, which ⌘Z
   * reaches too unless a question was `asked` first; a refusal puts it back
   * and is answered rather than said, for the caller to say in its dialog or
   * a toast of its own.
   */
  /** Archives or unarchives an agent, answering whether it was kept, with what refused it beneath a refusal. */
  onArchive: (agentId: string, archived: boolean, how?: ArchivePress) => Promise<ActedResult>;
  /** The same archive, as a question asking it first holds its own mutation over it. */
  archiveAgent: AgentArchiveMutation;
  /** The same archive of several agents at once, as a selection holds its own mutation over it: one toast, with one Undo, says every agent it kept. */
  archiveAgents: AgentsArchiveMutation;
  /** An agent's delete, as the question asking it holds its own mutation over it, answered as that question reads it. */
  deleteAgent: AgentDeleteMutation;
  /** Reads one agent again now by its id, as its own page reads it, answering it as it stands, or nothing where the read did not land. */
  readAgent: (agentId: string) => Promise<AgentSummary | undefined>;
  /** One read of an agent's transcript past a cursor at once, as Copy transcript asks it. */
  readTranscript: TranscriptReader;
  /** Each of the task's agents' pull requests, by agent, of those that have one, as the task list carries them (`useListedPullRequests`). */
  pullRequests: ReadonlyMap<string, AgentPullRequest>;
  /** Each pull request a Pull request tab names by its number, by agent and then by number (`pull-request-number.ts`), as the host holds what was published of it while a surface holds it. */
  numberedPullRequests: ByPullRequestTab<AgentPullRequest>;
  /**
   * One pull request's chapters generated for its head now, or the
   * generation already under way; answers once the generation lands, which
   * may take minutes, with whether chapters can be generated and the
   * workspace's newest chapters, whatever head they were made for; or why
   * there are none, a port that refused included.
   */
  generateChapters: (agentId: string, number?: number) => Promise<PullRequestChaptersAnswerView>;
  /** The words a dictation into an agent's box is likely to say, read off the open task. */
  keywords: readonly string[];
  /** The skills of the open plan's repository a `/` in an agent's box offers, read once for the plan (`repository-skills.ts`), or of the agent's own where no plan is open; nothing while neither names a workspace, or while the Skills experiment is off. */
  readSkills: SkillSource | undefined;
  /** One answer to an inbox item, as a card sends it. */
  answerInbox: InboxAnswerer;
  /** One message on an inbox item's thread, as its box sends it. */
  messageInbox: InboxMessenger;
  /** One thread started with an agent, as an Inbox item's box sends it when its checkbox is ticked. */
  startInboxThread: InboxThreadStarter;
  /** One read of an inbox item's image, as its card asks it. */
  readInboxImage: InboxImageReader;
}

/**
 * An agent not yet started: the key its first message starts it under, the
 * words written so far, the files attached to them, the choice made on its
 * chip, none while it runs on the account's default, or on its source's
 * where it is a fork, the MCP servers switched off for it, where it runs
 * where the developer picked it, the permission mode its Permissions row
 * picked, and the agent and message it forks, where it is a fork
 * (`fork-model.ts`).
 */
export interface AgentDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly fork?: AgentFork | undefined;
  /** The suggestion in another agent's reply it was opened from, which it is sent through; none for any other draft. */
  readonly suggestion?: DraftSuggestion | undefined;
  /** Where its agent runs, as its Runs on chip picked it; none until picked, when the service decides (`runs-on.tsx`'s `useStartRunsOn`). */
  readonly runsOn?: AgentRunsOnRequest | undefined;
  /** The mode its agent starts in, as its Permissions row picked it; none until picked, when it starts on the member's Default permissions (`useNewAgentPermissionMode`). */
  readonly permissionMode?: AgentPermissionMode | undefined;
  /** Why the service refused the agent of a draft New task handed over (`onHandDraft`), which its tab shows under the box until the next send. */
  readonly refused?: StartFailure | undefined;
}

/** What a draft agent holds beside its words and files: its key, what its chips chose, the fork it is, and why New task's start of it was refused. */
type DraftChoices = Pick<
  AgentDraft,
  | "id"
  | "choice"
  | "disabledServers"
  | "fork"
  | "suggestion"
  | "runsOn"
  | "permissionMode"
  | "refused"
>;

/** The plan's draft agent: the key and chips held, with the words and files kept for it, or the words kept under their own key where nothing is held, as after a relaunch. */
function taskDraft(
  held: DraftChoices | undefined,
  kept: KeptDraft<NewAgentPlace> | undefined,
): AgentDraft | undefined {
  const id = held?.id ?? kept?.place.draftId;

  if (id === undefined) return undefined;

  return {
    id,
    prompt: kept?.text ?? "",
    attachments: kept?.attachments ?? [],
    choice: held?.choice,
    disabledServers: held?.disabledServers ?? [],
    // Note that a fork is kept with the words too, so a relaunch keeps the draft a fork.
    ...forkOf(held === undefined ? kept?.place.fork : held.fork),
    ...suggestionOf(held === undefined ? kept?.place.suggestion : held.suggestion),
    ...runsOnOf(held?.runsOn),
    ...pickedModeOf(held?.permissionMode),
    ...(held?.refused === undefined ? undefined : { refused: held.refused }),
  };
}

/** What New task hands a task it started whose agent was refused: the key that start carried, the prompt, its files, the choice picked on its chip, none where the chip was left on the account's default, which the draft's tab then reads afresh, the servers its + menu switched off, the mode its Permissions row picked, none where left on the default, and why. */
interface HandedDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly permissionMode?: AgentPermissionMode | undefined;
  readonly refused: StartFailure;
}

/** A draft's fork as an optional key, absent where it forks nothing. */
function forkOf(fork: AgentFork | undefined): { readonly fork?: AgentFork } {
  return fork === undefined ? {} : { fork };
}

/** A draft's suggestion as an optional key, absent where it was opened from none. */
function suggestionOf(suggestion: DraftSuggestion | undefined): {
  readonly suggestion?: DraftSuggestion;
} {
  return suggestion === undefined ? {} : { suggestion };
}

/** A draft's permission mode as an optional key, absent where none was picked. */
function pickedModeOf(permissionMode: AgentPermissionMode | undefined): {
  readonly permissionMode?: AgentPermissionMode;
} {
  return permissionMode === undefined ? {} : { permissionMode };
}

/** A draft's place as an optional key, absent where none was picked. */
function runsOnOf(runsOn: AgentRunsOnRequest | undefined): {
  readonly runsOn?: AgentRunsOnRequest;
} {
  return runsOn === undefined ? {} : { runsOn };
}

/** Nothing laid in after a draft's own words as they move. */
const NOTHING_CARRIED: Pick<Draft, "text" | "attachments"> = { text: "", attachments: [] };

/** The agent a Start is still making: the key its press minted, which its tab stands under until the service answers, and the model it was chosen on, none for the account's default. */
interface StartingAgent {
  readonly key: string;
  readonly model: string | undefined;
}

/** What the toast says as a draft holding words or files is let go. */
const DRAFT_CLOSED = "Draft closed";

/** A draft let go while it held words or files, kept for its Undo: the plan it stood on, its key and chips, and its words and files. */
interface ClosedDraft {
  readonly on: string;
  readonly choices: DraftChoices;
  readonly words: Pick<Draft, "text" | "attachments">;
}

/** What a draft holds beside its words and files, as the drafts hold it. */
function choicesOf(draft: AgentDraft): DraftChoices {
  const { id, choice, disabledServers, fork, suggestion, runsOn, permissionMode, refused } = draft;

  return {
    id,
    choice,
    disabledServers,
    ...forkOf(fork),
    ...suggestionOf(suggestion),
    ...runsOnOf(runsOn),
    ...pickedModeOf(permissionMode),
    ...(refused === undefined ? undefined : { refused }),
  };
}

/** Whether a draft holds no words or files. */
function holdsNoWords(draft: AgentDraft): boolean {
  return draft.prompt === "" && draft.attachments.length === 0;
}

/** Whether a draft holds nothing at all: no words or files, no fork or suggestion, and its chips as they open. */
export function holdsNothing(draft: AgentDraft): boolean {
  return (
    holdsNoWords(draft) &&
    draft.fork === undefined &&
    draft.suggestion === undefined &&
    draft.choice === undefined &&
    draft.disabledServers.length === 0 &&
    draft.runsOn === undefined &&
    draft.permissionMode === undefined &&
    draft.refused === undefined
  );
}

/** The draft as it would be let go, kept for its Undo, or nothing where it holds no words or files. */
function closedDraft(on: string, draft: AgentDraft): ClosedDraft | undefined {
  if (holdsNoWords(draft)) return undefined;

  return {
    on,
    choices: choicesOf(draft),
    words: { text: draft.prompt, attachments: draft.attachments },
  };
}

/** Where a closed draft is read and put back: the plan the drafts stand on now, the draft standing there, and the hook's own letting go and putting back. */
interface DraftDoors {
  readonly taskId: string | undefined;
  readonly draft: AgentDraft | undefined;
  readonly letGo: (draftId: string) => void;
  readonly restore: (closed: ClosedDraft) => void;
}

/** Whether `draft` holds the words and files `words` names, as a draft put back holds them until they are written anew. */
function holdsWords(draft: AgentDraft, words: ClosedDraft["words"]): boolean {
  return draft.prompt === words.text && draft.attachments.length === words.attachments.length;
}

/**
 * A draft closed while it held words or files, as ⌘Z and its toast's Undo
 * take it back: put back only while the plan it was closed on is open and
 * it is still closed, and closed again by ⇧⌘Z only while it stands as Undo
 * put it back, under its own key with its words unchanged.
 */
const DRAFT_CLOSING = {
  words: DRAFT_CLOSED,
  unmasked: () => true,
  act: ({ letGo }, { choices }) => letGo(choices.id),
  undo: ({ restore }, closed) => restore(closed),
  holds: ({ taskId, draft }, { on, choices }) => on === taskId && draft?.id !== choices.id,
  undone: ({ taskId, draft }, { on, choices, words }) =>
    on === taskId && draft?.id === choices.id && holdsWords(draft, words),
} satisfies LocalWrite<DraftDoors, ClosedDraft>;

/** A Start on its way or asked again: the task, the key the press minted, and the choice it was for. */
interface PendingStart {
  taskId: string;
  key: string;
  choice: ModelChoice | undefined;
}

/**
 * Starts a new agent on the open task from one of its agents' whole
 * transcript, with the developer's words and the files attached to them as
 * its note where given, where `runsOn` names, which moves the agent
 * there (`move-agent.tsx`), and on `choice` where one is given, which a
 * refused turn's offer names (`refusal-offer.ts`), else on the source's
 * own; answers why it did not start, or nothing once it did.
 */
export type AgentContinuer = (
  agentId: string,
  note?: string,
  attachments?: readonly AgentAttachment[],
  runsOn?: AgentRunsOnRequest,
  choice?: ModelChoice,
) => Promise<Failure | undefined>;

/** A continue on its way or asked again: the task or the page's agent it was pressed on, the key the press minted, the note and files it carried, where it moves the agent, if anywhere, and the choice it runs on, if one was named. */
interface PendingContinue {
  on: string;
  key: string;
  note: string | undefined;
  attachments: readonly AgentAttachment[];
  runsOn: AgentRunsOnRequest | undefined;
  choice: ModelChoice | undefined;
}

/** Whether two presses name the same place, or both none. */
function samePlace(a: AgentRunsOnRequest | undefined, b: AgentRunsOnRequest | undefined): boolean {
  const deviceOf = (place: AgentRunsOnRequest | undefined) =>
    place !== undefined && "deviceId" in place ? place.deviceId : undefined;

  return a?.machine === b?.machine && deviceOf(a) === deviceOf(b);
}

/** Whether two presses carry the same files, the same ones in the same order. */
function sameFiles(a: readonly AgentAttachment[], b: readonly AgentAttachment[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

/**
 * One agent read by its id as its own page reads it, wherever it stands,
 * on a task or on none; nothing where it could not be read. A surface that
 * holds no list of its own, such as the sidebar's row of an agent with no
 * task, reads it so before it archives it unasked.
 */
export function readAgentById(
  queryClient: QueryClient,
  agentId: string,
): Promise<AgentSummary | undefined> {
  // Note that a page names no automation by null where a summary leaves the key out.
  return queryClient.fetchQuery(agentPageQueryOptions(agentId)).then(
    (answer) => {
      if ("failure" in answer) return undefined;

      const {
        automationId,
        origin: _origin,
        workspaceId: _workspaceId,
        repository: _repository,
        ...agent
      } = answer.agent;

      return automationId === null ? agent : { ...agent, automationId };
    },
    () => undefined,
  );
}

/** Whether two choices ask the same of a Start, read as `choiceRequest` sends them: only the standard window is a window apart. */
function sameChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return (
    a?.model === b?.model &&
    a?.effort === b?.effort &&
    (a?.contextWindow === CONTEXT_WINDOW.STANDARD) ===
      (b?.contextWindow === CONTEXT_WINDOW.STANDARD)
  );
}

/** Where the newest read of the models stands: none asked yet, under way, landed, or failed or out past its bound. */
export const MODELS_READ = {
  UNREAD: "unread",
  READING: "reading",
  READ: "read",
  FAILED: "failed",
} as const;

type ModelsReadState = (typeof MODELS_READ)[keyof typeof MODELS_READ];

/**
 * The newest read of the models, stamped with the generation that read
 * took, so a reader can tell a read made since it looked from one before,
 * whatever the list it lands holds: two reads listing no device hand the
 * same empty list through the steady doors.
 */
export interface ModelsRead {
  readonly state: ModelsReadState;
  readonly generation: number;
}

export function useAgents(input: {
  /** The open task, or none. */
  taskId: string | undefined;
  /** The open task's repository, or null while it names none. */
  repository: string | null;
  /**
   * Every agent the task list followed live carries, the archived ones
   * among them; none where it is not followed, or does not list the open
   * task.
   */
  listedAgents?: readonly AgentSummary[] | undefined;
  /** Where the task list's read stands, which an answer on the task's Inbox reads again where it failed: failed, and its Try again; none where nothing reads it again. */
  list?: { readonly failed: boolean; readonly onRetry: () => void } | undefined;
  /**
   * The pull request of every agent the task list followed live carries,
   * on a task or with none, the archived ones among them; none where it is
   * not followed.
   */
  listedPullRequests?: readonly ListedPullRequest[] | undefined;
  /** Opens Settings on its Integrations page. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page. */
  /** The signed-in account's id, whose own agents carry no "Started by". */
  me?: string | undefined;
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  /** Called with the agent a Start made, so its tab opens. */
  onStarted: (agentId: string) => void;
  /** Called with the plan and key of a draft an Undo put back, so its tab opens again. */
  onDraftRestored?: (on: string, draftId: string) => void;
  /** The words a dictation into an agent's box is likely to say; none where nothing is open. */
  keywords?: readonly string[];
  /** Mints one press's key. */
  mintKey?: () => string;
}): AgentsControl {
  const { taskId, repository } = input;
  // Note that the reads below stay on `act` until they move to queries; every write is a mutation.
  const queryClient = useQueryClient();

  const { mutateAsync: sendStart, isPending: starting } = useMutation(
    sendMutation(ACT_KIND.AGENTS_START, () => SENTRY_SEND_SPAN.AGENT_START),
  );

  const { mutateAsync: sendStop } = useMutation(actMutation(ACT_KIND.AGENTS_STOP));
  const sendSuggestion = useSuggestionSender();
  const { mutateAsync: sendRewind } = useMutation(actMutation(ACT_KIND.AGENTS_REWIND));
  const { mutateAsync: sendClear } = useMutation(actMutation(ACT_KIND.AGENTS_CLEAR));

  const { mutateAsync: sendMessage } = useMutation(
    sendMutation(ACT_KIND.AGENTS_MESSAGE, () => SENTRY_SEND_SPAN.AGENT_SEND),
  );

  const { mutateAsync: sendChoice } = useMutation(actMutation(ACT_KIND.AGENTS_CHOOSE));
  const { mutateAsync: sendServers } = useMutation(actMutation(ACT_KIND.AGENTS_SERVERS));

  const { mutateAsync: sendPermissionMode } = useMutation(
    actMutation(ACT_KIND.AGENTS_PERMISSION_MODE),
  );

  const { mutateAsync: sendApprovalAnswer } = useMutation(
    actMutation(ACT_KIND.AGENTS_ANSWER_APPROVAL),
  );

  const { mutateAsync: sendArchive } = useMutation(actMutation(ROW_WRITE.AGENT_ARCHIVE.kind));
  const { mutateAsync: sendChapters } = useMutation(actMutation(ACT_KIND.CHAPTERS_GENERATE));
  const { mutateAsync: sendInboxAnswer } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_ANSWER));
  const { mutateAsync: sendInboxMessage } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_MESSAGE));
  const { mutateAsync: sendInboxStart } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_START));
  // Note that an archive is out while any of the window's is, ⌘Z's sends among them, as the host draws each at once.
  const archiving = useIsMutating({ mutationKey: [ROW_WRITE.AGENT_ARCHIVE.kind] }) > 0;
  const mintKey = input.mintKey ?? (() => crypto.randomUUID());
  const offered = useOfferedModels();

  const [modelsRead, setModelsRead] = useState<ModelsRead>({
    state: MODELS_READ.UNREAD,
    generation: 0,
  });

  const modelsGeneration = useRef(0);
  // Each task's draft's key and chip, by the task's id; its words and files are kept apart.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftChoices>>(new Map());
  const heldDraft = taskId === undefined ? undefined : drafts.get(taskId);
  const keptDraft = useNewAgentDraft(taskId, heldDraft?.id);
  const writer = useDraftWriter();
  const draft = taskId === undefined ? undefined : taskDraft(heldDraft, keptDraft);

  // The agent New task last started, and its task.
  const [started, setStarted] = useState<{ taskId: string; agent: AgentSummary } | undefined>(
    undefined,
  );

  const pending = useRef<PendingStart | undefined>(undefined);

  // The Start out now on a task, whose tab stands under its key until it answers.
  const [pressed, setPressed] = useState<{ taskId: string; starting: StartingAgent } | undefined>(
    undefined,
  );

  // Each agent continued's press, by the agent's id, held until its Start lands.
  const continues = useRef(new Map<string, PendingContinue>());
  const toast = useToast();

  const failed = useCallback(
    (words: string, failure: ShownFailure) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        failure,
      }),
    [toast],
  );

  const limitReached = useCallback(
    (words: string) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.ATTENTION,
        // The clock the usage-limit card wears, so a limit reads as the one thing wherever it is said.
        glyph: GLYPH.TIME,
      }),
    [toast],
  );

  // Note that the acts and the opening are read through a ref, because the
  // tab hands new closures on every render and a read is owed to the task
  // opening, not to a render.
  const latest = useRef(input);
  latest.current = input;

  // The agent New task just started on the open task, which stands until the list carries it, so its tab draws at once.
  const seed = useMemo(() => (started === undefined ? undefined : [started.agent]), [started]);
  const held = taskId !== undefined && started?.taskId === taskId ? seed : undefined;
  // The task's agents as the followed task list carries them; none where it does not carry the task.
  const { listedAgents } = input;

  const listedHere = useMemo(
    () =>
      taskId === undefined ? undefined : listedAgents?.filter((agent) => agent.planId === taskId),
    [listedAgents, taskId],
  );

  // Note that an agent New task holds stands beside the list's until the list first carries it,
  // and leaves with it once it no longer does, so a tab never leaves between the two.
  const subject = taskId;
  const carried = useRef({ subject, ids: new Set<string>() });

  if (carried.current.subject !== subject) carried.current = { subject, ids: new Set() };

  for (const agent of listedHere ?? []) carried.current.ids.add(agent.id);

  const standing = useMemo(() => {
    if (listedHere === undefined) return held;
    const arriving = held?.filter((agent) => !carried.current.ids.has(agent.id)) ?? [];

    return arriving.length === 0 ? listedHere : [...listedHere, ...arriving];
  }, [listedHere, held]);

  const agents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt === undefined),
    [standing],
  );

  // Note that a Start out on the task stands among its tabs under the press's key, the task's
  // agents known or not, since it is the tab the press opens.
  const pressedHere = pressed?.taskId === taskId ? pressed?.starting : undefined;

  const agentIds = useMemo(() => {
    const ids = agents?.map((agent) => agent.id);

    return pressedHere === undefined ? ids : [...(ids ?? []), pressedHere.key];
  }, [agents, pressedHere]);

  const archivedAgents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt !== undefined),
    [standing],
  );

  const { list } = input;
  const retryList = list?.onRetry;

  const onRetryList = useCallback(() => {
    if (list?.failed === true) retryList?.();
  }, [list?.failed, retryList]);
  // The archives asked here and still out.

  /** Settles the ask of `generation` where it is still the newest: read at any point, failed only while it is out. */
  const settleModels = useCallback((generation: number, state: ModelsReadState) => {
    setModelsRead((was) =>
      was.generation === generation &&
      (state === MODELS_READ.READ || was.state === MODELS_READ.READING)
        ? { state, generation }
        : was,
    );
  }, []);

  // The newest ask that landed, whose settling waits on what the slice then holds.
  const [modelsLanded, setModelsLanded] = useState(0);
  /**
   * Asks the host for the models again, stamping the ask with a generation
   * of its own. Note that only the newest ask settles where the read
   * stands, and that one still out past its bound is said as failed, so
   * nothing waits on it for ever; should it land after, it settles as read.
   * An ask that landed settles once the slice says how it went (below),
   * since a Try again answers alike whether its ask was answered or not.
   * The ask and its bound run as one fiber, stopped by the next ask or as
   * the hook leaves, so neither sets state on a tab no longer standing.
   */
  const { mutateAsync: retryModels } = useMutation(modelsRetryMutation());
  const stopModelsRead = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => stopModelsRead.current?.(), []);

  const readModels = useCallback(() => {
    modelsGeneration.current += 1;
    const generation = modelsGeneration.current;
    // The menu reads again while a read is out, so a Retry shows its reading.
    setModelsRead({ state: MODELS_READ.READING, generation });
    stopModelsRead.current?.();

    stopModelsRead.current = rendererFork(
      Effect.all(
        [
          Effect.promise(() => retryModels().catch(() => undefined)).pipe(
            Effect.andThen(Effect.sync(() => setModelsLanded(generation))),
          ),
          Effect.sleep(Duration.millis(MODELS_READ_BOUND_MS)).pipe(
            Effect.andThen(Effect.sync(() => settleModels(generation, MODELS_READ.FAILED))),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ),
    );
  }, [retryModels, settleModels]);

  // Note that a landed ask reads as read only where the slice holds models, and as failed where it never answered, so a card waiting on its devices never takes no list for an empty one.
  useEffect(() => {
    if (modelsLanded === 0) return;

    if (offered.data !== undefined) settleModels(modelsLanded, MODELS_READ.READ);
    else if (offered.isError) settleModels(modelsLanded, MODELS_READ.FAILED);
  }, [modelsLanded, offered.data, offered.isError, settleModels]);

  /** One Start asked of the service on the task, or, from the page's agent, where that agent is, held as under way until it answers. */
  const askStart = (
    on: string,
    asked: Omit<PortActPayload<typeof ACT_KIND.AGENTS_START>, "taskId">,
  ): Promise<AgentActAnswer> => {
    // Note that a Start from the page's agent names no task, so the service puts it where that agent is.
    const where = on === taskId ? { taskId: on } : undefined;

    return sendStart({ ...where, ...asked }).catch(agentUnreached);
  };

  /**
   * A Start that landed: its tab opens on the agent the task list already
   * carries. Note that one landing after the developer left the task opens
   * no tab on the task now open.
   */
  const landed = (on: string, agent: Pick<AgentSummary, "id">) => {
    if (latest.current.taskId !== on) return;
    latest.current.onStarted(agent.id);
  };

  const pressStart = async (choice?: ModelChoice): Promise<StartFailure | undefined> => {
    if (taskId === undefined || starting) return undefined;
    // The key is the press's own, and a press asked again after the service
    // did not answer carries the one it minted, so the service answers the
    // agent it may already have started rather than a second one.
    const held = pending.current;

    const key =
      held !== undefined && held.taskId === taskId && sameChoice(held.choice, choice)
        ? held.key
        : mintKey();

    pending.current = { taskId, key, choice };
    // The agent's tab opens on the press, under its key, and gives way to the agent once it is made.
    setPressed({ taskId, starting: { key, model: choice?.model } });
    latest.current.onStarted(key);

    const answer = await askStart(taskId, {
      idempotencyKey: key,
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });

    setPressed((was) => (was?.starting.key === key ? undefined : was));

    if ("failure" in answer) {
      // Only a service that never answered is asked again under the same key.
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;

      return { ...startFailureNote(answer, taskId), cause: answer };
    }

    pending.current = undefined;
    landed(taskId, answer.agent);

    return undefined;
  };

  // Note that a press carries the key its agent's last press minted while the
  // service has not answered it and the words, files, and place are the same,
  // so a press asked again opens the agent the first may already have started.
  const continueAgent: AgentContinuer = async (
    sourceId,
    note,
    attachments = [],
    runsOn,
    choice,
  ) => {
    if (taskId === undefined) return undefined;
    const held = continues.current.get(sourceId);
    const carried = note !== undefined || attachments.length > 0 ? (note ?? "") : undefined;

    const key =
      held !== undefined &&
      held.on === taskId &&
      held.note === carried &&
      sameFiles(held.attachments, attachments) &&
      samePlace(held.runsOn, runsOn) &&
      sameChoice(held.choice, choice)
        ? held.key
        : mintKey();

    continues.current.set(sourceId, {
      on: taskId,
      key,
      note: carried,
      attachments,
      runsOn,
      choice,
    });

    // Note that only this press's own key is let go, because another press of the agent, to another
    // place or with other words, may have replaced it while this one was out.
    const forgetPress = () => {
      if (continues.current.get(sourceId)?.key === key) continues.current.delete(sourceId);
    };

    const answer = await askStart(taskId, {
      idempotencyKey: key,
      from: { agentId: sourceId },
      ...(carried === undefined ? undefined : { note: carried }),
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(runsOn === undefined ? undefined : { runsOn }),
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });

    if ("failure" in answer) {
      // Only a service that never answered is asked again under the same key.
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) forgetPress();
      const refused = continueFailureNote(answer, taskId ?? null);

      const shown = {
        surface: FAILURE_SURFACE.AGENT_START,
        cause: answer,
        about: { agentId: sourceId },
      };

      // Note that a move is chosen from a menu, which has no line beside it to say why, so its
      // refusal is said in a toast wherever the developer stands.
      const away = latest.current.taskId !== taskId;

      // A plan's reached limit is said calmly in its own words, never as a failure to start.
      if (answer.failure === AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED) {
        if (runsOn !== undefined || away) limitReached(refused.text);
      } else if (runsOn !== undefined) failed(refused.text, shown);
      else if (away) failed(START_FAILED_AWAY, shown);

      return refused;
    }

    forgetPress();
    landed(taskId, answer.agent);

    return undefined;
  };

  /** The drafts with the plan's key and chips set to `next`, or let go where it is nothing. */
  const withDraft = (on: string, next: DraftChoices | undefined) =>
    setDrafts((was) => {
      const held = new Map(was);

      if (next === undefined) held.delete(on);
      else held.set(on, next);

      return held;
    });

  /** Lets the task's held draft go only while it is still the one under `draftId`, so a draft that took its place since keeps its chips. */
  const dropHeld = (on: string, draftId: string) =>
    setDrafts((was) => {
      if (was.get(on)?.id !== draftId) return was;
      const held = new Map(was);
      held.delete(on);

      return held;
    });

  /** Lets a draft agent go by its key, its words and files with it. */
  const letGo = (draftId: string) => {
    for (const [on, held] of drafts) if (held.id === draftId) dropHeld(on, draftId);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
  };

  const onNewDraft = (): string => {
    if (draft !== undefined) return draft.id;
    const id = mintKey();

    if (taskId !== undefined) {
      withDraft(taskId, { id, choice: undefined, disabledServers: [] });
    }

    return id;
  };

  /**
   * Where a draft's words are kept: under its key, beside the fork it is.
   * Note that an agent page's draft is kept with its agent's id as the
   * `planId`, so the drafted plans list that id too; no task has it, so no
   * row reads it as drafted.
   */
  const wordsPlace = (
    on: string,
    id: string,
    fork: AgentFork | undefined,
    suggestion?: DraftSuggestion,
  ): NewAgentPlace => ({
    kind: DRAFT_PLACE.NEW_AGENT,
    planId: on,
    draftId: id,
    ...forkOf(fork),
    ...suggestionOf(suggestion),
  });

  /**
   * The open task's draft's words and files kept again under `id` and
   * `fork`, and no longer where they were, with the words and files
   * `carried` laid in after them, a blank line between the two.
   */
  const moveWords = (
    on: string,
    id: string,
    fork: AgentFork | undefined,
    carried: Pick<Draft, "text" | "attachments"> = NOTHING_CARRIED,
    suggestion?: DraftSuggestion,
  ) => {
    const text = [draft?.prompt ?? "", carried.text].filter((each) => each !== "").join("\n\n");
    const attachments = [...(draft?.attachments ?? []), ...carried.attachments];

    if (draft !== undefined) {
      const was = draft.id;
      writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === was);
    }

    writer.update(wordsPlace(on, id, fork, suggestion), (kept) => ({ ...kept, text, attachments }));
  };

  // Note that a fork joins the draft the task holds, so words already
  // written stay, under a key of the fork's own, because a Start the draft
  // sent and never heard answered is answered again under its old key; its
  // chips are put back on the source's, which a fork runs on unless the
  // developer picks otherwise.
  const onForkDraft = (fork: AgentFork): string => {
    const id = mintKey();

    if (taskId === undefined) return id;
    const source = standing?.find((agent) => agent.id === fork.agentId);
    moveWords(taskId, id, fork);
    withDraft(taskId, {
      id,
      choice: undefined,
      disabledServers: source?.disabledServers ?? [],
      fork,
    });

    return id;
  };

  // Note that a continue joins the task's draft as a fork does, under a key
  // of its own for the same reason, unless the draft already continues the
  // same agent and nothing is laid in, when it keeps its key, so a Start it
  // sent and never heard answered is answered with the agent it made; words
  // or files laid in make another request, which that agent never had.
  const onContinueDraft = (
    sourceId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ): string => {
    const joins = draft?.fork?.agentId === sourceId && draft.fork.messageId === undefined;
    const adds = words.trim() !== "" || attachments.length > 0;
    const id = joins && !adds ? draft.id : mintKey();

    if (taskId === undefined) return id;
    const source = standing?.find((agent) => agent.id === sourceId);
    const fork = continueFork(sourceId);
    moveWords(taskId, id, fork, { text: words.trim(), attachments });
    withDraft(taskId, {
      id,
      choice: joins ? draft.choice : undefined,
      disabledServers: joins ? draft.disabledServers : (source?.disabledServers ?? []),
      fork,
      ...runsOnOf(joins ? draft.runsOn : undefined),
      ...pickedModeOf(joins ? draft.permissionMode : undefined),
    });

    return id;
  };

  // Note that a suggestion joins the task's draft as a continue does, under
  // a key of its own, the brief laid in after any words already written. A
  // draft that already holds the same suggestion is answered as it stands,
  // so pressing it again opens what was drafted rather than a second brief.
  // A draft of another suggestion lends it no words, which would go out
  // through this suggestion: it is closed as its tab's × closes it, with
  // Undo, and this one opens on its brief alone. The key starts nothing: the
  // send goes through the suggestion, which the service keys by its button.
  const onSuggestDraft = (
    suggestion: DraftSuggestion,
    words: string,
    choice: ModelChoice | undefined,
  ): string => {
    if (draft?.suggestion?.buttonId === suggestion.buttonId) return draft.id;
    const id = mintKey();

    if (taskId === undefined) return id;
    const brief = { text: words.trim(), attachments: [] };

    if (draft?.suggestion === undefined) {
      moveWords(taskId, id, undefined, brief, suggestion);
    } else {
      onDiscardDraft(draft.id);
      writer.update(wordsPlace(taskId, id, undefined, suggestion), (kept) => ({
        ...kept,
        ...brief,
      }));
    }

    withDraft(taskId, { id, choice, disabledServers: [], suggestion });

    return id;
  };

  // Note that an agent's page starts nothing but from its agent, so a fork let go there lets its draft go.
  const onDropFork = () => {
    if (draft === undefined) return;

    if (taskId === undefined) {
      letGo(draft.id);

      return;
    }

    moveWords(taskId, draft.id, undefined);
    withDraft(taskId, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...runsOnOf(draft.runsOn),
      ...pickedModeOf(draft.permissionMode),
    });
  };

  /** The open plan's draft's words and files moved on from those kept for it. */
  const writeWords = (next: (was: Draft) => Draft) => {
    if (taskId === undefined || draft === undefined) return;
    writer.update(wordsPlace(taskId, draft.id, draft.fork, draft.suggestion), next);
  };

  const onDraftChange = (
    change: Partial<
      Pick<
        AgentDraft,
        "prompt" | "choice" | "disabledServers" | "runsOn" | "permissionMode" | "refused"
      >
    >,
  ) => {
    if (taskId === undefined || draft === undefined) return;
    const { prompt, ...choices } = change;

    if (prompt !== undefined) writeWords((was) => ({ ...was, text: prompt }));

    if (Object.keys(choices).length === 0) return;
    withDraft(taskId, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...(draft.fork === undefined ? undefined : { fork: draft.fork }),
      // Note that a chip changed keeps the suggestion the draft was opened from, so its send still goes through it.
      ...suggestionOf(draft.suggestion),
      ...runsOnOf(draft.runsOn),
      ...pickedModeOf(draft.permissionMode),
      ...(draft.refused === undefined ? undefined : { refused: draft.refused }),
      ...choices,
    });
  };

  // Note that the words are kept as any draft's are, under the task New
  // task started and the key handed, so they outlast the tab, and the task
  // opens on the draft's tab until the agent starts. The key is the one
  // New task's start carried, so a Retry whose agent that start made after
  // all answers it rather than a second one.
  const onHandDraft = (on: string, handed: HandedDraft) => {
    writer.update(wordsPlace(on, handed.id, undefined), (was) => ({
      ...was,
      text: handed.prompt,
      attachments: handed.attachments,
    }));
    withDraft(on, {
      id: handed.id,
      choice: handed.choice,
      disabledServers: handed.disabledServers,
      ...pickedModeOf(handed.permissionMode),
      refused: handed.refused,
    });
  };

  // Note that the task New task started may not stand open yet as its start
  // answers. Until the task list carries its agent, the agent stands as its
  // task's, so its tab draws at once rather than after the list.
  const onTaskStarted = (on: string, agent: AgentSummary) => {
    setStarted({ taskId: on, agent });
  };

  // Note that the files are changed from the draft as it stands when the
  // change lands, because a file's read lands after the render that began it.
  const onDraftAttachments = (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => writeWords((was) => ({ ...was, attachments: next(was.attachments) }));

  // Note that a draft holding words or files is let go at once, as every
  // act that can be taken back is, and ⌘Z and its toast's Undo put it back.
  const onDiscardDraft = (draftId: string) => {
    const closed =
      taskId === undefined || draft?.id !== draftId ? undefined : closedDraft(taskId, draft);

    if (closed === undefined) {
      letGo(draftId);

      return;
    }

    undoable.current.add(closed.choices.id);
    pressLocal(DRAFT_CLOSING, () => draftDoors.current, closed, closed.choices.id);
  };

  // The drafts closed on the plan open, whose Undo, on its toast and on ⌘Z, is withdrawn as the plan leaves.
  const undoable = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const subject of undoable.current) withdrawUndo(subject);
      undoable.current.clear();
    },
    [taskId],
  );

  // Note that Undo stands only while the plan the draft was closed on is
  // open, so the draft standing in its place now is one this hook reads. A
  // blank one, as a column left with no tab opens, gives way to the draft
  // closed; one holding words, files, a fork, or chips of its own keeps them,
  // the closed draft's words and files laid in after its own, under a key of
  // its own, as a continue's are, since that is another request.
  const restoreDraft = (closed: ClosedDraft) => {
    const { on, choices, words } = closed;
    const standing = draft?.id === choices.id ? undefined : draft;
    const keeps = standing !== undefined && !holdsNothing(standing);
    const id = keeps ? mintKey() : choices.id;

    if (keeps) {
      // Note that the words joined go through a suggestion only where both drafts name the same one or the closed draft names none, never through another's.
      const suggestion =
        choices.suggestion === undefined ||
        choices.suggestion.buttonId === standing.suggestion?.buttonId
          ? standing.suggestion
          : undefined;

      const { suggestion: _standing, ...rest } = choicesOf(standing);
      moveWords(on, id, standing.fork, words, suggestion);
      withDraft(on, { ...rest, ...suggestionOf(suggestion), id });
    } else {
      if (standing !== undefined) letGo(standing.id);
      writer.update(wordsPlace(on, id, choices.fork, choices.suggestion), (was) => ({
        ...was,
        ...words,
      }));
      withDraft(on, choices);
    }

    latest.current.onDraftRestored?.(on, id);
  };

  const draftDoors = useRef<DraftDoors>({ taskId, draft, letGo, restore: restoreDraft });
  draftDoors.current = { taskId, draft, letGo, restore: restoreDraft };

  // Note that the draft's key is the Start's every time it is sent, because
  // nothing a refused send asked was made, and a send whose answer was lost
  // is answered with the agent it already made.
  const startPrompt = async (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers: readonly string[] = [],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ): Promise<StartFailure | undefined> => {
    if (taskId === undefined) return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_TASK };

    const answer = await askStart(taskId, {
      idempotencyKey: draftId,
      prompt,
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(disabledServers.length === 0 ? undefined : { disabledServers }),
      ...(choice === undefined ? undefined : choiceRequest(choice)),
      ...runsOnOf(runsOn),
      ...pickedModeOf(permissionMode),
    });

    if ("failure" in answer) return { ...startFailureNote(answer, taskId), cause: answer };
    dropHeld(taskId, draftId);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
    landed(taskId, answer.agent);

    return undefined;
  };

  // Note that a fork is sent under the draft's key as a prompt is, for the same reason.
  const startFork = async (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers: readonly string[] = [],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ): Promise<StartFailure | undefined> => {
    if (taskId === undefined) return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_TASK };

    const asked = forkStart({
      draftId,
      fork,
      words,
      attachments,
      choice,
      disabledServers,
      runsOn,
      permissionMode,
    });

    const answer = await askStart(taskId, asked);

    if ("failure" in answer) return { ...startFailureNote(answer, taskId ?? null), cause: answer };
    // Note that only this draft is let go, since another suggestion pressed while it went may stand in its place.
    dropHeld(taskId, draftId);
    writer.drop((kept) => kept.kind === DRAFT_PLACE.NEW_AGENT && kept.draftId === draftId);
    landed(taskId, answer.agent);

    return undefined;
  };

  // Note that a suggestion's draft is sent under the suggestion's button,
  // which keys the agent it starts, so a send asked again after its answer
  // was lost is answered with that agent rather than a second one.
  const startSuggestion = async (
    draftId: string,
    suggestion: DraftSuggestion,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers: readonly string[] = [],
    runsOn?: AgentRunsOnRequest,
    permissionMode?: AgentPermissionMode,
  ): Promise<StartFailure | undefined> => {
    if (taskId === undefined) return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_TASK };

    const result = await sendSuggestion(
      {
        agentId: suggestion.agentId,
        buttonId: suggestion.buttonId,
        sent: sentOf(
          suggestion,
          words,
          attachments,
          choice,
          disabledServers,
          runsOn,
          permissionMode,
        ),
      },
      true,
      taskId,
    );

    if ("failure" in result) return result.failure;
    // Note that only this draft is let go, since another suggestion pressed while it went may stand in its place.
    dropHeld(taskId, draftId);
    writer.drop((kept) => kept.kind === DRAFT_PLACE.NEW_AGENT && kept.draftId === draftId);
    landed(taskId, { id: result.reached });

    return undefined;
  };

  // A refused Stop, or one that found nothing to stop yet, leaves the button as it was, so it says so in a toast.
  const onStop = async (agentId: string): Promise<boolean> => {
    const answer = await sendStop({ agentId }).catch(agentUnreached);

    if ("failure" in answer) {
      failed(STOP_FAILED, {
        surface: FAILURE_SURFACE.AGENT_STOP,
        cause: answer,
        about: { agentId },
      });

      return false;
    }

    // An agent still at work once its Stop answered is one the Stop found nothing to stop in yet.
    if (agentStillWriting(answer.agent.status)) {
      toast({
        replayUnmasked: true,
        words: STOP_NOTHING_YET,
        tone: STATUS_TONE.ATTENTION,
      });

      return false;
    }

    return true;
  };

  // A refused Try again leaves the end line offering it, so it says so in a toast.
  const onRetry = async (agentId: string, words: string): Promise<boolean> => {
    const answer = await sendMessage({
      agentId,
      text: words,
      clientKey: crypto.randomUUID(),
      retry: true,
    }).catch(agentUnreached);

    const took = !("failure" in answer);

    if (!took) {
      failed(RETRY_FAILED, {
        surface: FAILURE_SURFACE.AGENT_SEND,
        cause: answer,
        about: { agentId },
      });
    }

    return took;
  };

  const onRewind = useCallback(
    (agentId: string, messageId: string, restoreFiles = false): Promise<AgentActAnswer> =>
      sendRewind({
        agentId,
        messageId,
        ...(restoreFiles ? { restoreFiles: true } : undefined),
      }).catch(agentUnreached),
    [sendRewind],
  );

  const onClear = async (agentId: string): Promise<boolean> => {
    const answer = await sendClear({ agentId }).catch(agentUnreached);

    if (!("failure" in answer)) return true;
    failed(CLEAR_FAILED, {
      surface: FAILURE_SURFACE.AGENT_CLEAR,
      cause: answer,
      about: { agentId },
    });

    return false;
  };

  const onMessage = useCallback<MessageSender>(
    async (agentId, text, clientKey, attachments) => {
      // Note that a message that opens the agent's sandbox anew while its image is prepared is
      // taken at once, its relaunch waiting on the image in the service, so it is asked once.
      const answer: AgentActAnswer = await sendMessage({
        agentId,
        text,
        clientKey,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).catch(agentUnreached);

      return answer;
    },
    [sendMessage],
  );

  // A change of model is drawn by the host the moment it is asked, and taken back should the service refuse it.
  const onChoose = useCallback<ChoiceWriter>(
    (agentId, choice) => sendChoice({ agentId, ...choiceRequest(choice) }).catch(agentUnreached),
    [sendChoice],
  );

  // A change of mode is drawn by the host the moment it is asked, and taken back should the service refuse it.
  const onPermissionMode = useCallback<PermissionModeWriter>(
    (agentId, permissionMode) =>
      sendPermissionMode({ agentId, permissionMode }).catch(agentUnreached),
    [sendPermissionMode],
  );

  const onAnswerApproval = useCallback<ApprovalAnswerWriter>(
    (agentId, approvalId, request) =>
      sendApprovalAnswer({ agentId, approvalId, ...request }).catch(agentUnreached),
    [sendApprovalAnswer],
  );

  // Note that the host sends each agent's switches one after another, in the
  // order asked, because a switch writes the whole list and two writes in
  // flight may land in either order. Only the newest switch's refusal is
  // said, in a toast, as the switches fall back.
  const switches = useRef(new Map<string, number>());

  const onSwitchServers = useCallback<ServersWriter>(
    async (agentId, disabledServers) => {
      const change = (switches.current.get(agentId) ?? 0) + 1;
      switches.current.set(agentId, change);

      const answer: AgentActAnswer = await sendServers({
        agentId,
        disabledServers,
      }).catch(agentUnreached);

      if ("failure" in answer && switches.current.get(agentId) === change) {
        failed(SERVERS_FAILED, {
          surface: FAILURE_SURFACE.AGENT_SERVERS,
          cause: answer,
          about: { agentId },
        });
      }

      return answer;
    },
    [sendServers, failed],
  );

  // A rename's field closes as the edit ends, and the host draws the new name at once, so a second
  // rename may be out before the first answers; only the newest one's refusal is said, in a toast,
  // as the name it replaced comes back, which the call's own `onSettled` keeps to.
  const rename = {
    ...AGENT_RENAME_TERMS,
    options: agentRenameMutation((asked) => sendAct(ACT_KIND.AGENTS_RENAME, asked)),
    onRefused: (
      answer: AgentActAnswer | undefined,
      error: Error | null,
      { subjectId }: { readonly subjectId: string },
    ) =>
      failed(RENAME_FAILED, {
        surface: FAILURE_SURFACE.AGENT_RENAME,
        cause: answer ?? error,
        about: { agentId: subjectId },
      }),
  };

  // The agents the list draws as they stand at each call, and the archive's
  // mutation, which ⌘Z reads an archive's row and sends its writes through.
  const listedNow = useRef(input.listedAgents ?? NO_LISTED_AGENTS);
  listedNow.current = input.listedAgents ?? NO_LISTED_AGENTS;

  const agentDoors: RowDoors<readonly AgentSummary[], typeof ROW_WRITE.AGENT_ARCHIVE.kind> = {
    rows: () => listedNow.current,
    send: sendArchive,
  };

  // The host draws the agents moved at once, and back where the service
  // refuses. An archive kept is ⌘Z's to take back, and its toast's Undo
  // runs the same entry, unless a question was asked first, since ⌘Z must
  // not put back what took one: its toast then keeps an Undo of its own,
  // read through a ref because the press lands renders after the toast was
  // raised, as it does where the list shows no row of some agent to put
  // back. However many agents it takes, one toast says every one kept,
  // and its one Undo puts them all back.
  const archiveRows = async (
    agentIds: readonly string[],
    archived: boolean,
    asked: true | undefined,
  ): Promise<readonly ActedResult[]> => {
    const drawn = agentIds.every(
      (agentId) => ROW_WRITE.AGENT_ARCHIVE.read(listedNow.current, agentId) !== undefined,
    );

    const pressed = pressRows(
      ROW_WRITE.AGENT_ARCHIVE,
      agentDoors,
      agentIds.map((id) => ({ id, after: { archived } })),
    );

    const words = archiveWords(archived);

    const answers = await Promise.all(
      agentIds.map(
        (agentId): Promise<AgentActAnswer> =>
          sendAct(ROW_WRITE.AGENT_ARCHIVE.kind, { agentId, archived }).catch(agentUnreached),
      ),
    );

    const results = answers.map((answer): ActedResult => {
      if (!("failure" in answer)) return { status: ACTION_RESULT_STATUS.ACCEPTED };
      const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;

      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : words.refused,
        cause: answer,
      };
    });

    const kept = agentIds.filter((_, at) => results[at]?.status === ACTION_RESULT_STATUS.ACCEPTED);

    if (kept.length === 0) return results;
    const done = archivedManyWords(kept.length, archived);

    const unarchive = () =>
      void archiveManyNow
        .current({ agentIds: kept, archived: !archived })
        .then((undone) => sayRefusals(undone, kept));

    const said =
      asked || !drawn
        ? toastOnlyUndo(TOAST_ONLY_UNDO.AGENT_ARCHIVE, done, unarchive)
        : pressed.keep(done, (id) => kept.includes(id));

    if (said !== undefined) toast(said);

    return results;
  };

  const archiveAgent = agentArchiveMutation(({ agentId, archived, asked }) =>
    archiveRows([agentId], archived, asked).then(
      ([result]) =>
        result ?? { status: ACTION_RESULT_STATUS.REJECTED, reason: archiveWords(archived).refused },
    ),
  );

  const archiveAgents = agentsArchiveMutation(({ agentIds, archived, asked }) =>
    archiveRows(agentIds, archived, asked),
  );

  const { mutateAsync: archive } = useMutation(archiveAgent);

  const onArchive = (
    agentId: string,
    archived: boolean,
    how: ArchivePress = {},
  ): Promise<ActedResult> => archive({ agentId, archived, ...how });

  const { mutateAsync: archiveMany } = useMutation(archiveAgents);
  const archiveManyNow = useRef(archiveMany);
  archiveManyNow.current = archiveMany;

  const deleteAgent = agentDeleteMutation((agentId) =>
    sendAct(ACT_KIND.AGENTS_DELETE, { agentId }).catch(agentUnreached),
  );

  // Note that an Undo refused is said once, by the first agent it could not put back.
  const sayRefusals = (results: readonly ActionResult[], agentIds: readonly string[]) => {
    const at = results.findIndex((result) => result.status !== ACTION_RESULT_STATUS.ACCEPTED);
    const result = results[at];
    const agentId = agentIds[at];

    if (result === undefined || result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    failed(result.reason, {
      surface: FAILURE_SURFACE.AGENT_ARCHIVE,
      cause: result,
      about: agentId === undefined ? undefined : { agentId },
    });
  };

  const readAgent = useCallback(
    (named: string) => readAgentById(queryClient, named),
    [queryClient],
  );

  const readTranscript = useCallback<TranscriptReader>(
    (params) => queryClient.fetchQuery(agentMessagesQueryOptions(params)),
    [queryClient],
  );

  // Note that every agent's pull request, an archived one's among them, is the task list's, so
  // choosing a task reads none of them.
  const pullRequests = useListedPullRequests(input.listedPullRequests, taskId);

  // A pull request a tab names by its number is kept by agent and number,
  // apart from the agents' own, so it never stands for what an agent published.
  const numberedPullRequests =
    useQuery({ ...appStateQuery, select: selectNumberedPullRequests }).data ??
    NO_NUMBERED_PULL_REQUESTS;

  const generateChapters = useCallback<AgentsControl["generateChapters"]>(
    (agentId, number) =>
      sendChapters(pullRequestAsked(agentId, number)).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [sendChapters],
  );

  const answerInbox = useCallback<InboxAnswerer>(
    (params) => sendInboxAnswer(params),
    [sendInboxAnswer],
  );

  const messageInbox = useCallback<InboxMessenger>(
    (params) => sendInboxMessage(params),
    [sendInboxMessage],
  );

  const startInboxThread = useCallback<InboxThreadStarter>(
    (params) => sendInboxStart(params),
    [sendInboxStart],
  );

  // Note that the skills are kept for the plan and its repository as they
  // stand, and the host keeps each one's for the session (`compose-tasks.ts`),
  // so choosing the plan again reads none; another plan, or the plan moved to
  // another repository, is another one.
  // Note that a plan with no repository still reads its member's installed skills, and
  // that the plan's repository stays a dependency, so a plan moved to another repository reads afresh.
  // While the Skills experiment is off, no box offers a skill and no sent message draws one.
  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;

  const readSkills = useMemo(() => {
    if (!skillsOn || taskId === undefined) return undefined;

    return keptSkills(() =>
      queryClient.fetchQuery(repositorySkillsQueryOptions({ planId: taskId })),
    );
  }, [queryClient, skillsOn, taskId, repository]);

  // A start reads the agents as they stand when it is pressed, so the doors to it stand across draws.
  const steadyStartPrompt = useSteadyDoor(startPrompt);
  const steadyStartFork = useSteadyDoor(startFork);
  const steadyStartSuggestion = useSteadyDoor(startSuggestion);
  const steadyContinueAgent = useSteadyDoor(continueAgent);

  const readInboxImage = useCallback<InboxImageReader>(
    (params) => askAct(ACT_KIND.AGENTS_INBOX_ATTACHMENT, params),
    [],
  );

  // Handed back steady, so a part drawn from the agents holds while they do (`memo`).
  return useSteadyDoors({
    agents,
    archived: archivedAgents,
    listed: listedAgents,
    agentIds,
    heldIds: standing?.map((agent) => agent.id),
    draft,
    onNewDraft,
    onForkDraft,
    onContinueDraft,
    onSuggestDraft,
    onDropFork,
    onDraftChange,
    onHandDraft,
    onTaskStarted,
    onDraftAttachments,
    onDiscardDraft,
    startPrompt: steadyStartPrompt,
    startFork: steadyStartFork,
    startSuggestion: steadyStartSuggestion,
    onRetryList,
    models: offered.data?.models,
    modelsFailed: offered.isError || modelsRead.state === MODELS_READ.FAILED,
    modelsRead,
    macs: offered.data === undefined ? undefined : (offered.data.macs ?? []),
    readModels,
    onUnarchive: undefined,
    continueAgent: taskId === undefined ? undefined : steadyContinueAgent,
    start: {
      available: taskId !== undefined,
      busy: starting,
      onPress: pressStart,
      pending: pressedHere,
    },
    onStop,
    onRewind,
    onClear,
    onMessage,
    onRetry,
    onChoose,
    onSwitchServers,
    onPermissionMode,
    onAnswerApproval,
    onOpenIntegrations: () => latest.current.onOpenIntegrations(),
    me: input.me,
    onOpenApiKeys: (provider) => latest.current.onOpenApiKeys(provider),
    archiving,
    archiveAgent,
    archiveAgents,
    rename,
    onArchive,
    deleteAgent,
    readAgent,
    readTranscript,
    pullRequests,
    numberedPullRequests,
    generateChapters,
    keywords: input.keywords ?? NO_KEYWORDS,
    readSkills,
    answerInbox,
    messageInbox,
    startInboxThread,
    readInboxImage,
  });
}
