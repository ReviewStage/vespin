import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { agentBootsOf } from "@repo/database/models/agent-boot-store";
import {
  type Agent,
  type AgentLatestTurn,
  continuationsOf,
  type LineSent,
  latestTurnsOfReached,
  lineSendersOf,
  type NativeRoute,
  nativeRouteOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentByKey,
  taskNamesOf,
} from "@repo/database/models/agent-store";
import { currentAutomationRun } from "@repo/database/models/automation-store";
import {
  type Device,
  devicesSeenSince,
  type WorkspaceOwnedMachine,
  workspaceOwnedMachinesOf,
} from "@repo/database/models/device-store";
import {
  listMessagesBefore,
  listMessagesFrom,
  messageSeqOf,
  newestJournalsOfReached,
  type StoredMessageRecord,
  turnStoppedUnderReached,
} from "@repo/database/models/message-reads";
import { lockTasksForBlocks } from "@repo/database/models/task-block-store";
import { readPageById } from "@repo/database/models/task-pages";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import {
  listTasks,
  readTask,
  readTaskHeader,
  readTaskWorkspace,
  type StoredTask,
  setTaskParent,
  type TaskChanges,
} from "@repo/database/models/task-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import { isWorkspaceMember, readAccountNames } from "@repo/database/models/workspace-store";
import type { ConversationTarget, StoreWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
  agentPermissionModeSchema,
} from "@repo/features/agent-approval-wire";
import type { AgentQueue } from "@repo/features/agent-queue-wire";
import { START_NOTE_HEADING } from "@repo/features/agent-replay";
import {
  harnessNameOf,
  runtimeChoiceRefusal,
  runtimeChoiceRefusalWords,
  runtimeModels,
  runtimeOfProvider,
} from "@repo/features/agent-runtime-models";
import { modesOf, runtimeTakesMode } from "@repo/features/agent-runtime-modes";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_ARCHIVER,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentFailure,
  type AgentPullRequestAnswer,
  type AgentRunsOnRequest,
  type AgentStartFrom,
  type AgentStatus,
  agentRunsOnRequestSchema,
  CONTEXT_WINDOW,
  contextWindowSchema,
  disabledServersSchema,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  MAC_PRESENCE,
  personalRunsOnSchema,
  type RefusedDevice,
  startBranchSchema,
} from "@repo/features/agent-wire";
import { deviceAgentRegisterRequestSchema } from "@repo/features/device-agent-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/github-repositories-wire";
import { cleanMachineName } from "@repo/features/machine-name";
import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { contextWindowsOf, windowOf } from "@repo/features/model-effort";
import { agentName, modelLabel, providerOf } from "@repo/features/model-label";
import {
  type ContextWindows,
  type ModelChoice,
  modelChoiceSchema,
} from "@repo/features/models-wire";
import { READ_PAGE_VERSION } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import {
  TASK_BOUNDS,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import type { Sandbox } from "@repo/sandbox";
import { EXPERIMENT } from "@repo/settings";
import { describeWire } from "@repo/wire/effect";
import { isTextUIPart } from "ai";
import { Clock, Data, Effect, Option, Predicate, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  isRecord,
  isStoredToolPart,
  MESSAGE_ROLE,
  type StoredUIMessage,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { ownAgentWorkspace } from "../github/workspace-repository.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import {
  ModelCatalog,
  ModelChoiceRefused,
  type OfferedModel,
  validateModelChoice,
} from "../providers/model-catalog.js";
import { taskChangeAsked, taskChangeSettled, taskChangeWritten } from "../tasks/task-change.js";
import { followerReadingsOf } from "../tasks/task-following.js";
import { archivedAgent, changedAgent } from "./agent-change.js";
import { agentStarterName, startsFromAgent } from "./agent-reach.js";
import { queueOnPage } from "./coder-host/agent-queue.js";
import {
  forwardedImageRefusalWords,
  forwardedImages,
  type ImageForwarder,
} from "./coder-host/forwarded-images.js";
import { agentPublishedUnwritten } from "./coder-host/published.js";
import { callEntry, cutText, lineWords, senderName } from "./coder-host/replay.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import {
  accountModelChoices,
  accountModelPayers,
  placeOfAgent,
  type StartWhere,
  startAgent,
} from "./coder-host/start.js";
import { agentFailureOf, agentStatusOf, startedBlank } from "./coder-host/status.js";
import { stoppedAgent, standingsOf as turnStandingsOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { deploymentSandboxDeletes } from "./session-sandboxes.js";
import type { AgentSessions } from "./sessions/agent-sessions.js";
import {
  assigneeIdOf,
  assigneeMentionOf,
  TASK_ASSIGNEE_INPUT,
  taskAssigneeWrittenSchema,
} from "./task-assignee.js";
import {
  BLOCKED_BY_INPUT,
  BLOCKS_INPUT,
  blockChangesNamed,
  blockWritesAsked,
  taskBlockReadingsNow,
  tasksOfWrites,
  writeTaskBlocks,
} from "./task-block-changes.js";
import { TASK_REF_INPUT, TASK_REF_WORDS, taskIdOfInput } from "./task-ref.js";
import {
  AGENT_LIST_INPUT,
  type AgentTask,
  type AgentTaskReading,
  agentTaskOf,
  listedFilter,
  taskReading,
  WORKSPACE_AGENTS_LIST_LIMIT,
  workspaceAgent,
  workspaceAgentsOf,
} from "./workspace-agents.js";
import {
  EVERY_EXPERIMENT_ON,
  type ExperimentsOn,
  experimentOnIn,
} from "./workspace-experiment-on.js";
import { workspaceNamingOf } from "./written-mentions.js";

/**
 * agent-tools.ts -- the tools every agent reaches the workspace's coding agents by: list them, read one's progress, start one.
 *
 * Every coding agent is offered the same `list_agents`,
 * `read_agent`, and `start_agent`, one implementation each;
 * the caller is what differs (`AgentCaller`):
 * a coding agent acting for its starter, on its own task, which the host
 * read from the session it admitted and never from the call; or a member,
 * as an outside agent acts for them through the member MCP server
 * (`../member-mcp/`), on the token it admitted, in the one workspace a call
 * is about, on no task and as no agent, so nothing is left out of a list
 * or read around it, and nothing is ever its own. A list and a read
 * reach any agent of the caller's workspace, on any task or none
 * and by any member, read on the caller's standing on every call
 * (`workspace-agents.ts`); an agent of another workspace is none of them,
 * even one the member is also in. A list names each agent's task, narrows
 * to one task or the caller's own where asked, and marks the archived
 * agents; a coding agent's own list leaves itself out. Each tool reads the
 * same rows the agent tabs read: the agents and the newest turn each stands
 * on (`coder-host/status.ts`), the branch each row holds, and the
 * transcript's messages: a list says what each agent last did, and a read
 * of one agent answers a page of its whole transcript, the lines sent to it
 * under who sent them and what it said and which tools it called on what,
 * a call's output left out, read back from its end or on from its start or
 * from any place a page answered, each entry cut to a bound and the page to
 * a budget of characters, so one read cannot flood the model and a reader
 * pages on to find what was said. A read of one agent also asks GitHub what
 * that branch published, as the agent's tab does
 * (`coder-host/published.ts`), and says nothing of it where GitHub could
 * not be asked. One agent messages another with `message_agent`
 * (`coder-host/agent-message.ts`). A start takes the one path every other start does
 * (`coder-host/start.ts`), on the caller's own task or another of its workspace, under the
 * same key, so a call run again starts no second agent: the description as the
 * agent's brief, or the prompt in its place, and the note the call carries
 * after either, on the model, effort, and permission mode named, the model
 * and effort checked against the catalog as the member is offered it, whose choices the
 * refusal lists and `list_models` answers from the same read, so a choice it
 * lists is one a start takes, with its checkout cloned at the branch named
 * where one is, which GitHub must hold. An agent a
 * coding agent starts is told in that note which agent started it, that its
 * final message reaches that agent by itself once its turn ends
 * (`coder-host/starter-report.ts`), and how to reach it before then, with
 * `message_agent`, and its choice leaves the member's default as it stood.
 * A start may name a new task instead, which is made as the member the
 * caller acts for would make it from the sidebar: in the caller's workspace,
 * owned by that member, with an empty description, on the repository the caller
 * works in (the calling agent's own), confirmed through the
 * workspace's installation first; a start that then fails takes the task it
 * made away again, and a call run again answers the agent and task it made.
 * A start may instead go on from another agent of the workspace, on that
 * agent's own task, as the Start route's continue and fork do: without a
 * message it continues an agent that has ended, which its start then stops,
 * one another agent already continued among them, whose earlier
 * continuations its answer names, and with one of its messages
 * it forks it there, which leaves it going on; either is handed the
 * source's brief, its replay with our summary of what does not fit, a
 * copy of its work, and the note, and takes no prompt and no branch. A read
 * names the message each entry of a page stands in, which a fork names.
 * An archive and every other change of an agent take the one operation the
 * Archive agent menu and the agent's menu run (`agent-change.ts`) for the
 * member the caller acts for: any agent of the workspace that member could
 * archive, a teammate's among them, a turn still running stopped first, with
 * the stamp the menu writes, and beside it who archived it, the caller on
 * that member's behalf, and the reason given, which the archived agent's
 * banner shows; an agent never archives itself. An archive or an unarchive
 * already standing answers as done.
 * A task's change takes the one path the member's own task menu does
 * (`tasks-procedures.ts`'s PATCH, `task-store.ts`'s `updateTask`), for the member
 * the caller acts for: a new name, a repository confirmed through the
 * workspace's installation or none, where it stands, or that member's own
 * pin, on any task of the caller's workspace, a teammate's among them. A
 * task is archived no longer, so a call naming `archived` is refused with
 * where status and `archive_agent` go; a change already standing answers
 * as done.
 * A stop takes the one path the Stop button's does (`coder-host/stop.ts`'s `stoppedAgent`):
 * the harness's cancel of the turn under way, named by its own id for it, then the
 * row's stamp, which `list_agents` then reads as canceled. The agent stays
 * as it was, its transcript and branch kept, and a later message starts a
 * new turn. A Stop already standing on a turn still ending answers as done,
 * so a call run again cancels nothing twice; an agent already idle is
 * answered as it stands and nothing changes; the caller itself is never
 * stopped.
 * A page read finds a page an agent showed on any task of the caller's
 * workspace by the page's id, as the caller's member could open it in the
 * side panel, and answers its HTML cut on a line to a bound, which a
 * mention of the page now points the agent at rather than carrying it.
 * Each tool reaches an agent's session as the deployment acting for the
 * caller's member, and the agent's harness answers it
 * (`coder-host/runtime-sessions.ts`). Every answer is data the model reads,
 * never a credential.
 */

/** The most tasks a list of them answers, the newest started first. */
export const TASKS_LIST_LIMIT = 50;

export const AGENT_TOOL_BOUNDS = {
  /** The most entries a page of a transcript may ask for. */
  MAX_PAGE_ENTRIES: 200,
  /** The most characters a page of a transcript carries, its entries' words together: about four thousand tokens. */
  PAGE_CHARS: 16_000,
  /** The most characters one entry of a page carries, so one long message leaves room for others. */
  AGENT_ENTRY_CHARS: 4_000,
  /** The messages a page reads from the store at a time, until the page is full or the transcript ends. */
  PAGE_ROWS: 20,
  /** The most characters an agent's latest activity carries in the list. */
  ACTIVITY_CHARS: 160,
  /** The most characters a queued message's words carry in `read_agent`'s queue. */
  QUEUED_CHARS: 160,
} as const;

/** Why a call ran nothing, or sent nothing, in words the model can act on. */
export const AGENT_TOOL_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  UNREADABLE_PAGE:
    `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered, and at most one ` +
    "place, before or after, as a page answered it.",
  UNREADABLE_TRANSCRIPT:
    "Not run: a message of that agent's transcript on this page could not be read, so the " +
    "page would leave it out.",
  UNREADABLE_TASKS:
    "Not run: narrow the tasks by words of their name, by a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), and by an assignee as a member's mention link ` +
    "or null, and page them by an offset of 0 or more.",
  NO_AGENT: `Not run: no agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  NO_WORKSPACE:
    "Not run: your workspace could not be read for you, so no agent is reached from here.",
  STORE: "Not run: the agents could not be read just now. The call may be made again.",
} as const;

/** How the task tools word a priority. */
export const TASK_PRIORITY_WORDS =
  "How much the task matters; none for a task no one has weighed yet.";

/** Why a task's change changed nothing, in words the model can act on. */
export const UPDATE_TASK_REFUSAL = {
  UNREADABLE:
    `Not run: name the task by the id ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered ` +
    `or by its key, and at least one change: a name of at most ${TASK_BOUNDS.MAX_NAME_CHARS} characters, a ` +
    "repository as owner/name or null, pinned, a sectionId or null, a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), a priority ` +
    `(${Object.values(TASK_PRIORITY).join(", ")}), an assignee as a member's mention link or ` +
    "null, a parentTaskId or null, or tasks to add to or take away from its blockedBy or blocks.",
  NO_TASK:
    "Not run: no task of your workspace has that id, so it is none you can change; " +
    `${AGENT_TOOL.LIST_TASKS} names them.`,
  NOT_MEMBER:
    "Not run: that assignee is no member of the task's workspace, or names no person; name a " +
    `member by the mention link ${AGENT_TOOL.LIST_TASKS} hands you, or null for no one.`,
  NOT_REACHABLE:
    "Not run: the GitHub installation connected to the workspace does not reach that " +
    "repository; name one it reaches, or null for none.",
  GITHUB_UNANSWERED:
    "Not run: GitHub did not answer whether the workspace reaches that repository. The call " +
    "may be made again.",
  TREE_REPOSITORY:
    "Not run: a task with a parent or with children works in its tree's repository, so it " +
    "cannot be given another; leave the repository as it is.",
  NO_SECTION:
    "Not run: the developer you work for keeps no section of this workspace under that id; " +
    `${AGENT_TOOL.LIST_TASKS} names the sections.`,
  NO_PARENT:
    "Not run: no task of your workspace has that id to be its parent; " +
    `${AGENT_TOOL.LIST_TASKS} names them, or null takes it out from under its parent.`,
  PARENT_REPOSITORY:
    "Not run: a child task always works in its parent's repository, so a task cannot be put " +
    "under a parent working in another; leave the parent as it is.",
  PARENT_CYCLE:
    "Not run: that parent is the task itself or one of its sub-tasks, under which the task " +
    "would descend from itself; take that task out from under this one first.",
  ARCHIVED:
    `Not run: ${AGENT_TOOL.UPDATE_TASK} takes no archived; a task is never archived. Move it with status ` +
    `(${Object.values(TASK_STATUS).join(", ")}), and archive or bring back its agents with ` +
    `${AGENT_TOOL.ARCHIVE_AGENT} or ${AGENT_TOOL.UNARCHIVE_AGENT}, each by its agentId.`,
} as const;

/** The fields `update_task` names a task in by its id or key, and the opening its refusals share. */
const UPDATE_TASK_ID = { opening: "Not run", field: "taskId" } as const;
const UPDATE_TASK_PARENT = { opening: "Not run", field: "parentTaskId" } as const;

/** Why a stop changed nothing, in words the model can act on. */
export const STOP_AGENT_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  SELF: "Not stopped: that id is your own, and an agent does not stop itself; end your turn by finishing it.",
  UNAVAILABLE:
    "Not stopped: the service could not reach that agent's session just now. The call may be made again.",
  NATIVE_NOT_HERE:
    "Not stopped: that agent runs on Claude Code or Codex, which cannot be reached from here yet; a member stops it from the agent's own tab.",
} as const;

/** The most characters of a page's HTML a read answers, about ten thousand tokens: the rest is counted, never sent. */
export const READ_PAGE_CHARS = 40_000;

/** Why a page read answered nothing, in words the model can act on. */
export const READ_PAGE_REFUSAL = {
  UNREADABLE: `Not read: name the page by its id in pageId, and the version to read in version: a whole number from 1, or "${READ_PAGE_VERSION.NEWEST}" for the newest.`,
  NO_PAGE:
    "Not read: no page of a task of your workspace has that id, or that page has no such version.",
} as const;

/** The cloud as `start_agent`'s runsOn names it, which a device's refusal offers instead. */
const IN_THE_CLOUD_WORDS = JSON.stringify({ machine: AGENT_MACHINE.VERCEL });

/** How a start from another agent takes it over: continue it, which stops it, or fork it at one of its messages, which leaves it going on. */
const START_FROM_MODE = {
  CONTINUE: "continue",
  FORK: "fork",
} as const;

/** What a start naming neither taskId nor branch is told of the branch, beside the task, so one retry names both. */
const START_BRANCH_MISSING_WORDS =
  "And name the branch of its repository to clone the agent's checkout at as branch, such as " +
  "the repository's default branch, which `gh api repos/<owner>/<name> --jq .default_branch` " +
  "answers; every start on a task with a repository names it but one with from.";

/** Why a start made nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
export const START_AGENT_REFUSAL = {
  UNREADABLE:
    "Not started: give a prompt as text of at most " +
    `${AGENT_BOUNDS.MAX_START_WORDS_CHARS} characters, or none to start on the description, a note ` +
    `bounded the same or none, a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} ` +
    "characters or none, a branch as one git branch name, a model with its effort, " +
    `both or neither, a taskId, a permissionMode of ${Object.values(AGENT_PERMISSION_MODE).join(", ")}, runsOn as ` +
    `${IN_THE_CLOUD_WORDS} or a device of the member's by its name or its id, and images as ` +
    `at most ${AGENT_BOUNDS.MAX_ATTACHMENTS} attachment ids or none.`,
  NO_RUNS_ON:
    `Not started: name where the agent runs as runsOn: ${IN_THE_CLOUD_WORDS} for the cloud, or one ` +
    `of the member's own devices as ${AGENT_TOOL.LIST_MACHINES} lists it, with the runsOn to pass. ` +
    "Only a start with from may leave it out, to run where the agent it starts from runs.",
  NO_MODEL:
    "Not started: name the model and effort the agent runs on as model and effort, by the catalog " +
    `id and an effort ${AGENT_TOOL.LIST_MODELS} lists for it. Only a start with from may leave ` +
    "both out, to run on the model of the agent it starts from.",
  NO_PERMISSION_MODE:
    `Not started: name the agent's permissionMode: ${AGENT_PERMISSION_MODE.FULL_ACCESS} to run ` +
    `every tool call unasked, ${AGENT_PERMISSION_MODE.ASK} to ask a member before a file edit ` +
    `or a shell command, or ${AGENT_PERMISSION_MODE.AUTO} to leave each to the harness's own ` +
    "review. Every start names it, one with from included.",
  FROM_UNREADABLE:
    "Not started: give from as " +
    `${JSON.stringify({ agentId: "<id>", mode: START_FROM_MODE.CONTINUE })} to continue that agent, ` +
    "which stops it, or as " +
    `${JSON.stringify({ agentId: "<id>", mode: START_FROM_MODE.FORK, messageId: "<id>" })} to fork ` +
    `it at one of its messages, which ${AGENT_TOOL.READ_AGENT} names, while it goes on.`,
  NO_TASK:
    "Not started: name the task to start the agent on as taskId: your own is the taskId in your " +
    `instructions' own values, another the id ${AGENT_TOOL.LIST_TASKS} answered, and with from the ` +
    "task of the agent it starts from.",
  NO_TASK_NOR_BRANCH:
    "Not started: name the task to start the agent on as taskId: your own is the taskId in your " +
    `instructions' own values, another the id ${AGENT_TOOL.LIST_TASKS} answered, and with from the ` +
    `task of the agent it starts from. ${START_BRANCH_MISSING_WORDS}`,
  PROMPT_NEEDED:
    "Not started: give the agent a prompt carrying everything it needs to start on its work; " +
    "every start takes one but a start from another agent.",
  BRANCH_NO_REPOSITORY:
    "Not started: the task works in no repository, so there is no branch to clone; leave branch " +
    `out, or give the task a repository with ${AGENT_TOOL.UPDATE_TASK} first.`,
  NO_OWN_TASK:
    "Not started: you work on no task, so name the task to start the agent on by its taskId; " +
    `${AGENT_TOOL.CREATE_TASK} makes one, and ${AGENT_TOOL.LIST_TASKS} names those that stand.`,
  NO_OWN_TASK_NOR_BRANCH:
    "Not started: you work on no task, so name the task to start the agent on by its taskId; " +
    `${AGENT_TOOL.CREATE_TASK} makes one, and ${AGENT_TOOL.LIST_TASKS} names those that stand. ` +
    START_BRANCH_MISSING_WORDS,
  CALLER_PLACE_GONE:
    "Not started: the device or machine you run on is gone, so there is no place of yours to " +
    `run it; name runsOn: ${IN_THE_CLOUD_WORDS} for the cloud, or a device or machine as ` +
    `${AGENT_TOOL.LIST_MACHINES} lists it, with the runsOn to pass.`,
  NEW_TASK:
    `Not started: start_agent takes no newTask; make the task with ${AGENT_TOOL.CREATE_TASK}, then ` +
    "start the agent on it by its taskId.",
  TASK_KEY: "Not started: start_agent takes no task; pass what the agent should do as prompt.",
  NO_SUCH_TASK: `Not started: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  NO_BRANCH:
    "Not started: the task's repository has no such branch on GitHub. Push it first, or name a " +
    "branch that exists there, such as the repository's default branch or the head branch of " +
    "the pull request to build on.",
  GITHUB_UNANSWERED:
    "Not started: GitHub did not answer whether the branch exists. The call may be made again.",
  NOT_REACHABLE:
    "Not started: the GitHub installation connected to the workspace does not reach the repository the agent would work in.",
  UNAVAILABLE:
    "Not started: the service could not start an agent just now. The call may be made again.",
  PLAN_SIGNED_OUT:
    "Not started: the plan that would pay for it is signed out; its starter signs in again in Settings.",
  PLAN_UNREACHABLE:
    "Not started: the plan's provider did not answer; start it again in a minute or two.",
  PLAN_LIMIT_REACHED:
    "Not started: the plan that would pay for it has reached its usage limit; start it after the limit resets, or its starter chooses the API key in Settings.",
  PLAN_INELIGIBLE:
    "Not started: the plan's provider said the account is not eligible to run it; its starter chooses the API key in Settings.",
  CREDENTIAL_MISSING: `Not started: no subscription or API key of its starter's pays for that model, and ${PRODUCT_NAME}'s key pays for no agent; its starter connects one in Settings › Agents, or start it on a model whose provider is connected.`,
  API_KEY_UNREADABLE:
    "Not started: the API key that would pay for it is saved but cannot be read here; its starter saves it again in Settings › Agents.",
  BILLING_REQUIRED: `Not started: the workspace has used its free cloud usage for the month and has no billing set up, or its last payment failed; an owner or admin sets up or manages billing in Settings › Billing, or start it on a member's Mac.`,
  DEVICE_REMOVED: `Not started: the machine it would run on was removed. Start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}, or ask the member to add the machine again.`,
  NO_DEVICES: `Not started: the member has no device registered to run agents on. Start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}, or ask the member to add a machine in Settings › Machines.`,
  NO_WORKSPACE_MACHINES: `Not started: the workspace owns no machine to run agents on. Start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}, or ask a workspace admin to connect one in Settings › Machines.`,
  NO_SOURCE:
    "Not started: no agent of your workspace has that id to start from; " +
    `${AGENT_TOOL.LIST_AGENTS} names them.`,
  SOURCE_OTHER_TASK:
    "Not started: that agent works on another task than the taskId named; name the task it " +
    `works on, as ${AGENT_TOOL.LIST_AGENTS} answers it, as taskId.`,
  FROM_WITH_PROMPT:
    "Not started: an agent started from another is handed that agent's brief, transcript, and " +
    "work on that agent's own task, so it takes no prompt, no branch, and no new task; put what it " +
    "should hear beyond them in the note.",
  NO_MESSAGE:
    "Not started: that messageId is none of that agent's own messages; " +
    `${AGENT_TOOL.READ_AGENT} names each entry's messageId. Pass mode ${START_FROM_MODE.CONTINUE} ` +
    "to continue it instead.",
  SELF_CONTINUE:
    "Not started: an agent does not continue itself, since you are still here to go on; to try " +
    `another direction from one of your own messages, fork yourself with mode ${START_FROM_MODE.FORK} ` +
    "at its messageId.",
  STARTER_CONTINUE:
    "Not started: you can't continue an agent that started you, directly or through the agents " +
    "between you, since your reports would still go to the agent the continue stops; tell its " +
    "starter, or ask a member to continue it.",
  SOURCE_RUNNING:
    "Not started: that agent is still starting or working, and a continue would take over work " +
    "it is still doing. Wait until it ends, message it, or fork it at a messageId to try another " +
    "direction beside it. Where it went quiet and should go on in a new agent, its session dead " +
    `while it still reads running among them, stop it with ${AGENT_TOOL.STOP_AGENT} and call again.`,
} as const;

/** Why a list of the models answered none, in words the model can act on. */
export const LIST_MODELS_REFUSAL = {
  UNAVAILABLE: "Not listed: the models could not be read just now. The call may be made again.",
  UNREADABLE: `Not listed: name an agent, if any, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
} as const;

/** The start refusal's sentence for each hosted refusal a start may answer; any other is the service down. */
const START_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NO_REPOSITORY, START_AGENT_REFUSAL.BRANCH_NO_REPOSITORY],
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND, START_AGENT_REFUSAL.NO_BRANCH],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, START_AGENT_REFUSAL.GITHUB_UNANSWERED],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, START_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT, START_AGENT_REFUSAL.PLAN_SIGNED_OUT],
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE, START_AGENT_REFUSAL.PLAN_UNREACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED, START_AGENT_REFUSAL.PLAN_LIMIT_REACHED],
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE, START_AGENT_REFUSAL.PLAN_INELIGIBLE],
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING, START_AGENT_REFUSAL.CREDENTIAL_MISSING],
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE, START_AGENT_REFUSAL.API_KEY_UNREADABLE],
  [HOSTED_API_ERROR.DEVICE_REMOVED, START_AGENT_REFUSAL.DEVICE_REMOVED],
  [HOSTED_API_ERROR.BILLING_REQUIRED, START_AGENT_REFUSAL.BILLING_REQUIRED],
]);

/** Why a start on a device refused it, in words the calling model can act on: by what the device refused it for, bar another member's device, which names whose it is (`notOwnerWords`). */
const LOCAL_AGENT_REFUSAL_WORDS = {
  [LOCAL_AGENT_REFUSAL.MAC_AWAY]: `Not started: the device it would run on is offline, so it cannot take an agent (its vespin-host is not connected). Try again once it is back, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.CODEX]: `Not started: the device it would run on has no Codex set up yet, so it cannot run this model. Start on a Claude model, or in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.CURSOR]: `Not started: the device it would run on has no Cursor set up: Cursor runs only on a Mac whose host is up to date. Start on another model, or in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.NO_HARNESS]: `Not started: the device it would run on cannot run this model. Start on another model, or in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.PREPARING]: `Not started: the device it would run on is still getting ready for local agents, downloading Claude Code, Codex, and GitHub's CLI. Try again in a few minutes, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.SETUP_FAILED]: `Not started: the device it would run on couldn't set up local agents, since its download of Claude Code, Codex, or GitHub's CLI failed. It tries again by itself, so try again in a few minutes, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN]: `Not started: the device it would run on has a vespin-host too old to work in a repository on its own GitHub sign-in. Ask the member to update that host, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.PERMISSION_MODES]: `Not started: the agent's permission mode asks before it acts, and the device it would run on has a vespin-host too old to ask, which would run it with full access. Ask the member to update ${PRODUCT_NAME} on that machine, or to switch the agent to Full access.`,
} as const satisfies Record<
  Exclude<LocalAgentRefusal, typeof LOCAL_AGENT_REFUSAL.NOT_OWNER>,
  string
>;

/** Why a start on another member's device refused it, naming the device and its owner where the refusal did. */
function notOwnerWords(device: RefusedDevice | undefined): string {
  const where = device === undefined ? "another member's device" : device.name;
  const who = device?.owner ?? "its owner";

  return `Not started: it would run on ${where}. Only ${who} can start agents on it, so ask them to, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

/** A device of the member's as a refusal of a device's name lists it: its name, its id, and whether it is online now, as a start would take it (`freshOffer`). */
function listedDevice(device: Pick<Device, "id" | "name" | "lastSeenAt">, now: number): string {
  const online = device.lastSeenAt.getTime() >= now - MAC_PRESENCE.FRESH_MS;

  return `${JSON.stringify(device.name)} (deviceId ${device.id}, ${online ? "online" : "away"})`;
}

/**
 * The machines of those given that `name` names, any case. Note that both
 * sides are read as a machine's name is kept (`cleanMachineName`), so a
 * name typed with its double space, or one kept before names were cleaned,
 * still matches.
 */
function namedMachines<M extends { readonly name: string }>(
  machines: readonly M[],
  name: string,
): readonly M[] {
  const wanted = cleanMachineName(name).toLowerCase();

  return machines.filter((machine) => cleanMachineName(machine.name).toLowerCase() === wanted);
}

/**
 * Why a start naming a workspace's machine by its name started nothing: the
 * name matches none of the workspace's machines, or more than one, said
 * with every one of them by name, id, and whether it is online, so the call
 * can be made again naming one; or the workspace has none to list.
 */
function workspaceMachineNameRefusal(
  name: string,
  matched: number,
  machines: readonly WorkspaceOwnedMachine[],
  now: number,
): string {
  if (machines.length === 0) return START_AGENT_REFUSAL.NO_WORKSPACE_MACHINES;
  const named = JSON.stringify(name);

  const why =
    matched === 0
      ? `no machine of the workspace's is named ${named}`
      : `${matched} machines of the workspace's are named ${named}, so name the one you mean by its deviceId`;

  const listed = machines.map((machine) => listedDevice(machine, now)).join("; ");

  return `Not started: ${why}. Its machines: ${listed}. Name one by its name or its deviceId, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

/**
 * Why a start naming a device by its name started nothing: the name matches
 * none of the member's devices, or more than one, said with every device of
 * theirs by name, id, and whether it is online, so the call can be made again
 * naming one; or the member has none to list.
 */
function deviceNameRefusal(
  name: string,
  matched: number,
  devices: readonly Device[],
  now: number,
): string {
  if (devices.length === 0) return START_AGENT_REFUSAL.NO_DEVICES;
  const named = JSON.stringify(name);

  const why =
    matched === 0
      ? `no device of the member's is named ${named}`
      : `${matched} devices of the member's are named ${named}, so name the one you mean by its deviceId`;

  const listed = devices.map((device) => listedDevice(device, now)).join("; ");

  return `Not started: ${why}. Their devices: ${listed}. Name one by its name or its deviceId, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

/** Who calls an agent tool: a coding agent from its own session, or a member through the member MCP server. */
export const AGENT_CALLER = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

/**
 * Who a call is made by, as the host established it and never as the call
 * said: a coding agent, acting for the member who started it, on its own
 * task; or a member, as an outside agent acts for them through the member
 * MCP server (`../member-mcp/`) on a token minted to an OAuth client, in the
 * one workspace the call is about, on no task and as no agent. A coding
 * agent carries whether it reaches tasks' descriptions, read once with the
 * rest of its standing by the catalog (`tool-catalog/gates.ts`); a member's
 * own Task descriptions are read where a tool needs them.
 */
export type AgentCaller =
  | {
      readonly kind: typeof AGENT_CALLER.AGENT;
      readonly agent: Agent;
      readonly descriptionsOn: boolean;
    }
  | {
      readonly kind: typeof AGENT_CALLER.MEMBER;
      readonly userId: string;
      readonly workspaceId: string;
      readonly clientId: string;
    };

/** What a call of the agent tools runs under: who calls, the agents' sessions as the deployment acting for the caller's member, the writer, and the key the one message or start is made under. */
export interface AgentCall {
  readonly caller: AgentCaller;
  /** The agents' sessions as the deployment acting for the caller's member. */
  readonly agentSessions: AgentSessions;
  /** The agents' sessions as the deployment acting for any account, such as the creator an automation's run starts as, whoever fired it. */
  readonly agentSessionsAs: (account: string) => AgentSessions;
  readonly writer: Effect.Effect<StoreWriter>;
  /** The key a message or a start is made under: the call's key (`workspace-mcp/call-key.ts`), so a call run again sends or starts once. */
  readonly clientKey: string;
  /** How a start from another agent summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out unsummarized. */
  readonly summaryModel?: SummaryModelOf | undefined;
}

/** What a read of the agent tools runs under: who calls, alone, since a read reaches no session, writes nothing, and keys nothing. */
export type AgentReadCall = Pick<AgentCall, "caller">;

/** What a message or a start reaches: the store, GitHub through the App on the member's standing, the network to the agents' sessions, and the catalog a start's choice is checked against. */
export type AgentToolServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | Sandbox;

const AGENT_ID = describeWire(
  wireUuidSchema,
  `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it or a message from it named it.`,
);

const READ_AGENT_INPUT = Schema.Struct({ agentId: AGENT_ID });

/** A list of models names, at most, the agent whose change it is for, whose runtime narrows it. */
const LIST_MODELS_INPUT = Schema.Struct({
  agentId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `An agent of your workspace, by the id ${AGENT_TOOL.LIST_AGENTS} answered, to list what it ` +
        `may move to with ${AGENT_TOOL.UPDATE_AGENT}; leave it out for what a start takes.`,
    ),
  ),
});

const readListModelsAsked = Schema.decodeUnknownResult(LIST_MODELS_INPUT);

/** Where a page of a transcript is read from where it names no place: its newest page, or its first. */
const TRANSCRIPT_FROM = {
  END: "end",
  START: "start",
} as const;

/** A place in a transcript, between two entries: the sequence of the message an entry stands in, and the entry's index among that message's. */
const TRANSCRIPT_PLACE = Schema.Struct({
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  entry: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type TranscriptPlace = typeof TRANSCRIPT_PLACE.Type;

/** A coding agent's read names the agent and, at most, which page of its transcript it wants and how many entries. */
const CODER_READ_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  from: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(TRANSCRIPT_FROM)),
      `Where to read its transcript from where neither before nor after is given: ` +
        `${TRANSCRIPT_FROM.END}, the default, for its newest page, or ${TRANSCRIPT_FROM.START} ` +
        "for its first, from the message it was started with.",
    ),
  ),
  before: Schema.optionalKey(
    describeWire(
      TRANSCRIPT_PLACE,
      "The older place a page answered, to read the page of entries before it.",
    ),
  ),
  after: Schema.optionalKey(
    describeWire(
      TRANSCRIPT_PLACE,
      "The newer place a page answered, to read the page of entries after it.",
    ),
  ),
  entries: Schema.optionalKey(
    describeWire(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: AGENT_TOOL_BOUNDS.MAX_PAGE_ENTRIES }),
      ),
      "At most how many entries of its transcript the page holds, such as 1 for what it last " +
        `said or did; as many as fit in ${AGENT_TOOL_BOUNDS.PAGE_CHARS} characters when left out.`,
    ),
  ),
});

/** A bound in bytes as a tool's words say it, in megabytes. */
function megabytesOf(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}

/** A prompt or a note a start may name: bounded apart from a message, since a brief to a worker on a long description is quoted whole. */
export const START_PROMPT = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_START_WORDS_CHARS),
);

/** A title a start may name: bounded as a rename's is, and never empty, since an empty one names nothing. */
export const START_TITLE = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS),
);

/** A branch a start may name: one git ref's name as GitHub holds it, with no whitespace, which GitHub then confirms. */
export const START_BRANCH = startBranchSchema;

/**
 * A start names a prompt at most, a note at most, a branch at most, and a
 * model with its effort or neither; the catalog decides whether the two
 * name anything, and GitHub whether the branch does. A
 * title it names is the agent's from the start, as an automation's run's
 * fixed name is, so no generated title ever covers it; without one the
 * agent is named from its first exchange as any is.
 * Note that the note is what lets one start carry everything: without it a
 * start on the description had no room for what was said beyond the description, so the
 * caller started the agent and then messaged it the rest.
 */
/** One of the member's own devices by its name, which a call matches to its id (`runsOnOfStart`). */
const DEVICE_BY_NAME = Schema.Struct({
  machine: Schema.Literal(AGENT_MACHINE.DEVICE),
  device: deviceAgentRegisterRequestSchema.fields.name,
});

/**
 * Where an automation's runs start, as its tools name it: as the automation
 * keeps it (`personalRunsOnSchema`), the cloud or one of its creator's
 * devices by its id, or one of those devices by its name.
 */
export const AUTOMATION_RUNS_ON = Schema.Union([...personalRunsOnSchema.members, DEVICE_BY_NAME]);

/**
 * Where a started agent may run, as a start names it: as a start request
 * does (`agentRunsOnRequestSchema`), or one of the member's own devices, or
 * a machine the workspace owns, by its name, which the call matches to its
 * id (`runsOnOfStart`) before the start is asked.
 */
const START_RUNS_ON = Schema.Union([
  ...agentRunsOnRequestSchema.members,
  DEVICE_BY_NAME,
  Schema.Struct({
    machine: Schema.Literal(AGENT_MACHINE.WORKSPACE),
    name: deviceAgentRegisterRequestSchema.fields.name,
  }),
]);

/**
 * Where `start_agent` offers to run an agent: the cloud or one of the
 * member's own devices, by its id or its name, and no machine the workspace
 * owns, since every launch on one is refused until a machine of ours runs
 * it (`machine/agent-machines.ts`). Note that PR 8 of the workspace-hosts
 * rollout (STAG-3712), which runs them, offers `START_RUNS_ON` here again.
 */
const OFFERED_START_RUNS_ON = Schema.Union([...personalRunsOnSchema.members, DEVICE_BY_NAME]);

const START_FROM_AGENT_ID = describeWire(
  wireUuidSchema,
  `The agent to start from, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
);

/** A start's from: the agent it takes over and how, each mode with only the fields it takes. */
const START_FROM = Schema.Union([
  Schema.Struct({
    agentId: START_FROM_AGENT_ID,
    mode: describeWire(
      Schema.Literal(START_FROM_MODE.CONTINUE),
      "Continue the agent from where it stands: it must have ended, and it is stopped.",
    ),
  }),
  Schema.Struct({
    agentId: START_FROM_AGENT_ID,
    mode: describeWire(
      Schema.Literal(START_FROM_MODE.FORK),
      "Fork the agent at messageId: it goes on beside the new one.",
    ),
    messageId: describeWire(
      wireUuidSchema,
      `One of that agent's messages, by the messageId ${AGENT_TOOL.READ_AGENT} names on ` +
        "an entry of its transcript, to fork it there.",
    ),
  }),
]);

/**
 * `start_agent`'s `prompt` and `note` as a workspace with Task descriptions on
 * or off words them: off, a start is handed no description, so its prompt
 * carries everything the agent needs, and nothing names a description.
 */
const START_WORDS = {
  on: {
    prompt:
      "What the agent should do, typed to it as its first message; the developer's words where " +
      "they named the job. Leave it out to start the agent on the task's description itself.",
    note:
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
      "for, what to leave alone), handed to it after the description or the prompt in the same first " +
      "message; leave it out where there is nothing beyond the description.",
  },
  off: {
    prompt:
      "What the agent should do, typed to it as its first message: everything it needs to start " +
      "on its work, or the developer's words where they named the job. Every start takes one but " +
      "a start from another agent, which takes none.",
    note:
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
      "for, what to leave alone), handed to it after the prompt in the same first message; leave " +
      "it out where there is nothing beyond the prompt.",
  },
} as const;

/** Which of a tool's two wordings a workspace reads: the one naming its description, or the one naming none. */
function wordsOf(on: Pick<ExperimentsOn, "descriptionsOn">): "on" | "off" {
  return on.descriptionsOn ? "on" : "off";
}

/** Where a start runs, as `start_agent`'s runsOn says it, before what leaving it out means. */
const START_RUNS_ON_WORDS =
  `Where the agent runs: ${IN_THE_CLOUD_WORDS} for the cloud, ` +
  `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, device: "<name>" })} for one of the ` +
  "member's own devices (a Mac or a host) by its name, or " +
  `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, deviceId: "<id>" })} by its id; it ` +
  "must be online, and a name matching none of those devices, or several, is refused with " +
  "them listed. " +
  `${AGENT_TOOL.LIST_MACHINES} lists each place with the runsOn to pass. `;

/** How a start's permissionMode answers its tool calls, before what leaving it out means. */
const START_MODE_WORDS =
  `How the agent's tool calls are answered: ${AGENT_PERMISSION_MODE.FULL_ACCESS} runs every ` +
  `one unasked, ${AGENT_PERMISSION_MODE.ASK} asks a member before a file edit or a shell ` +
  `command, and ${AGENT_PERMISSION_MODE.AUTO} leaves each to the harness's own review, ` +
  "which asks where it cannot decide. A Cursor model takes " +
  `${AGENT_PERMISSION_MODE.AUTO} or ${AGENT_PERMISSION_MODE.FULL_ACCESS}, and another mode ` +
  "on it is refused. ";

const START_MODEL_WORDS =
  "The model to run on, by its catalog id (such as anthropic/claude-opus-5.5), as " +
  `${AGENT_TOOL.LIST_MODELS} lists it. `;

/**
 * A start's model, effort, permissionMode, and runsOn, in two forms: as a
 * coding agent names them, where leaving one out means the calling agent's
 * own, which its instructions name; and as a member names them through the
 * member MCP, who is no agent and so names each.
 */
const START_CHOICE_FIELDS = {
  inherited: {
    model: Schema.optionalKey(
      describeWire(
        modelChoiceSchema.fields.model,
        START_MODEL_WORDS +
          "Leave it and effort out to run on your own model and effort, or with from on the " +
          "model of the agent it starts from.",
      ),
    ),
    effort: Schema.optionalKey(
      describeWire(
        modelChoiceSchema.fields.effort,
        "The reasoning effort, as the model lists it (such as high); given with the model or not at all.",
      ),
    ),
    permissionMode: Schema.optionalKey(
      describeWire(
        agentPermissionModeSchema,
        START_MODE_WORDS + "Leave it out to run on your own permission mode, with from too.",
      ),
    ),
    runsOn: Schema.optionalKey(
      describeWire(
        OFFERED_START_RUNS_ON,
        START_RUNS_ON_WORDS +
          "Leave it out to run where you run, the runsOn your instructions' own values name, " +
          "or with from where the agent it starts from runs; naming another place moves it there.",
      ),
    ),
  },
  named: {
    model: Schema.optionalKey(
      describeWire(
        modelChoiceSchema.fields.model,
        START_MODEL_WORDS +
          "Every start names it but one with from, which runs on the model of the agent it " +
          "starts from unless it names another.",
      ),
    ),
    effort: Schema.optionalKey(
      describeWire(
        modelChoiceSchema.fields.effort,
        "The reasoning effort, as the model lists it (such as high); given with the model or not at all.",
      ),
    ),
    permissionMode: describeWire(
      agentPermissionModeSchema,
      START_MODE_WORDS + "Every start names it, one with from included.",
    ),
    runsOn: Schema.optionalKey(
      describeWire(
        OFFERED_START_RUNS_ON,
        START_RUNS_ON_WORDS +
          "Every start names it but one with from, which runs where the agent it starts from " +
          "runs unless it names another place, which moves it there.",
      ),
    ),
  },
} as const;

/** The model, effort, permissionMode, and runsOn of a member's start, who is no agent and names each. */
export const MEMBER_START_CHOICE_FIELDS = START_CHOICE_FIELDS.named;

/** `start_agent`'s input in the words of the workspace's experiments. */
function startAgentInputOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return Schema.Struct({
    taskId: describeWire(
      TASK_REF_INPUT,
      "The task to start the agent on, by its id or its key, such as ACME-42: the taskId in " +
        `your instructions' own values for your own, the id ${AGENT_TOOL.LIST_TASKS} answered or ` +
        "the key for another, and with from the task of the agent it starts from.",
    ),
    prompt: Schema.optionalKey(describeWire(START_PROMPT, START_WORDS[wordsOf(on)].prompt)),
    note: Schema.optionalKey(describeWire(START_PROMPT, START_WORDS[wordsOf(on)].note)),
    images: Schema.optionalKey(
      describeWire(
        Schema.Array(wireUuidSchema).check(Schema.isMaxLength(AGENT_BOUNDS.MAX_ATTACHMENTS)),
        "Pictures handed to the agent with its first message: at most " +
          `${AGENT_BOUNDS.MAX_ATTACHMENTS} attachment ids of pictures in your own ` +
          `conversation, such as one ${AGENT_TOOL.SHOW_MEDIA} kept, each at most ${megabytesOf(AGENT_BOUNDS.MAX_IMAGE_BYTES)} and all of them ` +
          `${megabytesOf(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES)} together; a larger one is refused.`,
      ),
    ),
    title: Schema.optionalKey(
      describeWire(
        START_TITLE,
        "The agent's title from the start, how the developer sees it named, such as the pull " +
          "request it will open; leave it out to have it named from what it is told.",
      ),
    ),
    branch: Schema.optionalKey(
      describeWire(
        START_BRANCH,
        "The branch of the task's repository to clone the agent's checkout at and cut its own " +
          "branch from, such as the repository's default branch or the head branch of a pull " +
          "request it builds on; it must already be on GitHub. Required on a task with a " +
          "repository, except with from; leave it out for a task with no repository or a start " +
          "from another agent.",
      ),
    ),
    ...START_CHOICE_FIELDS.inherited,
    from: Schema.optionalKey(
      describeWire(
        START_FROM,
        "Another agent of your workspace to take over from, on its own task: the new agent is " +
          `handed its brief, its transcript (with ${PRODUCT_NAME}'s summary of the steps that do not fit), ` +
          "and a copy of its work, runs on its model unless you name one, and hears the note after them; " +
          `it takes no prompt and no branch. mode ${START_FROM_MODE.CONTINUE} continues the agent, ` +
          `which is stopped; mode ${START_FROM_MODE.FORK} forks it at messageId, and it goes on.`,
      ),
    ),
  });
}

const START_AGENT_INPUT = startAgentInputOf(EVERY_EXPERIMENT_ON);

const readAgentRef = Schema.decodeUnknownResult(READ_AGENT_INPUT);
const readAgentAsked = Schema.decodeUnknownResult(CODER_READ_AGENT_INPUT);

/**
 * A task's change names the task and at least one of what the member's own
 * menu changes of it: its name, its repository, where it stands, and the
 * member's own pin.
 */
/** `update_task`'s `name` as a workspace with Task descriptions on or off words it. */
const UPDATE_NAME_WORDS = {
  on: "Its new name, as the sidebar shows it, which its description's heading follows.",
  off: "Its new name, as the sidebar shows it.",
} as const;

/** `update_task`'s input in the words of the workspace's experiments. */
function updateTaskInputOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return Schema.Struct({
    taskId: describeWire(
      TASK_REF_INPUT,
      `The task, by its id as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered it, or by its key, such as ACME-42.`,
    ),
    name: Schema.optionalKey(
      describeWire(
        Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
        UPDATE_NAME_WORDS[wordsOf(on)],
      ),
    ),
    repository: Schema.optionalKey(
      describeWire(
        Schema.NullOr(githubRepositoryFullNameSchema),
        "The GitHub repository its agents work in, as owner/name, which the workspace's GitHub " +
          "installation must reach; null for none.",
      ),
    ),
    pinned: Schema.optionalKey(
      describeWire(
        Schema.Boolean,
        "true to pin it in the sidebar of the developer you work for, false to unpin it; their pin " +
          "alone, no other member's.",
      ),
    ),
    status: Schema.optionalKey(describeWire(taskStatusSchema, "Where the task now stands.")),
    priority: Schema.optionalKey(describeWire(taskPrioritySchema, TASK_PRIORITY_WORDS)),
    assignee: Schema.optionalKey(TASK_ASSIGNEE_INPUT),
    sectionId: Schema.optionalKey(
      describeWire(
        Schema.NullOr(wireUuidSchema),
        "The sidebar section the developer you work for keeps it in, by the id " +
          `${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.CREATE_SECTION} answered; it leaves the section ` +
          "it stood in and lands at the top of this one. null takes it out of its section, back " +
          "under Tasks.",
      ),
    ),
    parentTaskId: Schema.optionalKey(
      describeWire(
        Schema.NullOr(TASK_REF_INPUT),
        `The task to make it a child of, by ${TASK_REF_WORDS}: a task of ` +
          "your workspace working in the same repository, and neither this task nor one of its " +
          "sub-tasks; where its agents run stays its own. null takes it out from under its parent, " +
          "to stand at the top.",
      ),
    ),
    blockedBy: Schema.optionalKey(BLOCKED_BY_INPUT),
    blocks: Schema.optionalKey(BLOCKS_INPUT),
  });
}

const UPDATE_TASK_INPUT = updateTaskInputOf(EVERY_EXPERIMENT_ON);

/**
 * A task's change as a call carries it: `archived`, which a session still
 * offered the tool's earlier words may send, is read so the call is refused
 * by name rather than run with it dropped.
 */
const UPDATE_TASK_CALL = Schema.Struct({
  ...UPDATE_TASK_INPUT.fields,
  archived: Schema.optionalKey(Schema.Unknown),
});

const readTaskUpdate = Schema.decodeUnknownResult(UPDATE_TASK_CALL);

/**
 * A start as a call carries it: the coding agent's input, its taskId read
 * even where it is missing, so a session still offered the tool's earlier
 * words, which let it out, is refused with what to name.
 */
const START_AGENT_CALL = Schema.Struct({
  ...START_AGENT_INPUT.fields,
  taskId: Schema.optionalKey(START_AGENT_INPUT.fields.taskId),
});

/** The keys earlier words of the tool taught, each refused with the one it meant: the prompt once named `task`, and the `newTask` a start named before `create_task` made tasks. */
const RETIRED_START_KEYS = [
  { key: "task", refusal: START_AGENT_REFUSAL.TASK_KEY },
  { key: "newTask", refusal: START_AGENT_REFUSAL.NEW_TASK },
] as const;

const readStart = Schema.decodeUnknownResult(START_AGENT_CALL);
const readStartFrom = Schema.decodeUnknownResult(START_FROM);

/** A start's from as a start takes it: the agent, and the message a fork names. */
function startFromOf(asked: typeof START_FROM.Type | undefined): AgentStartFrom | undefined {
  if (asked === undefined) return undefined;

  return asked.mode === START_FROM_MODE.FORK
    ? { agentId: asked.agentId, messageId: asked.messageId }
    : { agentId: asked.agentId };
}

/** The tools as the app and every coding agent are offered them: each its name, its words, and its input schema. */
export const LIST_AGENTS_TOOL = {
  name: AGENT_TOOL.LIST_AGENTS,
  description:
    "List the agents of your workspace, on any task and started by any member, yourself left out: " +
    "each with its id, title, model and effort, status (starting, running, completed, failed, canceled) " +
    "and why where it failed, its branch, one line of what it last did, its task and whether that is yours, " +
    "and whether it is archived. The agents that matter to you come first: the agent that started you and " +
    "the agents you started, then those on your task, then the rest, the newest started first, at most " +
    `${WORKSPACE_AGENTS_LIST_LIMIT} a page, with nextOffset where more stand. ` +
    "Failed covers a session that ended for good, which no message reaches again: tell the " +
    "developer, or start a new agent to go on from its work. An agent " +
    "still running long after its last activity may have lost its session; a message to it " +
    "refused as ended for good settles it as failed.",
  inputSchema: AGENT_LIST_INPUT,
} as const;

/** How a read of an agent says a page of its transcript, which the coding agent's and the member MCP's descriptions share. */
export const TRANSCRIPT_PAGE_WORDS =
  "a page of its whole transcript: each line sent to it under who sent it, what it said, and which " +
  "tools it called on what, outputs left out, each entry cut to " +
  `${AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS} characters and the page to ` +
  `${AGENT_TOOL_BOUNDS.PAGE_CHARS}, each of its own with the messageId of the message it ` +
  "stands in. The newest page comes first; pass the page's older as before to read back, " +
  `its newer as after to read on, or from ${TRANSCRIPT_FROM.START} for its first page.`;

/** `read_agent` as a coding agent is offered it, which reads a page of the whole transcript as text and pages through the rest. */
export const CODER_READ_AGENT_TOOL = {
  name: AGENT_TOOL.READ_AGENT,
  description:
    "Read one agent of your workspace by its id, on any task and started by any member: " +
    `what ${AGENT_TOOL.LIST_AGENTS} says of it, the branch it pushed and its pull request, ` +
    `and ${TRANSCRIPT_PAGE_WORDS} Read one to learn why an agent went quiet, what it is ` +
    "stuck on, or what was said to it, before you message it or decide what comes next. " +
    "The agent is not told.",
  inputSchema: CODER_READ_AGENT_INPUT,
} as const;

/** How a start is handed what it is told, as a workspace with Task descriptions on or off words it. */
const START_HANDED_WORDS = {
  on:
    "on the task's description itself with no prompt, or on the prompt given in the " +
    "description's place, with the note after either and any pictures images names, which it sees as " +
    "images.",
  off:
    "on the prompt given, with the note after it and any pictures images names, which it sees as " +
    "images.",
} as const;

/** What a tool's start does to its task, which the coding agent's and the member MCP's descriptions share: nothing, but for its first turn's move. */
export const START_LEAVES_TASK_WORDS =
  "The start leaves the task's assignee and status as they stand, and the agent's first turn " +
  "moves the task to In progress from any other status, as every agent's turn does.";

/** Who pays for a tool start's agent, which no start names, as the coding agent's and the member MCP's `start_agent` and `list_models` state it (`turnPayerOf`, `roomAfterLimit`). */
export const START_PAYER_WORDS =
  "No start names who pays: each turn of a cloud agent runs on the first of the member's " +
  "subscriptions and API keys for the model's provider, in the order Settings keeps them, that " +
  "has room (where none has, its first API key, or with no key the subscription whose limit " +
  "resets soonest), and moves to the next when one hits its limit, " +
  "which may switch it between a subscription and an API key; an agent on a device runs on that " +
  "machine's own login whatever the member keeps.";

/** `start_agent` in the words of the workspace's experiments: its name, its words, and its input schema. */
export function startAgentToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return {
    name: AGENT_TOOL.START_AGENT,
    description: startAgentWords(on),
    inputSchema: startAgentInputOf(on),
  } as const;
}

function startAgentWords(on: Pick<ExperimentsOn, "descriptionsOn">): string {
  const words = wordsOf(on);

  return (
    "Start a new agent on the task its taskId names, your own or another of your workspace, " +
    `${START_HANDED_WORDS[words]} ${START_LEAVES_TASK_WORDS} ${START_PAYER_WORDS} ` +
    "Start it on the task you work on, by your own taskId, for any part of that task's work, even one " +
    "that runs apart from yours, so its branch, pull request, and transcript stand under that task; " +
    "name another task only for work unrelated to it, or where the developer asked for that, and for " +
    `work that should stand as a task of its own, make it with ${AGENT_TOOL.CREATE_TASK} first. ` +
    "This one call carries everything the agent is told as it starts, and it sets to work at once, " +
    "so never follow it with a message to the agent unless there is something new to say. " +
    "It answers the agent's model, effort, permissionMode, and runsOn, whether named or your own. " +
    "The agent messages you when it finishes or needs you. " +
    `A rejected model or effort lists the choices, which ${AGENT_TOOL.LIST_MODELS} lists beforehand. ` +
    "With from, it starts from another agent instead: it continues an agent (or worker) that failed, " +
    "ended, or ran out of context, with mode continue, which stops it, or forks one with mode fork at a " +
    "messageId to try another direction while it goes on; one already continued may be continued again, and the answer names " +
    "the earlier continuations (earlierContinuations). A start from another agent copies its work " +
    "and summarizes its transcript, so it may take a minute to answer."
  );
}

export const START_AGENT_TOOL = startAgentToolOf(EVERY_EXPERIMENT_ON);

export const LIST_MODELS_TOOL = {
  name: AGENT_TOOL.LIST_MODELS,
  description:
    `List the models you may start an agent on with ${AGENT_TOOL.START_AGENT}, as the ` +
    "member you act for is offered them: each with its catalog id, its name, its efforts, and " +
    "its contextWindows, the standard and the long with each one's size in tokens and what the " +
    "long one costs as a multiple of the standard price, or none where it runs on one window; " +
    "and its payers, the kinds of credential the member keeps that pay for it (subscription, " +
    "api_key, both, or none where nothing does), which a start never picks between, since each " +
    "turn of a cloud agent takes the first with room; " +
    "and the member's default, with the window it runs on, which the app's own Starts run on; " +
    `a ${AGENT_TOOL.START_AGENT} call that leaves model and effort out runs on your own, never on it. ` +
    "Call it before you name a model, an effort, or a context window, such as one the developer " +
    `named in their own words. Name an agentId to list instead what that agent may move to with ` +
    `${AGENT_TOOL.UPDATE_AGENT}: an agent on Claude Code runs Claude models alone, and one on ` +
    "Codex GPT models alone, with no fast version, and neither takes a choice of context window.",
  inputSchema: LIST_MODELS_INPUT,
} as const;

/** `update_task` in the words of the workspace's experiments. */
export function updateTaskToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return { ...UPDATE_TASK_TOOL, inputSchema: updateTaskInputOf(on) } as const;
}

export const UPDATE_TASK_TOOL = {
  name: AGENT_TOOL.UPDATE_TASK,
  description:
    "Change a task of your workspace by its id, as the developer's own task menu would, on behalf " +
    "of the developer you work for; name at least one change, and several go in one call. Mark a task " +
    "Done, with status done, when the developer asks, or once its work is done and you are confident " +
    "they won't follow up; never just because you answered a question or ended a turn. Done " +
    "withdraws every ask still open on its " +
    "threads, so mark it done only once you no longer need them, and archives every agent on the " +
    `task, as ${AGENT_TOOL.ARCHIVE_AGENT} would but stopping none: an idle one at once, and one at ` +
    "work, you included, as its turn ends; Canceled does the same. A change of its status off Done brings those agents back, their " +
    "asks left withdrawn, while a turn that reopens the task does not. Never change a teammate's task still " +
    "in use unless the developer asked for it. A task is never archived: a settled one stands Done " +
    "or Canceled. A block is Linear's: the blocker's work comes first and the task it blocks waits " +
    "on it, as advice, never a lock. Both tasks must be in your workspace, a task never blocks " +
    "itself, and a block that would close a cycle is refused. A child task works in its parent's " +
    "repository, so a parent working in another is refused, as is one under which the task would " +
    "descend from itself. Answers the task as it now stands, `already` true where every change " +
    "named already stood. Then say which tasks you changed and how.",
  inputSchema: UPDATE_TASK_INPUT,
} as const;

export const STOP_AGENT_TOOL = {
  name: AGENT_TOOL.STOP_AGENT,
  description:
    "Stop an agent of your workspace by its id, as the developer's Stop button would: " +
    "its turn under way is canceled, while the agent, its transcript, and its branch stay, and a " +
    "later message starts a new turn. Stop an agent you or the developer started that is going the " +
    "wrong way, or one the developer asked you to stop; never a teammate's agent still in use " +
    "unless the developer asked for it. No agent stops itself. Every stop also cancels the agent's " +
    "booked wakeup and pauses the messages queued for it until a member resumes them, even where " +
    "`stopped` is false, an agent already idle. Then say which agent you stopped and why.",
  inputSchema: READ_AGENT_INPUT,
} as const;

const READ_PAGE_INPUT = Schema.Struct({
  pageId: describeWire(
    wireUuidSchema,
    `The page's id, as a mention of it, ${AGENT_TOOL.SHOW_PAGE}'s answer, or a link to it names.`,
  ),
  version: describeWire(
    Schema.Union([
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.Literal(READ_PAGE_VERSION.NEWEST),
    ]),
    `The version to read: its number, as ${AGENT_TOOL.SHOW_PAGE}'s answer or a mention of the page names it, or "${READ_PAGE_VERSION.NEWEST}" for the newest there is.`,
  ),
});

const readPageAsked = Schema.decodeUnknownResult(READ_PAGE_INPUT);

export const READ_PAGE_TOOL = {
  name: AGENT_TOOL.READ_PAGE,
  description:
    "Read a page an agent showed in your workspace, by its id and the version you name, its " +
    `number or "${READ_PAGE_VERSION.NEWEST}": its title, the version read and the ` +
    "newest there is, its task, and its HTML, cut on a line at " +
    `${READ_PAGE_CHARS} characters. Read a page the developer pointed you at, or one another agent ` +
    "showed, before you build on it or revise it; revise a page of your own task by showing it " +
    `again with ${AGENT_TOOL.SHOW_PAGE} and its id.`,
  inputSchema: READ_PAGE_INPUT,
} as const;

/** Why a change to an agent changed nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
export const UPDATE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not changed: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered and at least one ` +
    `change: a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} characters (empty clears ` +
    "it), a model with its effort, both or neither, a contextWindow only with them, pinned, or " +
    `disabledServers as connection names; archive it with ${AGENT_TOOL.ARCHIVE_AGENT}.`,
  UNAVAILABLE: "Not changed: the models could not be read just now. The call may be made again.",
} as const;

/** Why an archive or a bring-back changed nothing, in words the model can act on; one refused for its starter's subscription names the starter (`archiveRefusalWords`). */
export const ARCHIVE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not archived: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered as agentId, and ` +
    `why it is archived as reason, a sentence of at most ${AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS} ` +
    "characters, such as its pull request having merged.",
  UNREADABLE_UNARCHIVE: `Not brought back: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered as agentId.`,
  SELF: "Not archived: that id is your own, and an agent does not archive itself; say you are done, and the developer archives you.",
  NOT_READY:
    "Not archived: that agent's turn is still coming up, so there is no turn to stop yet; call " +
    "again in a moment.",
  NATIVE_NOT_HERE:
    "Not archived: that agent runs on Claude Code or Codex, which cannot be reached from here " +
    "to stop its turn yet; a member archives it from the agent's own tab.",
  UNAVAILABLE:
    "Not archived: the service could not reach that agent's session to stop its turn just now. " +
    "The call may be made again.",
} as const;

/** The lead a refused choice of a change is said under. */
const UPDATE_CHOICE_LEAD = "Not changed";

/**
 * Why a move to a model refuses the context window asked, or nothing: one
 * is required where the model lists two, as `list_models` answers its
 * contextWindows, and refused where it lists none, so the window is always
 * the caller's and never the model's whole one by default.
 */
function contextWindowRefusal(
  asked: { readonly model: string; readonly contextWindow?: string },
  listed: readonly OfferedModel[],
): string | undefined {
  const windows = contextWindowsOf(listed, asked.model);

  if (windows === undefined) {
    return asked.contextWindow === undefined
      ? undefined
      : `${asked.model} runs on one context window, so its ${AGENT_TOOL.LIST_MODELS} contextWindows are empty; leave contextWindow out.`;
  }

  if (asked.contextWindow !== undefined) return undefined;

  return (
    `${asked.model} offers two context windows, so name contextWindow: ` +
    `${CONTEXT_WINDOW.STANDARD} (${windows.standardTokens} tokens) or ` +
    `${CONTEXT_WINDOW.LONG} (${windows.longTokens} tokens), as ${AGENT_TOOL.LIST_MODELS} lists them.`
  );
}

/** Whether a change names anything to change, and a model only with its effort and a window only with them. */
function updateNamesAChange(update: {
  readonly title?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly contextWindow?: string;
  readonly pinned?: boolean;
  readonly disabledServers?: readonly string[];
}): boolean {
  const { title, model, effort, contextWindow, pinned, disabledServers } = update;
  const changes = [title, model, pinned, disabledServers];

  if ((model === undefined) !== (effort === undefined)) return false;

  if (contextWindow !== undefined && model === undefined) return false;

  return changes.some((field) => field !== undefined);
}

/**
 * A change names the agent and at least one of: a title, the model with its
 * effort and, at most, its context window, which the catalog then checks,
 * whether the member pins it, and the MCP servers switched off for it, the
 * whole list. Each is the change a member makes from the agent's own menu, model chip,
 * or composer.
 */
const UPDATE_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  title: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS)),
      "The agent's title as its tab shows it; empty clears it, so the tab shows the model's name.",
    ),
  ),
  model: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.model,
      `The model it runs on from its next step, by its catalog id as ${AGENT_TOOL.LIST_MODELS} ` +
        "answers it; given with the effort or not at all.",
    ),
  ),
  effort: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.effort,
      "The reasoning effort, as the model lists it; given with the model or not at all.",
    ),
  ),
  contextWindow: Schema.optionalKey(
    describeWire(
      contextWindowSchema,
      `The context window it runs on, standard or long, as ${AGENT_TOOL.LIST_MODELS}' ` +
        "contextWindows lists the model's; required with a model that lists two, and refused " +
        "with one whose list is empty.",
    ),
  ),
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "Whether the developer you work for keeps it pinned in their sidebar, the pin theirs alone.",
    ),
  ),
  disabledServers: Schema.optionalKey(
    describeWire(
      disabledServersSchema,
      "The MCP servers switched off for the agent, by connection name, the whole list, which " +
        "replaces the one standing; empty switches every server back on. Its next turn reads it.",
    ),
  ),
}).check(Schema.makeFilter(updateNamesAChange));

const readUpdateAsked = Schema.decodeUnknownResult(UPDATE_AGENT_INPUT);

export const UPDATE_AGENT_TOOL = {
  name: AGENT_TOOL.UPDATE_AGENT,
  description:
    "Change an agent of your workspace by its id, as the developer's own menu, model chip, and " +
    "composer would, for the developer you work for: rename it, move it to another model, effort, " +
    "and context window from its next step, the window named wherever the model's " +
    `${AGENT_TOOL.LIST_MODELS} contextWindows are not empty, pin it, or replace the MCP servers ` +
    "switched off for it; the changes land together or not at all. Change a teammate's agent " +
    "still in use only where the developer asked for it. A rejected model or effort lists the " +
    "choices. Then say which agent you changed and how.",
  inputSchema: UPDATE_AGENT_INPUT,
} as const;

/** An archive names the agent and why it is archived, which its archived banner shows. */
const ARCHIVE_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  reason: describeWire(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS),
    ),
    "Why it is archived, in a short sentence the developer reads on its archived banner " +
      "beside your name, such as its pull request having merged.",
  ),
});

const readArchiveAsked = Schema.decodeUnknownResult(ARCHIVE_AGENT_INPUT);

export const ARCHIVE_AGENT_TOOL = {
  name: AGENT_TOOL.ARCHIVE_AGENT,
  description:
    "Archive an agent of your workspace by its id, as the developer's Archive agent would, for " +
    "the developer you work for: it is stopped first, as " +
    `${AGENT_TOOL.STOP_AGENT} would, an idle one too, and its open asks are withdrawn; then it leaves every list ` +
    "but the archived ones, takes no message, and is not woken by GitHub or an automation. Its " +
    "transcript, branch, and pull request are kept, but one on a member's device has its folder " +
    "removed there, so what it never pushed is lost. Archive a helper agent whose work is done, " +
    "such as one whose pull request merged, or one the developer asked you to clean up, with a " +
    "short reason; never a teammate's agent still in use unless the developer asked for it. No " +
    `agent archives itself. ${AGENT_TOOL.UNARCHIVE_AGENT} brings one back. Then say which agent ` +
    "you archived and why.",
  inputSchema: ARCHIVE_AGENT_INPUT,
} as const;

export const UNARCHIVE_AGENT_TOOL = {
  name: AGENT_TOOL.UNARCHIVE_AGENT,
  description:
    "Bring an archived agent of your workspace back by its id, as the developer's Unarchive " +
    "would: it stands in its task's lists again and takes messages, its archive's record " +
    "cleared; it starts no turn, and the asks its archive withdrew stay withdrawn. One not " +
    "archived is answered as it stands. Then say which agent you brought back.",
  inputSchema: READ_AGENT_INPUT,
} as const;

/** A list of tasks names its words to look for at most, and how many of the matching tasks to pass over. */
const LIST_TASKS_INPUT = Schema.Struct({
  nameContains: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
      "Only the tasks whose name holds these words, whatever their case; leave it out for all.",
    ),
  ),
  status: Schema.optionalKey(
    describeWire(taskStatusSchema, "Only the tasks that stand here; leave it out for all."),
  ),
  assignee: Schema.optionalKey(
    describeWire(
      taskAssigneeWrittenSchema,
      "Only the tasks assigned to this member, by their mention link, or null for the tasks no " +
        "one is assigned to; leave it out for all.",
    ),
  ),
  offset: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      "How many of the matching tasks to pass over, newest first: the nextOffset an earlier list " +
        "answered, to read the next page; leave it out for the first.",
    ),
  ),
});

const readTasksAsked = Schema.decodeUnknownResult(LIST_TASKS_INPUT);

export const LIST_TASKS_TOOL = {
  name: AGENT_TOOL.LIST_TASKS,
  description:
    "List the tasks of your workspace, started by any member, the Done and Canceled ones " +
    "among them: each with its id, its key (such as ACME-42), its name, status, priority, " +
    "assignee's mention link, repository, who started it, whether it is the task you work on, " +
    "its followers (each with their name and id, and whether its agents may use their machines), " +
    "and the sectionId of the sidebar section the developer you work for keeps it in, the newest " +
    `first and at most ${TASKS_LIST_LIMIT} a page, with nextOffset where more stand; and beside ` +
    "them every section that developer keeps in this workspace's sidebar, by its id and title.",
  inputSchema: LIST_TASKS_INPUT,
} as const;

/** How a refusal names a continuation that has no title yet. */
const CONTINUATION_NAME = "its continuation";

const ENTRY_WORDS = {
  SAID: "Said",
} as const;

/** An entry on one line, cut to the bound on a whole character, since half an emoji left by the cut is refused by the store its answer lands in (STAG-3994). */
function cut(text: string, maximumChars: number): string {
  return cutText(text.replace(/\s+/gu, " ").trim(), maximumChars);
}

/** One entry's words, whole, and the id of the call it says, where it is one. */
interface EntryWords {
  readonly text: string;
  readonly callId?: string;
}

/** A journal's entries in order, whole: each of the agent's own texts, and each call with its subject and its id. */
function journalEntriesOf(journal: StoredUIMessage): EntryWords[] {
  return journal.parts.flatMap((part): EntryWords[] => {
    if (isTextUIPart(part) && part.text.trim().length > 0) {
      return [{ text: `${ENTRY_WORDS.SAID}: ${part.text.trim()}` }];
    }

    if (isStoredToolPart(part)) return [{ text: callEntry(part), callId: part.toolCallId }];

    return [];
  });
}

/** A journal's entries in order, whole, as words alone. */
function entriesOf(journal: StoredUIMessage): string[] {
  return journalEntriesOf(journal).map((entry) => entry.text);
}

/** A message's entries in order, whole: a line under who sent it, its files named, and a journal's own; none for any other row. */
function rowEntriesOf(record: StoredMessageRecord, sent: LineSent | undefined): EntryWords[] {
  const { role, parts } = record.message;

  if (role === MESSAGE_ROLE.ASSISTANT) return journalEntriesOf(record.message);

  if (role !== MESSAGE_ROLE.USER) return [];
  const words = lineWords(parts).trim();

  return words === "" ? [] : [{ text: `${senderName(sent)}: ${words}` }];
}

/** One agent as the model reads it: its title, what it runs on, where it stands, the branch its row holds, and what it last did. */
interface AgentReading {
  readonly id: string;
  readonly task: AgentTask | null;
  /** Whether the agent works on the call's own task. */
  readonly onYourTask: boolean;
  readonly archived: boolean;
  /** The agent's title, what it works on, which update_agent renames; the model's id where it has none yet. */
  readonly title: string;
  readonly model: string;
  /** The model as the app says it and the screen shows it, without the maker's word (`modelLabel`). */
  readonly modelName: string;
  readonly effort: string;
  readonly status: AgentStatus;
  readonly failureReason?: AgentFailure;
  /** The repository it works in; null for an agent with none. */
  readonly repository: string | null;
  readonly branch: string | null;
  readonly activity: string | null;
}

/** The agents' standings, read once for the lot: each one's newest turn and first launch's boot. The agents were read through their workspace's gate, so their conversations are read by id. */
const standingsOf = (agents: readonly Agent[]) =>
  Effect.gen(function* () {
    const ids = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(ids);
    const boots = yield* agentBootsOf(agents.map((agent) => agent.id));
    const now = yield* Clock.currentTimeMillis;

    return (agent: Agent) => {
      const turn = turns.get(agent.conversationId);

      const status = agentStatusOf(turn, {
        createdAt: agent.createdAt,
        now,
        blank: startedBlank(agent),
        boot: boots.get(agent.id)?.phase,
      });

      // Why the newest turn failed is said only while the agent reads as failed.
      return {
        status,
        failureReason: status === AGENT_STATUS.FAILED ? agentFailureOf(turn) : undefined,
      };
    };
  });

/**
 * The models offered as the catalog last read them, or none where it cannot
 * be read: a model is then named from its id, as the screen names it before
 * the catalog arrives.
 */
const offeredModels = Effect.flatMap(ModelCatalog, (catalog) =>
  Effect.orElseSucceed(catalog.read, (): readonly OfferedModel[] => []),
);

/** The newest journal of each agent's conversation, read once for the lot, keyed by conversation. The agents were read through their workspace's gate, so their conversations are read by id. */
const newestJournalsOf = (agents: readonly Agent[]) =>
  newestJournalsOfReached(
    agents.map((agent) => agent.conversationId),
    CODER_TOOL_SET,
  );

const readAgentReading = (
  agent: Agent,
  task: AgentTaskReading,
  standing: {
    readonly status: AgentStatus;
    readonly failureReason: AgentFailure | undefined;
  },
  newest: StoredMessageRecord | undefined,
  offered: readonly OfferedModel[],
): AgentReading => {
  const activity =
    newest === undefined
      ? undefined
      : entriesOf(newest.message)
          .map((entry) => cut(entry, AGENT_TOOL_BOUNDS.ACTIVITY_CHARS))
          .at(-1);

  return {
    id: agent.id,
    ...task,
    archived: agent.archivedAt !== null,
    title: agent.title ?? agent.model,
    model: agent.model,
    modelName: modelLabel(agent.model, offered),
    effort: agent.effort,
    status: standing.status,
    ...(standing.failureReason === undefined
      ? undefined
      : { failureReason: standing.failureReason }),
    repository: agent.repository,
    branch: agent.branch,
    activity: activity ?? null,
  };
};

/** What the agent published as GitHub holds it, or nothing where GitHub could not be asked, which is said as no publication rather than none. */
const publishedOf = (
  userId: string,
  agent: Agent,
): Effect.Effect<
  AgentPullRequestAnswer | undefined,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> =>
  Effect.map(Effect.result(agentPublishedUnwritten(userId, agent)), (read) =>
    Result.isSuccess(read) ? read.success : undefined,
  );

/** The coding agent calling; none for a member, who is never one of the agents a tool reaches as itself. */
export function callerAgent(caller: AgentCaller): Agent | undefined {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent : undefined;
}

/** The member a call acts for: the starter of the coding agent calling, or the member calling. */
export function callerUserId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.userId : caller.userId;
}

/** The workspace a call is in, whose experiments it reads: the coding agent's own, or the one the member's call is about. */
export function callerWorkspaceId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.organizationId : caller.workspaceId;
}

/** The task the caller works on: the coding agent's own, which may be none; none for a member. */
export function callerTask(caller: AgentCaller): string | null {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.taskId : null;
}

/**
 * The workspace the caller reaches agents in, read on its member's standing
 * now: as the agent reads itself (`ownAgentWorkspace`), or the member's
 * workspace while they are still a member of it; nothing where they no
 * longer reach it. Every agent and task its tools act on is still read on
 * the member's own rule (`workspaceAgent`, a start's reach).
 */
export const callerWorkspace = (
  caller: AgentCaller,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> =>
  caller.kind === AGENT_CALLER.AGENT
    ? ownAgentWorkspace(caller.agent.userId, caller.agent)
    : Effect.map(isWorkspaceMember(caller.userId, caller.workspaceId), (member) =>
        member ? Option.some(caller.workspaceId) : Option.none(),
      );

/** The agent's native runtime and payer, which decide the models it may move to; none on the retired runtime. */
const agentRouteOf = (agent: Agent) =>
  Effect.map(nativeRouteOfReached(agent.conversationId), Option.getOrUndefined);

/** An agent of the caller's workspace under the id, with its task, or nothing: one of another workspace, the member's other ones included, or none. */
export const workspaceAgentOf = (caller: AgentCaller, agentId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);

    if (Option.isNone(workspace)) return Option.none();
    const userId = callerUserId(caller);
    const found = yield* workspaceAgent(userId, workspace.value, agentId, callerAgent(caller)?.id);

    if (Option.isNone(found)) return Option.none();
    const agent = found.value;
    const task = yield* agentTaskOf(userId, agent);

    return Option.some({
      agent,
      task: taskReading(task, callerTask(caller)),
      workspaceId: workspace.value,
    });
  });

/** Whether the task named is one of the caller's workspace, as its member reads both now. */
const taskOfCallerWorkspace = (caller: AgentCaller, taskId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);

    if (Option.isNone(workspace)) return false;
    const owning = yield* readTaskWorkspace(callerUserId(caller), taskId);

    return Option.isSome(owning) && owning.value === workspace.value;
  });

/**
 * Why a start names no branch where it must, in words beginning with the
 * refusal's own (`Not started`, `Not added`): a task that works in a
 * repository has its agent's checkout cloned at the branch the caller
 * names, never at one the service picks, so a start on it without one is
 * refused with the repository and how to read its default branch. A task
 * with no repository, or one the account does not reach, which the start
 * refuses on its own, needs none.
 */
export const branchNeededRefusal = (
  caller: AgentCaller,
  taskId: string,
  branch: string | undefined,
  refused: string,
) =>
  Effect.gen(function* () {
    if (branch !== undefined) return undefined;
    const task = yield* readTaskHeader(callerUserId(caller), taskId);

    if (Option.isNone(task) || task.value.repository === null) return undefined;
    const repository = task.value.repository;

    // Note that a member's client lists repositories with their default branch, while a coding agent reads it with gh in its checkout.
    const answers =
      callerAgent(caller) === undefined
        ? `${MEMBER_MCP_TOOL.LIST_REPOSITORIES} answers as defaultBranch`
        : `\`gh api repos/${repository} --jq .default_branch\` answers`;

    return (
      `${refused}: the task works in ${repository}, so name the branch to clone the agent's ` +
      `checkout at as branch, such as the repository's default branch, which ${answers}, or ` +
      "the head branch of a pull request it builds on."
    );
  });

/** A call's refusal as the model reads it, here and at a coding agent's edge for a session it does not admit. */
export function agentToolRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A refusal's words, with when a plan's reached limit resets where the provider said, and which harness to connect where a credential is missing. */
function withReset(words: string, refusal: HostedRefusal): string {
  if (refusal.provider !== undefined) {
    return `${words} The model's provider is connected as ${harnessNameOf(refusal.provider)}.`;
  }

  return refusal.resetsAt === undefined
    ? words
    : `${words} It resets at ${new Date(refusal.resetsAt).toISOString()}.`;
}

/** A start's refusal in the model's words. */
function startRefusalWords(refusal: HostedRefusal): string {
  if (refusal.localAgentRefusal === LOCAL_AGENT_REFUSAL.NOT_OWNER) {
    return notOwnerWords(refusal.refusedDevice);
  }

  if (refusal.localAgentRefusal !== undefined) {
    return LOCAL_AGENT_REFUSAL_WORDS[refusal.localAgentRefusal];
  }

  return withReset(
    START_REFUSAL_WORDS.get(refusal.error) ?? START_AGENT_REFUSAL.UNAVAILABLE,
    refusal,
  );
}

/** A choice the catalog refused, the one named or, on a start from another agent naming none, that agent's, said with every model offered and the efforts each lists, so the model can try again or ask. */
export function choiceRefusal(
  choice: ModelChoice | undefined,
  offered: readonly OfferedModel[],
  lead = "Not started",
): string {
  const refused =
    choice === undefined
      ? "the model of the agent it starts from is no longer offered, so name model and effort"
      : `no offered model is ${choice.model} at effort ${choice.effort}`;

  return `${lead}: ${refused}. ${offeredChoicesWords(offered)}`;
}

/** Why a start that left model and effort out was refused the caller's own: no longer offered to its starter, so it names one. */
function ownChoiceRefusal(choice: ModelChoice, offered: readonly OfferedModel[]): string {
  return (
    `Not started: your own model, ${choice.model} at effort ${choice.effort}, which a start ` +
    "leaving model and effort out runs on, is not offered for this start, so name model and " +
    `effort. ${offeredChoicesWords(offered)}`
  );
}

/** The models and efforts a choice may name, as a refusal lists them. */
function offeredChoicesWords(offered: readonly OfferedModel[]): string {
  const choices = offered.map((model) => `${model.id} (${model.efforts.join(", ")})`).join("; ");

  return `The choices are: ${choices}.`;
}

/** How a coding agent names itself to another: its title, its id to answer it by, and its repository where it has one. */
function agentIntroduction(agent: Agent): string {
  const working = agent.repository === null ? "" : `, working in ${agent.repository}`;

  return `"${agentName(agent)}" (agent id ${agent.id})${working}`;
}

/**
 * The run an agent the caller starts on no task belongs to: the run the
 * caller works on now, else the one the caller itself belongs to, else none.
 * Note that the run handed to it is read rather than its own row's, because
 * a same-agent automation hands every run to one agent, whose row keeps the
 * run that first started it.
 */
function runOfCaller(calling: Agent) {
  return Effect.map(currentAutomationRun(calling.id), (current) =>
    Option.getOrElse(current, () => calling.automationRunId ?? undefined),
  );
}

/**
 * The note an agent a coding agent starts is handed: which agent started it,
 * that its final message reaches that agent by itself once its turn ends
 * (`coder-host/starter-report.ts`), that it messages it before then with
 * `message_agent` by that agent's id, as every word between two agents goes
 * (`coder-host/agent-message.ts`), and, where a Manager started it, which
 * closes its threads (`tool-catalog/gates.ts`'s `UNMANAGED`), that it
 * reports to that Manager alone, then the note it was given. Note that an
 * agent another coder started hears of its own threads from its
 * instructions instead (`coder-host/instructions.ts`), worded from its
 * standing on every session, since whether it posts any follows its task's
 * assignee, who may change after the start.
 */
function startedByNote(starter: Agent, note: string | undefined): string {
  const lead =
    `You were started by another agent of your workspace, ${agentIntroduction(starter)}, ` +
    `not by the developer. Message it with ${AGENT_TOOL.MESSAGE_AGENT}, its agentId ${starter.id}, ` +
    "when you finish, with what you did, what you published, and what you need of it, and whenever " +
    "you need something from it; if your turn fails, it is told." +
    (starter.kind === AGENT_KIND.MANAGER
      ? ` It is a Manager, and you post no threads and send no Slack message: send your questions and reports to it with ${AGENT_TOOL.MESSAGE_AGENT}, and it reaches people for you. ` +
        `To hand it a picture, show the file with ${AGENT_TOOL.SHOW_MEDIA} and put the picture ids it answers in your message, never a sandbox path.`
      : "");

  return note === undefined ? lead : `${lead}\n\n${note}`;
}

/** The agent as a start answers it: its id, what it runs on, where it stands now, and whether it is on the caller's own task, which a window that opens the caller's task alone reads to link it or not. */
const startedReading = (agent: Agent, offered: readonly OfferedModel[], ownTask: string | null) =>
  Effect.gen(function* () {
    const standing = yield* standingsOf([agent]);

    return {
      id: agent.id,
      title: agentName(agent),
      model: agent.model,
      modelName: modelLabel(agent.model, offered),
      effort: agent.effort,
      permissionMode: agent.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS,
      runsOn: agentRunsOnOf(agent),
      status: standing(agent).status,
      onYourTask: agent.taskId === ownTask,
    };
  });

/** A store that could not be read is the one refusal, logged for the operator and said to the model. */
export const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), agentToolRejected(AGENT_TOOL_REFUSAL.STORE)),
  );

/**
 * What a call made before, run again after its start landed: the agent made
 * under its key, while that agent is still of the caller's workspace, and
 * refused as naming no task once it has moved out of it, so a retry neither
 * starts a second agent nor tells of one in a workspace the caller left
 * behind; nothing where the call made no agent.
 */
const startedBefore = (call: AgentCall, userId: string) =>
  Effect.gen(function* () {
    const { caller } = call;
    const made = yield* readAgentByKey(userId, call.clientKey);

    if (Option.isNone(made)) return Option.none<WireRecord>();
    const agent = made.value;
    const workspace = yield* callerWorkspace(caller);

    if (Option.isNone(workspace) || agent.organizationId !== workspace.value) {
      return Option.some(agentToolRejected(START_AGENT_REFUSAL.NO_SUCH_TASK));
    }

    const reading = yield* startedReading(agent, yield* offeredModels, callerTask(caller));
    // A continue run again names the agents that continued its source before it, as its first answer did.
    const from = agent.startedFrom;

    const continuedBy =
      from === null || from.messageId !== undefined
        ? []
        : yield* earlierContinuationsOf(
            { userId, workspaceId: workspace.value, taskId: agent.taskId },
            from.agentId,
            agent.id,
          );

    return Option.some<WireRecord>({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      agent: reading,
      ...earlierContinuations(continuedBy, agent.id),
    });
  });

/** An agent as the reading spells it, which the wire holds to be JSON all the way down. */
function readingRecord(reading: AgentReading): WireRecord {
  return { ...reading, task: reading.task === null ? null : { ...reading.task } };
}

/** One call of `list_agents`: a page of the agents of the caller's workspace, or of one task of it, or those the words name, the calling agent left out, archived ones marked, the caller's own first and then the newest, and the next page's offset where more stand. */
export function runListAgents(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const ownTask = callerTask(caller);
  const narrowed = listedFilter(input);

  if (Result.isFailure(narrowed)) return Effect.succeed(agentToolRejected(narrowed.failure));

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = callerUserId(caller);
      const { taskId: taskRef } = narrowed.success;

      // A task the list narrows to by its key is read in the caller's workspace alone.
      const listedTask =
        taskRef === undefined
          ? Result.succeed(undefined)
          : yield* taskIdOfInput(
              userId,
              workspace.value,
              { opening: "Not run", field: "taskId" },
              taskRef,
            );

      if (Result.isFailure(listedTask)) return agentToolRejected(listedTask.failure);

      const { agents, taskOf, nextOffset } = yield* workspaceAgentsOf(
        userId,
        workspace.value,
        callerAgent(caller),
        { ...narrowed.success, taskId: listedTask.success },
      );

      const standing = yield* standingsOf(agents);
      const newest = yield* newestJournalsOf(agents);
      const offered = yield* offeredModels;

      const readings = agents.map((agent) =>
        readAgentReading(
          agent,
          taskReading(taskOf(agent), ownTask),
          standing(agent),
          newest.get(agent.conversationId),
          offered,
        ),
      );

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agents: readings.map(readingRecord),
        nextOffset,
      };
    }),
  );
}

/** How a page reads a transcript: back from a place, or from its end, or on from a place, or from its start. */
const PAGE_WAY = {
  BACK: "back",
  ON: "on",
} as const;

type PageWay = (typeof PAGE_WAY)[keyof typeof PAGE_WAY];

/** Which page a read asks for: the way it reads, the place it reads from, none for the transcript's end or start, and at most how many entries. */
export interface PageAsked {
  readonly way: PageWay;
  readonly place: TranscriptPlace | undefined;
  readonly entries: number;
}

/** One entry of a page: its place, the journal it stands in, which a fork names, none for a line sent to the agent, the line sent to the agent, which a rewind names, none for the agent's own, its words, cut to the bound, and the id of the call it says, where it is one. */
export interface PageEntry {
  readonly place: TranscriptPlace;
  readonly messageId: string | undefined;
  readonly lineId: string | undefined;
  readonly text: string;
  readonly callId: string | undefined;
}

/** A page of a transcript in the order it was read, and whether an entry stands past it that did not fit. */
export interface PageRead {
  readonly entries: readonly PageEntry[];
  readonly more: boolean;
}

/** Whether one place comes before another in a transcript. */
function isBefore(one: TranscriptPlace, other: TranscriptPlace): boolean {
  return one.seq < other.seq || (one.seq === other.seq && one.entry < other.entry);
}

/** Whether an entry lies past the place a page reads from, the way it reads; every entry where it names none. */
function liesPast(place: TranscriptPlace, asked: PageAsked): boolean {
  if (asked.place === undefined) return true;

  return asked.way === PAGE_WAY.BACK ? isBefore(place, asked.place) : isBefore(asked.place, place);
}

/** A message's entries in the order a page reads them, each with its place and cut to the bound. */
function pageEntriesOf(
  record: StoredMessageRecord,
  sent: LineSent | undefined,
  way: PageWay,
): PageEntry[] {
  const entries = rowEntriesOf(record, sent).map(({ text, callId }, entry) => ({
    place: { seq: record.seq, entry },
    // Note that only the agent's own journal is named, because a fork is cut at one and refuses a line.
    messageId: record.message.role === MESSAGE_ROLE.ASSISTANT ? record.id : undefined,
    // Note that a line sent to the agent is named apart, because a rewind is cut before one and a fork refuses it.
    lineId: record.message.role === MESSAGE_ROLE.USER ? record.id : undefined,
    text: cutText(text, AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS),
    callId,
  }));

  return way === PAGE_WAY.BACK ? entries.reverse() : entries;
}

/** The messages a page reads next, in the order it reads them, and the sequence to read on from, none where the transcript ends with them. */
interface PageRows {
  readonly rows: readonly StoredMessageRecord[];
  readonly next: number | undefined;
}

/** The messages a page reads next from a sequence, the way it reads; nothing where one of them does not read. */
const pageRowsAt = (target: ConversationTarget, way: PageWay, at: number) => {
  const { PAGE_ROWS } = AGENT_TOOL_BOUNDS;
  const { userId, conversationId } = target;

  return Effect.map(
    way === PAGE_WAY.BACK
      ? listMessagesBefore(userId, conversationId, CODER_TOOL_SET, at, PAGE_ROWS)
      : listMessagesFrom(userId, conversationId, CODER_TOOL_SET, at, PAGE_ROWS),
    (read): PageRows | undefined => {
      if (!read.ok) return undefined;
      const rows = read.value;
      const ordered = way === PAGE_WAY.BACK ? rows.toReversed() : rows;
      const last = ordered.at(-1);
      const next = way === PAGE_WAY.BACK ? last?.seq : (last?.seq ?? 0) + 1;

      return { rows: ordered, next: rows.length < PAGE_ROWS ? undefined : next };
    },
  );
};

/**
 * A page of a transcript, an agent's or its worker's, read under the
 * member who started the agent:
 * the entries past the place asked, the way asked, until the page holds as
 * many as asked or the next would take it past its budget of characters,
 * which leaves at least one on a page however long. Note that a page reads
 * the store a few messages at a time, because one journal can hold a whole
 * run's calls and a page rarely needs many; and that a page reaching a
 * message that does not read is nothing, as a fork's replay is, because a
 * page that stopped there would pass for the transcript's own end.
 */
export const transcriptPage = (target: ConversationTarget, asked: PageAsked) =>
  Effect.gen(function* () {
    const entries: PageEntry[] = [];
    let chars = 0;

    let at: number | undefined =
      asked.way === PAGE_WAY.BACK
        ? asked.place === undefined
          ? Number.MAX_SAFE_INTEGER
          : asked.place.seq + 1
        : (asked.place?.seq ?? 0);

    while (at !== undefined) {
      const rowsRead: PageRows | undefined = yield* pageRowsAt(target, asked.way, at);

      if (rowsRead === undefined) return undefined;
      const { rows, next }: PageRows = rowsRead;

      const senders = yield* lineSendersOf(
        { userId: target.userId, conversationId: target.conversationId },
        rows.filter((row) => row.message.role === MESSAGE_ROLE.USER).map((row) => row.id),
      );

      const read = rows.flatMap((row) => pageEntriesOf(row, senders.get(row.id), asked.way));

      for (const entry of read.filter((each) => liesPast(each.place, asked))) {
        const full =
          entries.length === asked.entries ||
          (entries.length > 0 && chars + entry.text.length > AGENT_TOOL_BOUNDS.PAGE_CHARS);

        if (full) return { entries, more: true } satisfies PageRead;
        entries.push(entry);
        chars += entry.text.length;
      }

      at = next;
    }

    return { entries, more: false } satisfies PageRead;
  });

/** Which page a read asks for, from its input: a place before or after, else the end or the start; none where it names both places. */
export function pageAskedOf(
  asked: Pick<typeof CODER_READ_AGENT_INPUT.Type, "from" | "before" | "after" | "entries">,
): PageAsked | undefined {
  const entries = asked.entries ?? AGENT_TOOL_BOUNDS.MAX_PAGE_ENTRIES;

  if (asked.before !== undefined && asked.after !== undefined) return undefined;

  if (asked.before !== undefined) return { way: PAGE_WAY.BACK, place: asked.before, entries };

  if (asked.after !== undefined) return { way: PAGE_WAY.ON, place: asked.after, entries };
  const way = asked.from === TRANSCRIPT_FROM.START ? PAGE_WAY.ON : PAGE_WAY.BACK;

  return { way, place: undefined, entries };
}

/**
 * A page as the read answers it: its entries oldest first, the place to
 * read back from where an entry stands before it, and the place to read on
 * from where one stands after it. Note that an entry stands on the side a
 * page was read from wherever that read named a place, since the place is
 * an entry's own, and on the far side wherever the page was full.
 */
export function pageAnswer(
  asked: PageAsked,
  page: PageRead,
  said: (entry: PageEntry) => WireRecord,
): WireRecord {
  const back = asked.way === PAGE_WAY.BACK;
  const entries = back ? page.entries.toReversed() : page.entries;
  const first = entries[0];
  const last = entries.at(-1);
  const older = (back ? page.more : asked.place !== undefined) ? first?.place : undefined;
  const newer = (back ? asked.place !== undefined : page.more) ? last?.place : undefined;

  return {
    transcript: entries.map(said),
    ...(older === undefined ? undefined : { older: { ...older } }),
    ...(newer === undefined ? undefined : { newer: { ...newer } }),
  };
}

/** An entry as `read_agent` says it: its words, and the journal it stands in where it is the agent's own. */
function readAgentEntry({ messageId, lineId, text }: PageEntry): WireRecord {
  return {
    ...(messageId === undefined ? undefined : { messageId }),
    ...(lineId === undefined ? undefined : { lineId }),
    text,
  };
}

/**
 * An agent's queue as `read_agent` and the member MCP's `change_agent_queue`
 * say it: each message waiting behind its turn, in the order they go, by its
 * id, its words cut short, how many files go with it, and whether a member
 * holds it to edit, which stops the hand-off at it; and why the queue
 * stands paused, which sends nothing until it is resumed.
 */
export function queueRecord(queue: AgentQueue): WireRecord {
  return {
    messages: queue.messages.map((message) => ({
      id: message.id,
      text: cutText(message.text, AGENT_TOOL_BOUNDS.QUEUED_CHARS),
      ...(message.files === undefined ? undefined : { files: message.files.length }),
      ...(message.editing ? { held: true } : undefined),
    })),
    ...(queue.paused === undefined ? undefined : { paused: { ...queue.paused } }),
  };
}

/** The agent as the list reads it, read through the caller's workspace, and its queue; none where the caller cannot see it. */
const agentStandingOf = (caller: AgentCaller, agentId: string) =>
  Effect.gen(function* () {
    const found = yield* workspaceAgentOf(caller, agentId);

    if (Option.isNone(found)) return Option.none();
    const { agent, task } = found.value;
    const standing = yield* standingsOf([agent]);
    const newest = yield* newestJournalsOf([agent]);

    const reading = readAgentReading(
      agent,
      task,
      standing(agent),
      newest.get(agent.conversationId),
      yield* offeredModels,
    );

    const queue = yield* queueOnPage(agent.id);

    return Option.some({
      agent,
      reading: readingRecord(reading),
      queue: queue.messages.length === 0 ? undefined : queueRecord(queue),
    });
  });

/** One call of `read_agent`: the agent as the list reads it, its queue where messages wait in it, and the page of its transcript asked, its newest where none is named. */
export function runReadAgent(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentAsked(input);
  const page = Result.isSuccess(asked) ? pageAskedOf(asked.success) : undefined;

  if (Result.isFailure(asked) || page === undefined) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_PAGE));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* agentStandingOf(call.caller, asked.success.agentId);

      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, reading, queue } = found.value;
      const published = yield* publishedOf(callerUserId(call.caller), agent);
      const read = yield* transcriptPage(agent, page);

      if (read === undefined) return agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TRANSCRIPT);

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: reading,
        ...(published === undefined
          ? undefined
          : { published: { branch: published.branch, pullRequest: published.pullRequest } }),
        ...(queue === undefined ? undefined : { queue }),
        ...pageAnswer(page, read, readAgentEntry),
      };
    }),
  );
}

/** One call of the member MCP's `read_agent`: the agent as the list reads it and its queue where messages wait in it, which leaves its transcript to `read_agent_transcript` and what it published to `read_agent_changes`. */
export function runReadAgentStanding(
  call: AgentReadCall,
  agentId: string,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  return orStoreRefusal(
    Effect.map(agentStandingOf(call.caller, agentId), (found) =>
      Option.match(found, {
        onNone: () => agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT),
        onSome: ({ reading, queue }) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          agent: reading,
          ...(queue === undefined ? undefined : { queue }),
        }),
      }),
    ),
  );
}

/** An agent that already continued the one a start continues, as the start's answer names it: its id and its title. */
interface EarlierContinuation {
  readonly id: string;
  readonly title: string;
}

/** Where a start from another agent lands: the source's own place, its task or, with none, its workspace and repository, and, for a continue, the agents that already continued the source, oldest first. */
interface SourceLanding {
  readonly place: StartWhere;
  readonly continuedBy: readonly EarlierContinuation[];
  /** The source's model, which a start naming none runs on. */
  readonly model: string;
}

/**
 * The agents that continued a source, oldest first, each by its id and its
 * title, up to the one named `upTo`, which is left out with every agent
 * after it; all of them where none is named. A fork is no continuation.
 */
const earlierContinuationsOf = (
  at: { readonly userId: string; readonly workspaceId: string; readonly taskId: string | null },
  sourceId: string,
  upTo?: string,
) =>
  Effect.gen(function* () {
    const continuations = (yield* continuationsOf(at.userId, [sourceId])).get(sourceId) ?? [];
    const whole = continuations.filter((each) => each.messageId === undefined);
    const cut = whole.findIndex((each) => each.agentId === upTo);
    const earlier = cut < 0 ? whole : whole.slice(0, cut);

    return earlier.map(
      (each): EarlierContinuation => ({
        id: each.agentId,
        title: each.title ?? CONTINUATION_NAME,
      }),
    );
  });

/**
 * Whether the agent is started, directly or through the agents between,
 * by the ancestor, read on the starter links as stored now. The links form a
 * chain that ends at an agent with no starter; one already seen ends it.
 */
const startedThrough = (userId: string, agentId: string, ancestorId: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    let at: string | null = agentId;

    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const read: Option.Option<Agent> = yield* readAgent(userId, at);
      at = Option.isSome(read) ? read.value.startedByAgentId : null;

      if (at === ancestorId) return true;
    }

    return false;
  });

/** The place a start from another agent lands in, the source's own, once the source is read and found fit to start from, with the agents that already continued it; or why it is not. */
const sourceLanding = (
  caller: AgentCaller,
  from: AgentStartFrom,
  named: string,
): Effect.Effect<Result.Result<SourceLanding, string>, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const found = yield* workspaceAgentOf(caller, from.agentId);

    if (Option.isNone(found)) return Result.fail(START_AGENT_REFUSAL.NO_SOURCE);
    const { agent: source, workspaceId } = found.value;

    if (!startsFromAgent(callerUserId(caller), source)) {
      return Result.fail(`Not started: only ${yield* agentStarterName(source)} can do this.`);
    }

    if (named !== source.taskId) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_OTHER_TASK);
    }

    // A start from an agent lands on the source's own task.
    const place = placeOfAgent(source);

    // A fork names one of the source's own messages, and leaves the source going on beside it.
    if (from.messageId !== undefined) {
      const { userId, conversationId } = source;
      const role = MESSAGE_ROLE.ASSISTANT;
      const at = yield* messageSeqOf(userId, conversationId, from.messageId, role);

      if (Option.isNone(at)) return Result.fail(START_AGENT_REFUSAL.NO_MESSAGE);

      return Result.succeed({ place, continuedBy: [], model: source.model });
    }

    // Note that a continue of an agent that started the caller stops that agent, while the caller's reports still go to it.
    // A member is started by no agent, so no source started them.
    const calling = callerAgent(caller);

    if (
      calling !== undefined &&
      (yield* startedThrough(callerUserId(caller), calling.id, source.id))
    ) {
      return Result.fail(START_AGENT_REFUSAL.STARTER_CONTINUE);
    }

    // A continue takes over work that has ended; one already continued is
    // continued again, since a continuation may itself fail or go wrong, and
    // the answer names the earlier ones so the caller knows they stand.
    const { status } = (yield* standingsOf([source]))(source);

    if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_RUNNING);
    }

    const at = { userId: callerUserId(caller), workspaceId, taskId: source.taskId };
    const continuedBy = yield* earlierContinuationsOf(at, source.id);

    return Result.succeed({ place, continuedBy, model: source.model });
  });

/** What a continue's answer adds where other agents already continued its source: those agents, oldest first, the one it started left out; nothing otherwise. */
function earlierContinuations(
  continuedBy: readonly EarlierContinuation[] | undefined,
  startedId: string,
): WireRecord {
  const earlier = (continuedBy ?? []).filter((each) => each.id !== startedId);

  return earlier.length === 0 ? {} : { earlierContinuations: earlier.map((each) => ({ ...each })) };
}

/** A start's refusal in the model's words, said of the source where the start named one: one that is none of the caller's, or a message that is none of the source's. */
function startFromRefusalWords(refusal: HostedRefusal, from: AgentStartFrom | undefined): string {
  if (from !== undefined && refusal.error === HOSTED_API_ERROR.NOT_FOUND) {
    return START_AGENT_REFUSAL.NO_SOURCE;
  }

  if (from?.messageId !== undefined && refusal.error === HOSTED_API_ERROR.INVALID_REQUEST) {
    return START_AGENT_REFUSAL.NO_MESSAGE;
  }

  return startRefusalWords(refusal);
}

/** Who hands pictures on in the caller's name: the coding agent its own conversation's; a member, who keeps no conversation here, none. */
function forwarderOf(caller: AgentCaller): ImageForwarder {
  return {
    userId: callerUserId(caller),
    conversationId: callerAgent(caller)?.conversationId,
  };
}

/**
 * Why a start's mode is refused for the model it runs on, or nothing where
 * that model's harness takes it: the mode named is never swapped for full
 * access, as the app's own Starts swap one a harness does not take.
 */
function startModeRefusal(
  model: string | undefined,
  mode: AgentPermissionMode,
  own: boolean,
): string | undefined {
  const provider = model === undefined ? undefined : providerOf(model);

  if (provider === undefined) return undefined;
  const runtime = runtimeOfProvider(provider);

  if (runtimeTakesMode(runtime, mode)) return undefined;
  const named = own ? `${mode}, your own, which a start leaving permissionMode out runs on` : mode;

  return (
    `Not started: ${model} runs on ${harnessNameOf(provider)}, which takes the permissionMode ` +
    `${modesOf(runtime).join(" or ")}, not ${named}. Name one of those, or start it on another model.`
  );
}

/**
 * Where the agent its row names runs, as `start_agent`'s runsOn names it: the
 * cloud, its starter's device, or its workspace's machine, each by its id;
 * none for one on a device or machine whose row is gone.
 */
export function agentRunsOnOf(
  agent: Pick<Agent, "machine" | "deviceId">,
): AgentRunsOnRequest | null {
  const machine = agent.machine ?? AGENT_MACHINE.VERCEL;

  if (machine === AGENT_MACHINE.VERCEL) return { machine };

  return agent.deviceId === null || agent.deviceId === undefined
    ? null
    : { machine, deviceId: agent.deviceId };
}

/** The task a start names by its id or key, read in the caller's workspace; or why it names none there. */
const startTaskNamed = (caller: AgentCaller, written: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);

    if (Option.isNone(workspace)) return Result.fail(START_AGENT_REFUSAL.NO_SUCH_TASK);

    return yield* taskIdOfInput(
      callerUserId(caller),
      workspace.value,
      { opening: "Not started", field: "taskId" },
      written,
    );
  });

/** Why a start's input asks for nothing that can start, read before anything is: a source with a prompt or a branch, or a coding agent continuing itself. */
function startInputRefusal(
  caller: AgentCaller,
  start: typeof START_AGENT_CALL.Type,
): string | undefined {
  const { from } = start;

  if (from === undefined) return undefined;

  if (start.prompt !== undefined || start.branch !== undefined) {
    return START_AGENT_REFUSAL.FROM_WITH_PROMPT;
  }

  const self = from.agentId === callerAgent(caller)?.id;

  return self && from.mode === START_FROM_MODE.CONTINUE
    ? START_AGENT_REFUSAL.SELF_CONTINUE
    : undefined;
}

/** What a start runs on: the model, mode, and place it names, or, left out, what it runs on instead. */
interface StartValues {
  readonly choice: ModelChoice | undefined;
  readonly permissionMode: AgentPermissionMode;
  readonly runsOn: typeof START_RUNS_ON.Type | undefined;
}

/**
 * The model and effort, permissionMode, and runsOn a start runs on, or why
 * it is refused. A coding agent's start that leaves one out runs on the
 * caller's own, which its instructions name, so the call never guesses:
 * its model and effort (left out together), its permission mode, and where
 * it runs; but a start from another agent runs on that agent's model and
 * where it runs, as the start reads them later, and takes only the mode.
 * The caller's place is refused where its device or machine is gone. A
 * member, who is no agent and has nothing of their own to run on, names
 * each one but what a start from another agent takes from it.
 */
function startValuesOf(
  calling: Agent | undefined,
  asked: typeof START_AGENT_CALL.Type,
  fromAgent: boolean,
): Result.Result<StartValues, string> {
  const named =
    asked.model !== undefined && asked.effort !== undefined
      ? { model: asked.model, effort: asked.effort }
      : undefined;

  if (calling === undefined) {
    if (!fromAgent && named === undefined) return Result.fail(START_AGENT_REFUSAL.NO_MODEL);

    if (asked.permissionMode === undefined) {
      return Result.fail(START_AGENT_REFUSAL.NO_PERMISSION_MODE);
    }

    if (!fromAgent && asked.runsOn === undefined) {
      return Result.fail(START_AGENT_REFUSAL.NO_RUNS_ON);
    }

    return Result.succeed({
      choice: named,
      permissionMode: asked.permissionMode,
      runsOn: asked.runsOn,
    });
  }

  const ownPlace = asked.runsOn !== undefined || fromAgent ? undefined : agentRunsOnOf(calling);

  if (ownPlace === null) return Result.fail(START_AGENT_REFUSAL.CALLER_PLACE_GONE);

  return Result.succeed({
    choice: named ?? (fromAgent ? undefined : { model: calling.model, effort: calling.effort }),
    permissionMode:
      asked.permissionMode ?? calling.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS,
    runsOn: asked.runsOn ?? ownPlace,
  });
}

/**
 * The place a start's runsOn names, as a start request names it: a device
 * named by its name is the starting member's own registered device of that
 * name, any case, by its id, and a workspace's machine named by its name is
 * one of that name the workspace the start lands in owns (`workspaceId`);
 * a name that matches none of those, or more than one, is refused with them
 * listed (`machineNameRefusal`). Note that only the member's own devices
 * and the workspace's own machines are read, so a teammate's device of that
 * name never matches and is never listed.
 */
const runsOnOfStart = Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
  runsOn: typeof START_RUNS_ON.Type | undefined,
): Effect.fn.Return<
  Result.Result<AgentRunsOnRequest | undefined, string>,
  StoreFailure,
  DatabaseServices
> {
  if (runsOn === undefined) return Result.succeed(undefined);

  if ("device" in runsOn) {
    const devices = yield* devicesSeenSince(userId, new Date(0));
    const matched = namedMachines(devices, runsOn.device);
    const [only] = matched;

    if (matched.length === 1 && only !== undefined) {
      return Result.succeed({ machine: AGENT_MACHINE.DEVICE, deviceId: only.id });
    }

    const now = yield* Clock.currentTimeMillis;

    return Result.fail(deviceNameRefusal(runsOn.device, matched.length, devices, now));
  }

  if ("name" in runsOn) {
    const machines = yield* workspaceOwnedMachinesOf(userId, workspaceId);
    const matched = namedMachines(machines, runsOn.name);
    const [only] = matched;

    if (matched.length === 1 && only !== undefined) {
      return Result.succeed({ machine: AGENT_MACHINE.WORKSPACE, deviceId: only.id });
    }

    const now = yield* Clock.currentTimeMillis;

    return Result.fail(workspaceMachineNameRefusal(runsOn.name, matched.length, machines, now));
  }

  return Result.succeed(runsOn);
});

/**
 * The account a start makes its agent under. A Manager's fresh start, where
 * its workspace has Managers act for whoever asked on, is the account of the
 * member whose line opened the Manager's turn under way (`turnAsker`), so
 * their payer, machines, skills, and GitHub identity carry the work and the
 * agent is theirs; a turn no member opened has no asker, and the Manager's
 * owner stands in. Every other start is the caller's own: a coding agent on
 * a task acts for its starter, and a start from another agent lands where
 * that agent stands, which the caller reads as itself.
 */
const startAccountOf = (caller: AgentCaller, from: AgentStartFrom | undefined) =>
  Effect.gen(function* () {
    const calling = callerAgent(caller);
    const owner = callerUserId(caller);

    if (calling?.kind !== AGENT_KIND.MANAGER || from !== undefined) return owner;

    if (!(yield* experimentOnIn(calling.organizationId, EXPERIMENT.MANAGER_ACTS_FOR_ASKER))) {
      return owner;
    }

    return yield* turnAsker({ userId: calling.userId, conversationId: calling.conversationId });
  });

/** Why a Manager's start for the member who asked was refused for want of a payer: none of theirs pays for the model, and the owner's never stands in for theirs. */
function askerCredentialWords(asker: string | undefined): string {
  const who = asker ?? "the member who asked";

  return (
    `Not started: an agent you start is ${who}'s, who asked for this turn, and no subscription or API key of theirs ` +
    `pays for that model, and ${PRODUCT_NAME}'s key pays for no agent. Start it on a model whose provider ` +
    `they connected, or tell them to connect one in Settings › Agents.`
  );
}

/**
 * One call of `start_agent`: an agent started under the call's own key on
 * the task its taskId names, the caller's own or another of its workspace,
 * or, from another agent, that agent's own task, which taskId must name; or
 * why nothing was started. A call naming no taskId, as the tool's earlier
 * words let it, is refused with what to name rather than started on the
 * caller's own task, and one naming a key the tool's earlier words taught
 * is refused with the key it meant (`RETIRED_START_KEYS`); one naming
 * neither taskId nor branch is refused naming both, so one retry names
 * them. A model and effort, a permission mode, or a runsOn the call leaves
 * out is the calling agent's own (`startValuesOf`), never the member's
 * default, newest agent, or last pick, and is checked as one named is: a
 * model no longer offered, or a mode the model's harness does not take, is
 * refused naming the field to pass, never run on full access. A Manager's
 * start may be made under the account of the member who asked
 * (`startAccountOf`), refused by name where none of theirs pays for its
 * model. Note that a start from another agent can take tens of seconds, a
 * copy of its work and a summary of its transcript among them, which the
 * call is let run: our MCP server's function runs a tool to the function's
 * own bound, and the copy and the summary each hold to their own timeouts
 * well inside it (`snapshot.ts`, `replay-summary.ts`).
 */
export function runStartAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const retired = isRecord(input)
    ? RETIRED_START_KEYS.find(({ key }) => input[key] !== undefined)
    : undefined;

  if (retired !== undefined) return Effect.succeed(agentToolRejected(retired.refusal));
  const asked = readStart(input);

  // A from that names no mode, or a mode without the fields it takes, is refused with both modes spelled out.
  if (isRecord(input) && input.from !== undefined && Result.isFailure(readStartFrom(input.from))) {
    return Effect.succeed(agentToolRejected(START_AGENT_REFUSAL.FROM_UNREADABLE));
  }

  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
  if (
    Result.isFailure(asked) ||
    (asked.success.model === undefined) !== (asked.success.effort === undefined)
  ) {
    return Effect.succeed(agentToolRejected(START_AGENT_REFUSAL.UNREADABLE));
  }

  const { taskId: taskRef } = asked.success;
  const from = startFromOf(asked.success.from);
  const calling = callerAgent(call.caller);

  // Note that a coding agent on no task has no taskId of its own to name, so it is told to make one; a branch it left out as well is named in the same refusal.
  if (taskRef === undefined) {
    const taskless = calling !== undefined && callerTask(call.caller) === null;
    const branchless = from === undefined && asked.success.branch === undefined;

    return Effect.succeed(
      agentToolRejected(
        taskless
          ? branchless
            ? START_AGENT_REFUSAL.NO_OWN_TASK_NOR_BRANCH
            : START_AGENT_REFUSAL.NO_OWN_TASK
          : branchless
            ? START_AGENT_REFUSAL.NO_TASK_NOR_BRANCH
            : START_AGENT_REFUSAL.NO_TASK,
      ),
    );
  }

  const values = startValuesOf(calling, asked.success, from !== undefined);

  if (Result.isFailure(values)) return Effect.succeed(agentToolRejected(values.failure));
  const { choice, permissionMode, runsOn: runsOnAsked } = values.success;
  const { caller, agentSessions } = call;
  const refused = startInputRefusal(caller, asked.success);

  if (refused !== undefined) return Effect.succeed(agentToolRejected(refused));
  const { prompt } = asked.success;
  const ownTask = callerTask(caller);
  const userId = callerUserId(caller);

  return orStoreRefusal(
    Effect.gen(function* () {
      const account = yield* startAccountOf(caller, from);
      // Another task, or another agent's, is started on only where it is of the caller's
      // own workspace; a call run again after its start landed answers what it made
      // (`startedBefore`), before its task's key is read again, which a renamed workspace no
      // longer reads, before a source is read, which its own continue has since stopped,
      // or the pictures it named, which may be gone since. A key is never the caller's own id.
      const elsewhere = from !== undefined || taskRef !== ownTask;

      if (elsewhere || asked.success.images !== undefined) {
        const before = yield* startedBefore(call, account);

        if (Option.isSome(before)) return before.value;
      }

      // A task named by its key is read in the caller's workspace alone.
      const named = yield* startTaskNamed(caller, taskRef);

      if (Result.isFailure(named)) return agentToolRejected(named.failure);
      const taskId = named.success;

      if (from === undefined && taskId !== ownTask) {
        const reached = yield* taskOfCallerWorkspace(caller, taskId);

        if (!reached) return agentToolRejected(START_AGENT_REFUSAL.NO_SUCH_TASK);
      }

      // A start from another agent is cloned where that agent's work stands, so only a fresh start names its branch.
      const branchless =
        from === undefined
          ? yield* branchNeededRefusal(caller, taskId, asked.success.branch, "Not started")
          : undefined;

      // Note that a call run again after its start landed answers what it made, even where its task has since gained a repository.
      if (branchless !== undefined) {
        const before = yield* startedBefore(call, account);

        return Option.isSome(before) ? before.value : agentToolRejected(branchless);
      }

      // A start from another agent lands in that agent's own place, its task.
      const landing = from === undefined ? undefined : yield* sourceLanding(caller, from, taskId);

      if (landing !== undefined && Result.isFailure(landing)) {
        return agentToolRejected(landing.failure);
      }

      // A mode the model's harness does not take is refused, never run on full access in its place.
      const modeRefused = startModeRefusal(
        choice?.model ?? landing?.success.model,
        permissionMode,
        asked.success.permissionMode === undefined,
      );

      if (modeRefused !== undefined) return agentToolRejected(modeRefused);

      // Note that a workspace with Task descriptions off has no description to hand a start, so every start but one from another agent names its prompt.
      if (
        landing === undefined &&
        prompt === undefined &&
        !(yield* experimentOnIn(callerWorkspaceId(caller), EXPERIMENT.DESCRIPTIONS))
      ) {
        return agentToolRejected(START_AGENT_REFUSAL.PROMPT_NEEDED);
      }

      // The pictures it is handed are read as the caller may read them, and refused whole where one is not.
      const images =
        asked.success.images === undefined
          ? Result.succeed([])
          : yield* forwardedImages(forwarderOf(caller), asked.success.images);

      if (Result.isFailure(images)) {
        return agentToolRejected(`Not started: ${forwardedImageRefusalWords(images.failure)}`);
      }

      const runsOn = yield* runsOnOfStart(account, callerWorkspaceId(caller), runsOnAsked);

      if (Result.isFailure(runsOn)) return agentToolRejected(runsOn.failure);
      const place: StartWhere = landing?.success.place ?? { taskId };
      // An agent a coding agent starts hears who started it, and that it reports back to it by message; one a member starts hears their note as the developer's.

      const note =
        calling === undefined ? asked.success.note : startedByNote(calling, asked.success.note);

      // The agent is made as the account it belongs to, whose sessions open it.
      const sessions = account === userId ? agentSessions : call.agentSessionsAs(account);

      const started = yield* startAgent(Effect.succeed(sessions), account, {
        ...place,
        idempotencyKey: call.clientKey,
        choice,
        prompt,
        note,
        attachments: images.success,
        title: asked.success.title,
        branch: asked.success.branch,
        from,
        runsOn: runsOn.success,
        permissionMode,
        summaryModel: call.summaryModel,
        byTool: true,
        ...(calling === undefined
          ? undefined
          : { noteHeading: START_NOTE_HEADING.AGENT, startedBy: calling }),
        // One that lands beside the caller, on its own task, belongs to the caller's run, if any;
        // one on another task is that task's. Note that the automation and its origin are not
        // handed on, because either would make it an automation's agent, which changes who it
        // commits as and how its start is counted.
        automationRunId:
          place.taskId === ownTask && calling !== undefined
            ? yield* runOfCaller(calling)
            : undefined,
      }).pipe(Effect.result);

      if (Result.isFailure(started)) {
        const refusal = started.failure;

        if (refusal instanceof ModelChoiceRefused) {
          // The choices are the models the start was checked against, so no second read can lose them.
          return agentToolRejected(
            asked.success.model === undefined && choice !== undefined
              ? ownChoiceRefusal(choice, refusal.offered)
              : choiceRefusal(choice, refusal.offered),
          );
        }

        // Note that a Manager's start for whoever asked is refused where they pay for nothing, never made the owner's instead.
        if (account !== userId && refusal.error === HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING) {
          const names = yield* readAccountNames([account]);

          return agentToolRejected(askerCredentialWords(names.get(account)));
        }

        return agentToolRejected(startFromRefusalWords(refusal, from));
      }

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: yield* startedReading(started.success.agent, yield* offeredModels, ownTask),
        ...earlierContinuations(landing?.success.continuedBy, started.success.agent.id),
      };
    }),
  );
}

/** Who an archive is by: the calling coding agent by its id and name, for the member the caller acts for, or the member calling, with the reason given. */
function archiverOf(caller: AgentCaller, reason: string | undefined): StoredArchive {
  const why = reason === undefined ? undefined : { reason };

  if (caller.kind === AGENT_CALLER.MEMBER) {
    return { by: AGENT_ARCHIVER.MEMBER, userId: caller.userId, ...why };
  }

  return {
    by: AGENT_ARCHIVER.AGENT,
    userId: caller.agent.userId,
    agentId: caller.agent.id,
    agentName: agentName(caller.agent),
    ...why,
  };
}

/**
 * A task's key, where it stands, how much it matters, and who it is assigned
 * to, as every task tool answers them: its key drawn from its workspace's
 * name as the member reads it (`workspace-key.ts`), and its assignee by their
 * mention link under the workspace's step (`task-assignee.ts`); null for any
 * a service before them left out, and for a task no one is assigned to.
 */
export function taskStandingOf(
  task: Pick<TaskSummary, "number" | "status" | "priority" | "assignee">,
  naming: { readonly step: string; readonly name: string },
) {
  return {
    key: task.number === undefined ? null : taskKey(naming.name, task.number),
    status: task.status ?? null,
    priority: task.priority ?? null,
    assignee: assigneeMentionOf(task, naming.step),
  };
}

/** What a task's answer says beside the task: whether every change named already stood, the section it was placed in, whether the call named its parent, and whether it named its blocks. */
interface TaskUpdateAnswered {
  readonly already: boolean;
  readonly section: TaskSectionReading | null | undefined;
  readonly parentNamed: boolean;
  readonly blocksNamed: boolean;
}

/** A task's change as the model reads it: the task as it now stands, its parent and its blocks where the call named them, and whether every change named already stood before the call. */
export const taskUpdateAnswer = (
  userId: string,
  task: StoredTask["task"],
  { already, section, parentNamed, blocksNamed }: TaskUpdateAnswered,
) =>
  Effect.gen(function* () {
    const { step, name } = yield* workspaceNamingOf(userId, task.workspaceId);
    const blocks = blocksNamed ? yield* taskBlockReadingsNow(userId, task.id) : undefined;

    const answer: WireRecord = {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      task: {
        id: task.id,
        ...taskStandingOf(task, { step, name }),
        name: task.name,
        repository: task.repository,
        pinned: task.pinnedAt !== undefined,
        ...(section === undefined
          ? undefined
          : { section: section === null ? null : { ...section } }),
        ...(parentNamed ? { parentTaskId: task.parentTaskId ?? null } : undefined),
        ...blocks,
      },
      already,
    };

    return answer;
  });

/** A sidebar section as an answer names it. */
interface TaskSectionReading {
  readonly id: string;
  readonly title: string;
}

/**
 * Where a task is asked to stand in its member's sidebar, read before
 * anything is written: the section of the caller's workspace named, none for
 * null, the refusal's words for a section of no workspace of the caller's,
 * and whether the task already stands there.
 */
const sectionAsked = (
  userId: string,
  workspaceId: string,
  taskId: string,
  sectionId: string | null,
) =>
  Effect.map(listTaskSections(userId), (kept) => {
    const section =
      sectionId === null
        ? null
        : kept.sections.find((each) => each.id === sectionId && each.workspaceId === workspaceId);

    if (section === undefined) return Result.fail(UPDATE_TASK_REFUSAL.NO_SECTION);
    const standing = kept.entries.find((entry) => entry.taskId === taskId)?.sectionId ?? null;

    return Result.succeed({
      section: section === null ? null : { id: section.id, title: section.title },
      stands: standing === sectionId,
    });
  });

/**
 * Whether every change named already stands on the task as its member reads
 * it. Note that a repository confirmed again stands only where it is reached
 * as the task records it, because the write records the access it was reached
 * through.
 */
function changesStand(stored: StoredTask, changes: TaskChanges): boolean {
  const { task } = stored;

  return (
    (changes.name === undefined || changes.name === task.name) &&
    (changes.repository === undefined || changes.repository === task.repository) &&
    (changes.githubAccess === undefined || changes.githubAccess === stored.githubAccess) &&
    (changes.pinned === undefined || changes.pinned === (task.pinnedAt !== undefined)) &&
    (changes.status === undefined || changes.status === task.status) &&
    (changes.priority === undefined || changes.priority === task.priority) &&
    (changes.assigneeId === undefined || changes.assigneeId === (task.assignee?.userId ?? null))
  );
}

/** A repository's refusal in the model's words: one the installation does not reach, GitHub not answering, or else the service down. */
export function repositoryRefusalWords(refusal: HostedRefusal): string {
  if (refusal.error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) {
    return UPDATE_TASK_REFUSAL.NOT_REACHABLE;
  }

  return refusal.error === HOSTED_API_ERROR.GITHUB_UNANSWERED
    ? UPDATE_TASK_REFUSAL.GITHUB_UNANSWERED
    : AGENT_TOOL_REFUSAL.STORE;
}

/** A change's refusal in the model's words (`taskChangeAsked`, `taskChangeWritten`): a task gone, an assignee who is no member, a repository its tree holds, or the repository's own. */
function changeRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return UPDATE_TASK_REFUSAL.NO_TASK;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return UPDATE_TASK_REFUSAL.NOT_MEMBER;
    case HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED:
      return UPDATE_TASK_REFUSAL.TREE_REPOSITORY;
    default:
      return repositoryRefusalWords(refusal);
  }
}

/**
 * One call of `update_task`: a task of the caller's workspace changed as the
 * app's menu changes it (`tasks/task-change.ts`), for the member the caller
 * acts for, with its place in the sidebar, its parent, and its blocks in the
 * same transaction, or why not. Note that the task is read first, on that
 * member's standing, both to hold it to the caller's workspace and to tell a
 * change already standing; and that a move to Done archives the task's idle
 * agents as the caller, which, still answering whoever asked, is never one.
 */
export function runUpdateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readTaskUpdate(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  }

  const {
    taskId: taskRef,
    sectionId,
    assignee,
    archived,
    parentTaskId: parentRef,
    blockedBy,
    blocks,
    ...named
  } = asked.success;

  if (archived !== undefined) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.ARCHIVED));
  }

  const blockChanges = { ...(blockedBy && { blockedBy }), ...(blocks && { blocks }) };

  const assigneeId =
    assignee === undefined ? undefined : assignee === null ? null : assigneeIdOf(assignee);

  if (assignee !== undefined && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.NOT_MEMBER));
  }

  const changes = assigneeId === undefined ? named : { ...named, assigneeId };

  if (
    Object.keys(changes).length === 0 &&
    sectionId === undefined &&
    parentRef === undefined &&
    !blockChangesNamed(blockChanges)
  ) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  }

  const { caller } = call;

  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(caller);
      const workspace = yield* callerWorkspace(caller);

      if (Option.isNone(workspace)) return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);

      // The task and its parent may each be named by a key, read in the caller's workspace alone.
      const taskNamed = yield* taskIdOfInput(userId, workspace.value, UPDATE_TASK_ID, taskRef);

      if (Result.isFailure(taskNamed)) return agentToolRejected(taskNamed.failure);
      const taskId = taskNamed.success;

      const parentNamed = Predicate.isString(parentRef)
        ? yield* taskIdOfInput(userId, workspace.value, UPDATE_TASK_PARENT, parentRef)
        : Result.succeed(parentRef);

      if (Result.isFailure(parentNamed)) return agentToolRejected(parentNamed.failure);
      const parentTaskId = parentNamed.success;
      const read = yield* readTask(userId, taskId);

      if (Option.isNone(read) || read.value.task.workspaceId !== workspace.value) {
        return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);
      }

      // Where it is asked to stand in the sidebar is read before anything is written.
      const placing =
        sectionId === undefined
          ? undefined
          : yield* sectionAsked(userId, workspace.value, taskId, sectionId);

      if (placing !== undefined && Result.isFailure(placing)) {
        return agentToolRejected(placing.failure);
      }

      // So are the tasks its blocks name, each held to the workspace as the task itself is.
      const blocking = blockChangesNamed(blockChanges)
        ? yield* blockWritesAsked(userId, workspace.value, taskId, blockChanges)
        : undefined;

      if (blocking !== undefined && Result.isFailure(blocking)) {
        return agentToolRejected(blocking.failure);
      }

      // The change itself is confirmed as the app's is (`taskChangeAsked`).
      // Note that a move into progress assigns no one, because only `assignee` changes who is on the task.
      const confirmed =
        Object.keys(changes).length === 0
          ? undefined
          : yield* Effect.result(
              taskChangeAsked(userId, taskId, { ...changes, assignsMover: false }),
            );

      if (confirmed !== undefined && Result.isFailure(confirmed)) {
        return agentToolRejected(changeRefusalWords(confirmed.failure));
      }

      const stands =
        changesStand(read.value, confirmed?.success.changes ?? {}) &&
        (placing?.success.stands ?? true);

      // The tasks the blocks name, and the parent, are locked before the task's change, so the change takes no lock first that another call's writes wait on.
      const locking = [
        ...(blocking === undefined ? [] : tasksOfWrites(blocking.success)),
        ...(Predicate.isString(parentTaskId) ? [taskId, parentTaskId] : []),
      ];

      // The task's change, its place in the sidebar, its parent, and its blocks are one transaction, so a place
      // refused, its section deleted meanwhile, a parent refused, or a block refused takes the change back with it.
      const writing = Effect.gen(function* () {
        if (locking.length > 0) yield* lockTasksForBlocks(userId, locking);

        const updated =
          confirmed === undefined
            ? undefined
            : yield* taskChangeWritten(
                userId,
                taskId,
                confirmed.success,
                archiverOf(caller, undefined),
              ).pipe(
                Effect.mapError(
                  (refusal) => new TaskChangeRefused({ words: changeRefusalWords(refusal) }),
                ),
              );

        if (updated !== undefined && Option.isNone(updated)) {
          return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_TASK });
        }

        if (placing !== undefined && !placing.success.stands) {
          // The sidebar's own write puts it in the section named, or in none, as the developer's drag does.
          const placed = yield* writeTaskSections(userId, {
            kind: TASK_SECTION_WRITE.PLACE,
            taskId,
            sectionId: placing.success.section?.id ?? null,
          });

          if (Option.isNone(placed)) {
            return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_SECTION });
          }
        }

        // The parent is written under the store's own rules, and the task answered as it then stands.
        const parented =
          parentTaskId === undefined
            ? undefined
            : yield* setTaskParent(userId, taskId, parentTaskId);

        if (parented !== undefined && Option.isNone(parented)) {
          return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_TASK });
        }

        const blocksChanged =
          blocking === undefined ? false : yield* writeTaskBlocks(userId, blocking.success);

        return {
          updated: updated?.value,
          task: parented?.value.task ?? updated?.value.task ?? read.value.task,
          parentChanged: parented?.value.txid !== undefined,
          blocksChanged,
        };
      });

      const changed = yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
        client.withTransaction(writing),
      ).pipe(
        Effect.map((written) => Result.succeed(written)),
        Effect.catchTags({
          TaskChangeRefused: ({ words }) => Effect.succeed(Result.fail(words)),
          TaskBlockRefused: ({ words }) => Effect.succeed(Result.fail(words)),
          TaskParentUnreached: () => Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.NO_PARENT)),
          TaskParentRepositoryDiffers: () =>
            Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.PARENT_REPOSITORY)),
          TaskParentCycle: () => Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.PARENT_CYCLE)),
        }),
      );

      if (Result.isFailure(changed)) return agentToolRejected(changed.failure);
      const { updated, task, parentChanged, blocksChanged } = changed.success;

      // The agents its Done archived are let go of once it commits, and a finish counted, as the app's change does.
      if (updated !== undefined)
        yield* taskChangeSettled(deploymentSandboxDeletes, userId, updated);

      return yield* taskUpdateAnswer(userId, task, {
        already: stands && !parentChanged && !blocksChanged,
        section: placing?.success.section,
        parentNamed: parentTaskId !== undefined,
        blocksNamed: blocking !== undefined,
      });
    }),
  );
}

/** A stop's refusal in the model's words, naming the agent's starter where only they may stop it: an agent gone meanwhile is none, and anything else is the service down. */
const stopRefusalWords = (refusal: HostedRefusal, agent: Agent) =>
  Effect.gen(function* () {
    if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;

    if (refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
      return `Not stopped: ${yield* agentStarterName(agent)}'s own subscription pays for that agent, so only they and their agents can stop it.`;
    }

    if (refusal.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE) {
      return STOP_AGENT_REFUSAL.NATIVE_NOT_HERE;
    }

    return STOP_AGENT_REFUSAL.UNAVAILABLE;
  });

/** Whether a Stop already stands on the turn, which is still ending. */
function stopStands(turn: AgentLatestTurn | undefined): boolean {
  return (
    turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) && turn.cancelRequestedAt !== null
  );
}

/**
 * The agent stopped by the Stop every surface makes (`stoppedAgent`) under
 * the call's key, and where it stands: whether it was stopped, by this call
 * now or when it first ran, by the harness taking its cancel, or by a Stop already
 * standing on the turn it stood on as the call began and still stands on,
 * and its status read after. A call run again finds the turn it stopped by
 * its key and cancels nothing, so a turn begun since, by a message the agent
 * took meanwhile, runs on.
 */
const stopOf = (call: AgentCall, agent: Agent) =>
  Effect.gen(function* () {
    const { caller, clientKey: key } = call;

    const earlier = yield* hostedStoreOrUnavailable(
      turnStoppedUnderReached(agent.conversationId, key),
    );

    const before = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    // A member's Stop names no agent that made it, as the developer's names none.
    const by = callerAgent(caller)?.id;

    const canceled = earlier
      ? false
      : yield* stoppedAgent(call.writer, callerUserId(caller), agent, {
          key,
          ...(by === undefined ? undefined : { by }),
        });

    const after = (yield* turnStandingsOf([agent.conversationId], [agent]))(agent.conversationId);

    const status = agentStatusOf(after.turn, {
      createdAt: agent.createdAt,
      now: yield* Clock.currentTimeMillis,
      blank: startedBlank(agent),
      boot: after.boot,
    });

    const standing = stopStands(before.turn) && after.turn?.id === before.turn?.id;

    return { stopped: earlier || canceled || standing, status };
  });

/** One call of `stop_agent`: the turn under way of an agent of the caller's workspace stopped as the app's Stop stops it, an idle one answered as idle, or why nothing was stopped. */
export function runStopAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentRef(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.UNREADABLE));
  }

  const { agentId } = asked.success;
  const { caller } = call;

  if (agentId === callerAgent(caller)?.id) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.SELF));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      const stop = yield* Effect.result(stopOf(call, agent));

      if (Result.isFailure(stop)) {
        return agentToolRejected(yield* stopRefusalWords(stop.failure, agent));
      }

      // Note that a Stop already standing on a turn still ending is this call's own run again, or
      // the developer's, and is answered as stopped so a call run again reads as it first did.
      const { stopped, status } = stop.success;

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          title: agent.title ?? agent.model,
          task: task.task === null ? null : { ...task.task },
          onYourTask: task.onYourTask,
          status,
        },
        stopped,
      };
    }),
  );
}

/** A task's change refused inside its transaction, its words for the model: its section or its parent gone meanwhile, or the change refused under the row's lock, which takes every change back. */
class TaskChangeRefused extends Data.TaggedError("TaskChangeRefused")<{ readonly words: string }> {}

/** An archive's refusal in the model's words, naming the agent's starter where only they may stop it: an agent gone meanwhile is none, and anything else is the service down. */
const archiveRefusalWords = (refusal: HostedRefusal, agent: Agent) =>
  Effect.gen(function* () {
    if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;

    if (refusal.error === HOSTED_API_ERROR.AGENT_NOT_READY) return ARCHIVE_AGENT_REFUSAL.NOT_READY;

    if (refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
      return `Not archived: ${yield* agentStarterName(agent)}'s own subscription pays for that agent, so only they and their agents can stop and archive it.`;
    }

    if (refusal.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE) {
      return ARCHIVE_AGENT_REFUSAL.NATIVE_NOT_HERE;
    }

    return ARCHIVE_AGENT_REFUSAL.UNAVAILABLE;
  });

/** An agent as an archive or a bring-back answers it: whether it now stands archived among it. */
function archiveAnswer(agent: Agent, task: AgentTaskReading): WireRecord {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agent.id,
      title: agent.title ?? agent.model,
      task: task.task === null ? null : { ...task.task },
      onYourTask: task.onYourTask,
      archived: agent.archivedAt !== null,
    },
  };
}

/** An agent of the caller's workspace archived or brought back by the one operation the app's menu runs (`agent-change.ts`), as the caller, for `reason` on an archive. */
const archiveOrBringBack = (
  call: AgentCall,
  agentId: string,
  archived: boolean,
  reason: string | undefined,
) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const { caller } = call;
      const found = yield* workspaceAgentOf(caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;

      const written = yield* Effect.result(
        archivedAgent(
          deploymentSandboxDeletes,
          call.writer,
          callerUserId(caller),
          agent,
          archived,
          archiverOf(caller, reason),
        ),
      );

      if (Result.isFailure(written)) {
        return agentToolRejected(yield* archiveRefusalWords(written.failure, agent));
      }

      if (Option.isNone(written.success)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);

      return archiveAnswer(written.success.value.agent, task);
    }),
  );

/**
 * One call of `archive_agent`: an agent of the caller's workspace archived
 * as the app's menu archives it, a turn still under way stopped first as
 * its Stop would, refused for the caller itself and for one whose turn is
 * still coming up; an archive already standing is answered as it stands,
 * its first record kept.
 */
export function runArchiveAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readArchiveAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.UNREADABLE));
  }

  const { agentId, reason } = asked.success;

  if (agentId === callerAgent(call.caller)?.id) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.SELF));
  }

  return archiveOrBringBack(call, agentId, true, reason);
}

/** One call of `unarchive_agent`: an agent of the caller's workspace brought back, its archive's record cleared, one standing unarchived answered as it stands. */
export function runUnarchiveAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentRef(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.UNREADABLE_UNARCHIVE));
  }

  return archiveOrBringBack(call, asked.success.agentId, false, undefined);
}

/**
 * One call of `update_agent`: an agent of the caller's workspace renamed,
 * moved to another choice the catalog takes, pinned or unpinned for the
 * caller's member, or given another list of servers switched off, by the
 * one operation the app's menu runs (`agent-change.ts`). A choice is
 * checked before anything is written, so one refused changes nothing, and
 * every change asked is written in one transaction, so none stands where
 * another failed.
 */
export function runUpdateAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readUpdateAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_AGENT_REFUSAL.UNREADABLE));
  }

  const { agentId, title, model, effort, contextWindow, pinned, disabledServers } = asked.success;
  const { caller } = call;
  const userId = callerUserId(caller);

  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { task } = found.value;
      const choices = yield* Effect.result(accountModelChoices(userId));

      if (Result.isFailure(choices)) return agentToolRejected(UPDATE_AGENT_REFUSAL.UNAVAILABLE);
      const { offered } = choices.success;

      const asked =
        model === undefined || effort === undefined
          ? undefined
          : { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) };

      // A provider's own harness takes only what it runs (`agent-runtime-models.ts`).
      const route = asked === undefined ? undefined : yield* agentRouteOf(found.value.agent);
      const runtime = route?.runtime;

      const refused =
        asked === undefined ? undefined : runtimeChoiceRefusal(runtime, asked, route?.payer);

      if (refused !== undefined) {
        return agentToolRejected(
          `${UPDATE_CHOICE_LEAD}: ${runtimeChoiceRefusalWords(runtime, refused)}`,
        );
      }

      const accepted = asked === undefined ? undefined : validateModelChoice(offered, asked);

      if (asked !== undefined && accepted !== undefined && Result.isFailure(accepted)) {
        return agentToolRejected(choiceRefusal(asked, offered, UPDATE_CHOICE_LEAD));
      }

      const windowRefused =
        asked === undefined
          ? undefined
          : contextWindowRefusal(asked, runtimeModels(offered, runtime, route?.payer));

      if (windowRefused !== undefined) {
        return agentToolRejected(`${UPDATE_CHOICE_LEAD}: ${windowRefused}`);
      }

      // The catalog's own reading of the choice is written, a window the model does not offer apart dropped.
      const choice = accepted === undefined ? undefined : Result.getOrUndefined(accepted);

      const written = yield* changedAgent(userId, found.value.agent, {
        title,
        choice,
        pinned,
        disabledServers,
      });

      if (Option.isNone(written)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent } = written.value;

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          title: agent.title ?? agent.model,
          model: agent.model,
          modelName: modelLabel(agent.model, offered),
          effort: agent.effort,
          contextWindow: agent.contextWindow,
          disabledServers: [...agent.disabledServers],
          task: task.task === null ? null : { ...task.task },
          onYourTask: task.onYourTask,
          archived: agent.archivedAt !== null,
          ...(pinned === undefined ? undefined : { pinned }),
        },
      };
    }),
  );
}

/** One call of `list_tasks`: the open tasks of the caller's workspace, and the archived ones too where asked, newest first, each with the section its member keeps it in, and those sections. */
export function runListTasks(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const asked = readTasksAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TASKS));
  }

  const words = asked.success.nameContains?.toLowerCase();
  const offset = asked.success.offset ?? 0;
  const assigned = asked.success.assignee;

  // The tasks of one member, or with null of no one; a link that names no person names no one's tasks.
  const assigneeId =
    assigned === undefined || assigned === null ? assigned : assigneeIdOf(assigned);

  if (assigned !== undefined && assigned !== null && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TASKS));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);

      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }

      const ownTask = callerTask(caller);
      const userId = callerUserId(caller);
      const listed = yield* listTasks(userId);

      const matching = listed.filter(
        (task) =>
          task.workspaceId === workspace.value &&
          (words === undefined || task.name.toLowerCase().includes(words)) &&
          (asked.success.status === undefined || task.status === asked.success.status) &&
          (assigned === undefined || (task.assignee?.userId ?? null) === assigneeId),
      );

      const kept = yield* listTaskSections(userId);
      const sections = kept.sections.filter((section) => section.workspaceId === workspace.value);
      const shelved = new Set(sections.map((section) => section.id));

      const sectionOf = new Map(
        kept.entries
          .filter((entry) => shelved.has(entry.sectionId))
          .map((entry) => [entry.taskId, entry.sectionId]),
      );

      const { step, name } = yield* workspaceNamingOf(userId, workspace.value);
      const page = matching.slice(offset, offset + TASKS_LIST_LIMIT);

      const followers = yield* followerReadingsOf(
        userId,
        page.map((task) => task.id),
      );

      const tasks = page.map((task) => ({
        id: task.id,
        ...taskStandingOf(task, { step, name }),
        name: task.name,
        repository: task.repository ?? null,
        startedBy: task.createdBy?.name ?? null,
        isYourTask: task.id === ownTask,
        sectionId: sectionOf.get(task.id) ?? null,
        followers: (followers.get(task.id) ?? []).map((follower) => ({ ...follower })),
      }));

      const next = offset + TASKS_LIST_LIMIT;

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        tasks,
        nextOffset: next < matching.length ? next : null,
        sections: sections.map((section) => ({ id: section.id, title: section.title })),
      };
    }),
  );
}

/**
 * The context windows a choice of a model takes, as `list_models` answers
 * them: the standard and the long, each with its size in tokens and the
 * long one with what it costs past the standard where the catalog prices
 * it, for a model that offers two; none for one that runs on one window,
 * or on a runtime that takes no choice of it.
 */
const contextWindowsListed = (windows: ContextWindows | undefined) =>
  windows === undefined
    ? []
    : [
        { window: CONTEXT_WINDOW.STANDARD, tokens: windows.standardTokens },
        {
          window: CONTEXT_WINDOW.LONG,
          tokens: windows.longTokens,
          ...(windows.longInputPriceFactor === undefined
            ? undefined
            : { inputPriceFactor: windows.longInputPriceFactor }),
          ...(windows.longOutputPriceFactor === undefined
            ? undefined
            : { outputPriceFactor: windows.longOutputPriceFactor }),
        },
      ];

/** The models the member is offered, narrowed to what the agent's route runs where one is named, with the member's default and whether it is among them. */
const modelsListed = (userId: string, route: NativeRoute | undefined) =>
  Effect.gen(function* () {
    const read = yield* Effect.result(accountModelPayers(userId));

    if (Result.isFailure(read)) return agentToolRejected(LIST_MODELS_REFUSAL.UNAVAILABLE);
    const { choices, payers } = read.success;
    const { offered, defaultChoice } = choices;
    const listed = runtimeModels(offered, route?.runtime, route?.payer);

    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      models: listed.map((model) => ({
        id: model.id,
        name: modelLabel(model.id, offered),
        efforts: [...model.efforts],
        contextWindows: contextWindowsListed(model.contextWindows),
        // Note that a payer is named by its kind alone, never which credential or anything of it.
        payers: [...(payers.get(model.provider) ?? [])],
      })),
      default: {
        model: defaultChoice.model,
        modelName: modelLabel(defaultChoice.model, offered),
        effort: defaultChoice.effort,
        // The window the default runs on, where its model offers a choice of two among those listed.
        contextWindow:
          contextWindowsOf(listed, defaultChoice.model) === undefined
            ? null
            : windowOf(listed, defaultChoice),
        // Whether the default is among the models listed: for the agent named, one it may move to.
        offered: Result.isSuccess(validateModelChoice(listed, defaultChoice)),
      },
    };
  });

/**
 * One call of `list_models`: the models the caller's member may start an
 * agent on, each by its catalog id, the name to say it by, its efforts, and
 * the context windows a choice of it takes, and the kinds of credential that
 * may pay for it, and the member's default choice,
 * the window it runs on, and whether it is still offered, read from
 * the one source a start is checked against (`accountModelChoices`), so a
 * choice listed is one `start_agent` takes. It names nothing of the call's.
 */
export function runListModels(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readListModelsAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(LIST_MODELS_REFUSAL.UNREADABLE));
  }

  const { agentId } = asked.success;
  const { caller } = call;

  return orStoreRefusal(
    Effect.gen(function* () {
      // The agent named, whose runtime narrows the list to what it may move to.
      let route: NativeRoute | undefined;

      if (agentId !== undefined) {
        const found = yield* workspaceAgentOf(caller, agentId);

        if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
        route = yield* agentRouteOf(found.value.agent);
      }

      return yield* modelsListed(callerUserId(caller), route);
    }),
  );
}

/** The models a member may start an agent on, as `list_models` names them with no agent named, for a caller that names no workspace: the models are the member's own, in every workspace alike. */
export function runListMemberModels(
  userId: string,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  return orStoreRefusal(modelsListed(userId, undefined));
}

/** A page's HTML as a read answers it, and how many characters of it were left out. */
interface PageCut {
  readonly html: string;
  readonly leftOutChars: number;
}

/** A text as a read answers it, cut to a bound, and how many characters of it were left out. */
export interface TextCut {
  readonly text: string;
  readonly leftOutChars: number;
}

/** A text cut on a line to a bound, and how many characters were left out; whole where it fits. */
export function cutOnLine(text: string, maximumChars: number): TextCut {
  if (text.length <= maximumChars) return { text, leftOutChars: 0 };
  const lineEnd = text.lastIndexOf("\n", maximumChars);
  const kept = text.slice(0, lineEnd > 0 ? lineEnd : maximumChars);

  return { text: kept, leftOutChars: text.length - kept.length };
}

/** A page's HTML cut on a line to the read's bound, and how many characters were left out; whole where it fits. */
function pageCut(html: string): PageCut {
  const cut = cutOnLine(html, READ_PAGE_CHARS);

  return { html: cut.text, leftOutChars: cut.leftOutChars };
}

/**
 * What a page read says it stands on, where that is of the caller's
 * workspace: its task, by name, and whether it is the caller's own; nothing
 * for a task of another workspace.
 */
interface PageStanding {
  readonly task: { readonly id: string; readonly name: string | null };
  readonly isYourTask: boolean;
}

const pageStandingOf = (caller: AgentCaller, taskId: string) =>
  Effect.gen(function* () {
    if (!(yield* taskOfCallerWorkspace(caller, taskId))) return Option.none<PageStanding>();
    const names = yield* taskNamesOf(callerUserId(caller), [taskId]);

    return Option.some<PageStanding>({
      task: { id: taskId, name: names.get(taskId)?.name ?? null },
      isYourTask: taskId === callerTask(caller),
    });
  });

/** One call of `read_page`: a version of a page on a task of the caller's workspace, its HTML cut to the bound, or why there is none. */
export function runReadPage(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readPageAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_PAGE_REFUSAL.UNREADABLE));
  }

  const { caller } = call;

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);

      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }

      const userId = callerUserId(caller);
      const { pageId, version } = asked.success;

      const found = yield* readPageById(
        userId,
        pageId,
        version === READ_PAGE_VERSION.NEWEST ? undefined : version,
      );

      if (Option.isNone(found)) return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      const { taskId, page, newestVersion } = found.value;
      // A page of another workspace, even one the member is also in, is none of the caller's.
      const standing = yield* pageStandingOf(caller, taskId);

      if (Option.isNone(standing)) return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      const cut = pageCut(page.html);

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        page: {
          id: page.id,
          title: page.title,
          version: page.version,
          newestVersion,
          ...standing.value,
          html: cut.html,
          leftOutChars: cut.leftOutChars,
        },
      };
    }),
  );
}
