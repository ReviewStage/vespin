/**
 * tools.ts -- the tools the member MCP server offers an outside agent acting for a member: each by its name, what it tells the agent, its input, and the effect it runs.
 *
 * A tool is declared once here and registered with the SDK by `server.ts`,
 * which runs its effect through the one promise door. Its input is a wire
 * schema: the node a model is shown is wire's own emission, recorded as a
 * golden under `fixtures/json-schema/member-mcp/`, and the SDK is handed the
 * same declaration as a Standard Schema (`standardSchemaOf`), so a call's
 * arguments are checked against what the model was shown. Its annotations
 * tell the client what the tool does to the member's world, a read touching
 * nothing. Its effect reads the admitted member from the `AdmittedMember`
 * service (`admission.ts`) and answers the tool's result, which the agent
 * reads as JSON text; a refusal is answered as the tool's own error in the
 * refusal's words; a store it could not read fails the effect, which the
 * door answers as the tool's own error in fixed words.
 *
 * The reads of the workspace's tasks, agents, pages, and models run the
 * agent tools' own implementations (`../agents/agent-tools.ts`,
 * `../agents/task-tools.ts`), the coding agents' reads, with the member as
 * the caller (`AGENT_CALLER.MEMBER`): every task, agent, and page is read on
 * the member's own standing, so what the member could not open in the
 * window, a workspace they are not in among it, is none. Each is told to
 * the agent in words of its own, for one acting for the member, on input
 * declared from the agents' own fields where their words hold for it. A
 * call is about one workspace: a list, a create, or a workspace's own
 * setting names it by its slug, which is never guessed, the member's only
 * workspace included, and is refused, naming the member's workspaces, where
 * the slug names none of theirs; a read of one task, agent, or page by its
 * id is about the workspace that holds it, as the member reaches it.
 *
 * A change to an agent's pull request, `agent_pull_request_action`, makes
 * what the agent's Pull request tab makes, through the operation the tab's
 * procedure runs (`../agents/agent-pull-request-procedures.ts`), on the
 * member's own GitHub sign-in as the tab does, never the App's.
 *
 * To add a tool, name it in `MEMBER_MCP_TOOL`, declare it with
 * `memberMcpTool`, and list it in `MEMBER_MCP_TOOLS`; its golden is settled
 * by `app.test.ts`, and `coverage.ts` refuses to build until it names the
 * hosted procedures that do what the tool does, and the CLI's
 * `mcp-parity.ts` until it names the `vespin` command that does it.
 */

import { randomUUID } from "node:crypto";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { readAutomation } from "@repo/database/models/automation-store";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  type DescriptionCommentOutcome,
  type DescriptionCommentWriterRef,
  readDescriptionCommentThread,
  startDescriptionCommentThread,
} from "@repo/database/models/description-comments";
import { listRevisions, readRevision } from "@repo/database/models/description-revisions";
import { githubConnection } from "@repo/database/models/github-connection-store";
import { readPageById } from "@repo/database/models/task-pages";
import { listTaskSections } from "@repo/database/models/task-section-store";
import { readTask, readTaskWorkspace } from "@repo/database/models/task-store";
import { listWorkspaces } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import type { AgentBrowserTab } from "@repo/features/agent-browser-tab-wire";
import { AGENT_QUEUE_BOUNDS } from "@repo/features/agent-queue-wire";
import { RETIRED_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_BOUNDS,
  AGENT_MACHINE,
  AGENT_STATUS,
  agentRewindRequestSchema,
  contextWindowSchema,
  disabledServersSchema,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { automationCreateRequestSchema } from "@repo/features/automation-wire";
import { cliTaskRefOf } from "@repo/features/cli-task-ref";
import { dateTimeSchema } from "@repo/features/date-mention";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  descriptionCommentWordsSchema,
} from "@repo/features/description-comment-wire";
import { descriptionNotesSchema, locatedPhrase } from "@repo/features/description-notes";
import {
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
} from "@repo/features/github-repositories-wire";
import {
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_REPLY,
  INBOX_STATUS,
  inboxAnswersSchema,
  inboxStartRequestSchema,
} from "@repo/features/inbox-wire";
import {
  installedSkillInstallRequestSchema,
  SKILL_PASTE_KIND,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
  type InstalledSkillRefusal,
} from "@repo/features/installed-skill-wire";
import {
  integrationConnectionNameSchema,
  integrationConnectionOf,
  integrationProviderSchema,
  integrationRenameRequestSchema,
} from "@repo/features/integration-wire";
import { MCP_ACCESS_TOKEN_MINUTES, mcpClientIdSchema } from "@repo/features/mcp-client-wire";
import { MEMBER_MCP_TOOL, type MemberMcpToolName } from "@repo/features/member-mcp-tool";
import { MEMORY_BOUNDS, memoryIdSchema } from "@repo/features/memory-wire";
import { contextWindowsOf } from "@repo/features/model-effort";
import { agentName } from "@repo/features/model-label";
import {
  type ContextWindows,
  type ModelProvider,
  modelChoiceSchema,
} from "@repo/features/models-wire";
import { READ_PAGE_VERSION } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { modelApiProviderSchema } from "@repo/features/provider-key-wire";
import {
  PULL_REQUEST_CHAPTERS_STATE,
  type PullRequestChaptersAnswer,
} from "@repo/features/pull-request-chapters-wire";
import {
  agentPullRequestActionRequestSchema,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestWriteAnswer,
} from "@repo/features/pull-request-write-wire";
import { workspaceSentryDisconnectRequestSchema } from "@repo/features/sentry-install-wire";
import {
  type WorkspaceSlackBot,
  workspaceSlackBotChannelRequestSchema,
} from "@repo/features/slack-bot-wire";
import {
  CODE_PATH_MAX_CHARS,
  codeLineSchema,
  DESCRIPTION_HISTORY_BOUNDS,
  type DescriptionRevisionLine,
  descriptionRevisionSeqSchema,
  REPOSITORY_PIN_BOUNDS,
  type RepositoryPin,
  repositoryPinRequestSchema,
  TASK_FILE_BOUNDS,
  TASK_FILE_REFUSAL,
  TASK_STATUS,
  TASK_TREE_BOUNDS,
  type TaskFileAnswer,
  type TaskFileRefusal,
  type TaskTreeAnswer,
} from "@repo/features/task-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  type WorkspaceEnvironmentAnswer,
  workspaceVariableNameSchema,
  workspaceVariablePutRequestSchema,
} from "@repo/features/workspace-environment-wire";
import {
  workspaceInvitationCancelSchema,
  workspaceInviteRequestSchema,
} from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
  type WorkspaceRunActionEdit,
  type WorkspaceSandboxSetupAnswer,
  workspaceInstallScriptPutRequestSchema,
  workspaceRunActionEditRequestSchema,
} from "@repo/features/workspace-sandbox-setup-wire";
import {
  WORKSPACE_BOUNDS,
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  workspaceCreateRequestSchema,
  workspaceMemberRemovalSchema,
  workspaceMemberRoleSchema,
  workspaceOfSlug,
  workspacePhotoSetRequestSchema,
  workspaceRenameRequestSchema,
} from "@repo/features/workspace-wire";
import type { Sandbox } from "@repo/sandbox";
import {
  EXPERIMENT,
  isExperiment,
  isWorkspaceExperiment,
  type WorkspaceExperiment,
} from "@repo/settings";
import { describeWire, type StandardSchemaWithJson, standardSchemaOf } from "@repo/wire/effect";
import { Effect, Option, Predicate, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { writeOwnPreferences } from "../accounts/account-preferences.js";
import { accountProcedureSeams } from "../accounts/account-seams.js";
import { createdWorkspace, WorkspacePlugin } from "../accounts/workspace-create.js";
import {
  workspaceInvitationCancel,
  workspaceInvitationsRead,
  workspaceInvite,
} from "../accounts/workspace-invitation-operations.js";
import {
  workspaceMemberRemove,
  workspaceMemberRoleChange,
} from "../accounts/workspace-member-operations.js";
import { forgetWorkspaceMemory, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";
import {
  workspaceMembersRead,
  workspacePhotoSet,
  workspaceRename,
  workspaceSlugSet,
} from "../accounts/workspace-operations.js";
import {
  BROWSER_TAKEOVER_HOLD_MS,
  handBackAgentBrowserTab,
  listAgentBrowserTabs,
  openAgentBrowserTab,
  takeOverAgentBrowserTab,
} from "../agents/agent-browser-tabs.js";
import {
  READ_AGENT_CHANGES_INPUT,
  READ_AGENT_CHANGES_WORDS,
  runReadAgentChanges,
} from "../agents/agent-changes-tool.js";
import {
  deletedStoppedAgent,
  resumedAgentSandbox,
  rewoundStoppedAgentById,
  warmedAgent,
} from "../agents/agent-lifecycle.js";
import { agentPullRequestAction } from "../agents/agent-pull-request-procedures.js";
import {
  AGENT_CALLER,
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  AUTOMATION_RUNS_ON,
  agentToolRejected,
  callerUserId,
  callerWorkspaceId,
  cutOnLine,
  LIST_AGENTS_TOOL,
  LIST_MODELS_REFUSAL,
  LIST_TASKS_TOOL,
  MEMBER_START_CHOICE_FIELDS,
  orStoreRefusal,
  queueRecord,
  READ_PAGE_CHARS,
  READ_PAGE_REFUSAL,
  READ_PAGE_TOOL,
  runArchiveAgent,
  runListAgents,
  runListMemberModels,
  runListTasks,
  runReadAgentStanding,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUnarchiveAgent,
  runUpdateAgent,
  runUpdateTask,
  START_AGENT_REFUSAL,
  START_AGENT_TOOL,
  START_BRANCH,
  START_LEAVES_TASK_WORDS,
  START_PAYER_WORDS,
  startAgentToolOf,
  TASKS_LIST_LIMIT,
  TRANSCRIPT_PAGE_WORDS,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_REFUSAL,
  UPDATE_TASK_TOOL,
  updateTaskToolOf,
  workspaceAgentOf,
} from "../agents/agent-tools.js";
import {
  READ_AGENT_TRANSCRIPT_INPUT,
  runReadAgentTranscript,
} from "../agents/agent-transcript-tool.js";
import {
  AUTOMATION_TOOL_REFUSAL,
  CREATE_AUTOMATION_TOOL,
  DELETE_AUTOMATION_TOOL,
  RUN_AUTOMATION_TOOL,
  runCreateAutomation,
  runDeleteAutomation,
  runListAutomations,
  runRunAutomation,
  runUpdateAutomation,
  UPDATE_AUTOMATION_TOOL,
} from "../agents/automation-tools.js";
import type { AgentBrowser } from "../agents/browser/agent-browser.js";
import { MESSAGE_AGENT_REFUSAL, messageRefusalWords } from "../agents/coder-host/agent-message.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  recordMemberDescriptionNotes,
} from "../agents/coder-host/description-edit.js";
import { instancePublishedCache } from "../agents/coder-host/published.js";
import { changeAgentQueue } from "../agents/coder-host/queue-change.js";
import { productionSummaryModel } from "../agents/coder-host/replay-summary.js";
import { sessionsRouter } from "../agents/coder-host/runtime-sessions.js";
import { accountModelChoices } from "../agents/coder-host/start.js";
import { steerMemberWords } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  MEMBER_LIST_MACHINES_DESCRIPTION,
  runMemberListMachines,
} from "../agents/machines-tool.js";
import {
  type MemoryCall,
  runListMemories,
  runRecall,
  runRemember,
  SAVE_MEMORY_TOOL,
  SEARCH_MEMORY_TOOL,
} from "../agents/memory-tools.js";
import { runListPortsShared, runSharePort, SHARE_PORT_TOOL } from "../agents/port-tools.js";
import { ranRunAction, stoppedRunAction } from "../agents/run-actions.js";
import {
  TASK_REF_INPUT,
  TASK_REF_MISS,
  taskIdOfInput,
  taskRefRefusal,
} from "../agents/task-ref.js";
import {
  CHANGE_TASK_RELATION_INPUT,
  runChangeTaskRelation,
} from "../agents/task-relation-tools.js";
import {
  CREATE_SECTION_TOOL,
  DELETE_SECTION_TOOL,
  NO_SECTION_DELETED,
  runCreateSection,
  runDeleteSection,
} from "../agents/task-section-tools.js";
import {
  CREATE_TASK_TOOL,
  DESCRIPTION_TEXT_READ_CHARS,
  READ_TASK_REFUSAL,
  READ_TASK_TOOL,
  runCreateTask,
  runReadTask,
} from "../agents/task-tools.js";
import type { AgentSandbox } from "../agents/terminal/agent-sandbox.js";
import { WORKSPACE_AGENTS_LIST_LIMIT } from "../agents/workspace-agents.js";
import {
  EXPERIMENT_OFF_REFUSAL,
  type ExperimentsOn,
  experimentOnIn,
  NO_EXPERIMENT_ON,
} from "../agents/workspace-experiment-on.js";
import {
  agentChaptersGenerate,
  agentChaptersRead,
  chaptersProvidersFor,
  repositoryChaptersGenerate,
  repositoryChaptersRead,
} from "../chapters/pull-request-chapters-procedures.js";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type HostedApiError,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import type { PullRequestLinks } from "../github/pull-request-links.js";
import { pinRepository, readRepositoryPins } from "../github/repository-pins.js";
import {
  listWorkspaceRepositories,
  readPlaceFile,
  readPlaceIssue,
  readPlacePullRequest,
  readPlaceSkills,
  readPlaceTree,
  setWorkspaceTokenRepository,
  workspaceTokenRepositories,
} from "../github/workspace-repositories.js";
import { agentWorkspace } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import {
  installSkills,
  listSkills,
  previewSkillPaste,
  readSkill,
  removeSkill,
} from "../installed-skills/installed-skills.js";
import { parseSkillPaste } from "../installed-skills/skill-paste.js";
import type { IntegrationConnect } from "../integrations/integration-connect.js";
import { hostedKeyRing } from "../orpc/base.js";
import type { PageLinks } from "../pages/page-links.js";
import type { ModelCatalog, OfferedModel } from "../providers/model-catalog.js";
import type { SlackApp } from "../slack/slack-app.js";
import type { SlackBot } from "../slack/slack-bot.js";
import {
  disconnectSlackBot,
  readSlackBot,
  SlackBotUpdateUnconfirmed,
  updateSlackBot,
} from "../slack/slack-bot-operations.js";
import {
  COMMENT_TOOL_REFUSAL,
  commentAnswerRead,
  commentToolRejected,
  descriptionThreadOff,
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  runCommentTool,
  UPDATE_COMMENT_TOOL,
} from "../tasks/comment-tools.js";
import {
  type MentioningComment,
  memberCommentAnswer,
} from "../tasks/description-comments-procedures.js";
import {
  DESCRIPTION_SAVE_REFUSAL,
  DESCRIPTION_SAVE_STATUS,
  restoreRevision,
} from "../tasks/description-notes.js";
import { deleteTaskOfStoppedAgents } from "../tasks/task-delete.js";
import { readTaskFile } from "../tasks/task-file.js";
import { settledTaskRefusal } from "../tasks/task-finish.js";
import { readTaskTree } from "../tasks/task-tree.js";
import type { SentryApp } from "../triggers/sentry/sentry-app-config.js";
import {
  deleteWorkspaceVariable,
  listWorkspaceEnvironment,
  putWorkspaceVariable,
} from "../workspace-environment/workspace-environment.js";
import {
  editRunAction,
  readSandboxSetup,
  saveInstallScript,
  saveRepositorySetup,
} from "../workspace-sandbox-setup/workspace-sandbox-setup.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";
import {
  acknowledgeThreadAsMember,
  answerAskAsMember,
  closeThreadAsMember,
  markInboxReadAsMember,
  markThreadReadAsMember,
  readMemberInbox,
  remindThreadAsMember,
  replyAsMember,
  startThreadAsMember,
} from "./inbox.js";
import {
  connectIntegrationAsMember,
  disconnectIntegrationAsMember,
  disconnectSentryAsMember,
  listIntegrationsAsMember,
  listIntegrationToolsAsMember,
  listMcpClientsAsMember,
  readSentryAsMember,
  renameIntegrationAsMember,
  revokeMcpClientAsMember,
} from "./integrations.js";
import {
  MARK_FILES_VIEWED_FIELDS,
  READ_PULL_REQUEST_FIELDS,
  runMarkAgentFilesViewed,
  runMarkFilesViewed,
  runReadAgentPullRequest,
  runReadPullRequest,
} from "./pull-request-tools.js";

/** What a tool's effect runs against: the store, GitHub through the App, the model catalog, the deployment's environment a start's summary model reads, our Sentry integration an automation's trigger is checked against and a workspace's installations are read through, Vercel Connect the member's own integrations are read, begun, and ended through, the pull request links a link's read is kept in, an agent's sandbox its ports are read and shared in and the browser in it a tab is opened in, the deployment's page links its shares answer, the organization plugin a workspace is created through, and the member the call acts for. */
export type MemberMcpServices =
  | Sandbox
  | WorkspacePlugin
  | AgentSandbox
  | AgentBrowser
  | PageLinks
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | PullRequestLinks
  | ModelCatalog
  | HostedEnvironment
  | SentryApp
  | IntegrationConnect
  | SlackBot
  | SlackApp
  | AdmittedMember;

/** A tool's input declaration: a wire schema the emitter can show and the reader can read. */
export type MemberMcpToolInput = Schema.Top & Schema.ConstraintDecoder<unknown>;

/** What a tool answers: a record the agent reads as JSON. */
export type MemberMcpToolResult = object;

export interface MemberMcpTool<Input extends MemberMcpToolInput = MemberMcpToolInput> {
  /** The name a model calls it by, one of `MEMBER_MCP_TOOL`'s, so every tool has its row in `coverage.ts`. */
  readonly name: MemberMcpToolName;
  /** What the agent is told of the tool, written for one acting for the member. */
  readonly description: string;
  readonly input: Input;
  /** What the tool does to the member's world, as MCP's annotations tell a client. */
  readonly annotations: ToolAnnotations;
  /** The input as the SDK takes it, built once from `input`. */
  readonly inputSchema: StandardSchemaWithJson<Input>;
  /** The tool's work, on the arguments the SDK checked against `input`. */
  run(input: Input["Type"]): Effect.Effect<MemberMcpToolResult, StoreFailure, MemberMcpServices>;
  /** The workspace experiment the tool is of, which lists it only to a member with that experiment on in one of their workspaces at least; none for a tool every member is listed. */
  readonly experiment?: WorkspaceExperiment;
  /** The tool's words and input where none of the member's workspaces has Task descriptions on, which name no description; none for a tool whose words name none. */
  readonly descriptionsOff?: MemberMcpToolWords;
}

/** A tool's words and input, as a variant of them is listed. */
interface MemberMcpToolWords {
  readonly description: string;
  readonly input: MemberMcpToolInput;
}

export { MEMBER_MCP_TOOL, type MemberMcpToolName };

/**
 * The member tools since renamed, each with the tool in its place, which
 * the server names in its refusal (`app.ts`) rather than answering an
 * unknown tool, because a client keeps the list it was handed before the
 * rename.
 */
export const RENAMED_MEMBER_MCP_TOOL: ReadonlyMap<string, MemberMcpToolName> = new Map([
  [RETIRED_TOOL.EDIT_PLAN, MEMBER_MCP_TOOL.EDIT_DESCRIPTION],
  ["comment_on_plan", MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION],
]);

/** A read's annotations: it changes nothing of the member's. */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true };

/** Why a call names no workspace to be about, in words the agent can act on, the member's own named where they have some. */
const MEMBER_WORKSPACE_REFUSAL = {
  NONE: "Not run: the member belongs to no workspace yet.",
  UNKNOWN: (choices: string) =>
    `Not run: the member belongs to no workspace of that slug; name one of theirs in workspace ` +
    `by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered: ${choices}.`,
  /** A call in a mode that needs its workspace named, which it left out, in the call's own words of that mode. */
  MISSING: (mode: string) =>
    `Not run: ${mode} names its workspace, so pass workspace by the slug ` +
    `${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered.`,
} as const;

/**
 * The words and SDK input a tool is listed with to a member whose
 * workspaces have the experiments given on, one of them at least: its own,
 * or, where none has Task descriptions on, the ones that name no
 * description.
 */
export function listedMemberMcpTool(
  tool: MemberMcpTool,
  experimentsOn: ReadonlySet<WorkspaceExperiment>,
): Pick<MemberMcpTool, "description" | "inputSchema"> {
  const off = tool.descriptionsOff;

  if (off === undefined || experimentsOn.has(EXPERIMENT.DESCRIPTIONS)) return tool;

  return { description: off.description, inputSchema: standardSchemaOf(off.input) };
}

/** A tool's declaration, its SDK input built beside it. */
function memberMcpTool<Input extends MemberMcpToolInput>(
  tool: Omit<MemberMcpTool<Input>, "inputSchema">,
): MemberMcpTool<Input> {
  return { ...tool, inputSchema: standardSchemaOf(tool.input) };
}

/** The member as the agent tools' caller, about the workspace given. */
function memberCaller(member: AdmittedMemberValues, workspaceId: string): AgentReadCall {
  return {
    caller: {
      kind: AGENT_CALLER.MEMBER,
      userId: member.userId,
      workspaceId,
      clientId: member.clientId,
    },
  };
}

/**
 * The workspace a call is about: the one of the member's its slug names,
 * read as a link's step is (`workspaceOfSlug`); or why there is none,
 * naming the member's own. Note that no slug is ever guessed, the member's
 * only workspace included, so a call always says where it acts.
 */
const listedWorkspace = (userId: string, slug: string) =>
  Effect.map(listWorkspaces(userId), (workspaces): Result.Result<string, string> => {
    if (workspaces.length === 0) return Result.fail(MEMBER_WORKSPACE_REFUSAL.NONE);
    const named = workspaceOfSlug(workspaces, slug);
    const choices = workspaces.map((one) => `${one.slug ?? one.id} (${one.name})`).join(", ");

    return named === undefined
      ? Result.fail(MEMBER_WORKSPACE_REFUSAL.UNKNOWN(choices))
      : Result.succeed(named.id);
  });

/** A list run as the member, about the workspace its slug names; refused, naming theirs, where that names none. */
const listAsMember = <R>(
  slug: string,
  read: (call: AgentReadCall) => Effect.Effect<WireRecord, never, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);

    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);

    return yield* read(memberCaller(member, workspace.success));
  });

/** A call run as the member, in the workspace its slug names, as a list is; refused, naming theirs, where that names none. */
const asMemberInWorkspace = (
  slug: string,
  run: (userId: string, workspaceId: string) => Effect.Effect<object, never, MemberMcpServices>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);

    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);

    return yield* run(member.userId, workspace.success);
  });

/** A read by id run as the member, about the workspace that holds what it names as the member reaches it; refused in the read's own words where they reach none. */
const readAsMember = <R, RRead>(
  workspaceOf: (userId: string) => Effect.Effect<Option.Option<string>, StoreFailure, R>,
  refusal: string | WireRecord,
  read: (call: AgentReadCall) => Effect.Effect<WireRecord, never, RRead>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* workspaceOf(member.userId);

    if (Option.isNone(workspace)) {
      return Predicate.isString(refusal) ? agentToolRejected(refusal) : refusal;
    }

    return yield* read(memberCaller(member, workspace.value));
  });

/** The workspace of the task a page stands on, as the member reaches it. */
const pageWorkspace = (userId: string, pageId: string) =>
  Effect.flatMap(readPageById(userId, pageId, undefined), (found) =>
    Option.isNone(found)
      ? Effect.succeed(Option.none<string>())
      : readTaskWorkspace(userId, found.value.taskId),
  );

/** Why a member's call naming a task by its key ran nowhere, in the call's own opening. */
function keyWithoutWorkspaceRefusal(opening: string): string {
  return (
    `${opening}: a key names a task's number in one workspace, so name that workspace in ` +
    `workspace by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered, or name the task in ` +
    `taskId by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered.`
  );
}

/** A member's call on one task names it by its id, or by its key in the workspace named. */
interface MemberTaskNamed {
  readonly workspace?: string | undefined;
  readonly taskId: string;
}

/** How a member's call on one task words a task it names none of: its opening, and its own refusal of a task the member reaches none of. */
interface MemberTaskWords {
  readonly opening: string;
  readonly noTask: string;
}

/**
 * The task a member's call names and the workspace that holds it, as the
 * member reaches it: by its id in whichever of their workspaces it stands,
 * or, with a workspace named, a task of that workspace by its id or its key
 * (`taskIdOfInput`); or why there is none, in the call's own words.
 */
const memberTaskOf = (userId: string, named: MemberTaskNamed, words: MemberTaskWords) =>
  Effect.gen(function* () {
    const ref = cliTaskRefOf(named.taskId);

    if (ref === undefined) {
      return Result.fail(
        taskRefRefusal(words.opening, "taskId", { kind: TASK_REF_MISS.UNREADABLE }),
      );
    }

    if (named.workspace === undefined && !("id" in ref)) {
      return Result.fail(keyWithoutWorkspaceRefusal(words.opening));
    }

    const listed =
      named.workspace === undefined
        ? Result.succeed(undefined)
        : yield* listedWorkspace(userId, named.workspace);

    if (Result.isFailure(listed)) return Result.fail(listed.failure);

    const taskId =
      listed.success === undefined || "id" in ref
        ? Result.succeed("id" in ref ? ref.id : named.taskId)
        : yield* taskIdOfInput(
            userId,
            listed.success,
            { opening: words.opening, field: "taskId" },
            named.taskId,
          );

    if (Result.isFailure(taskId)) return Result.fail(taskId.failure);
    const holding = yield* readTaskWorkspace(userId, taskId.success);

    // A workspace named holds the task, which refuses an id of a task standing in another.
    if (
      Option.isNone(holding) ||
      (listed.success !== undefined && holding.value !== listed.success)
    ) {
      return Result.fail(words.noTask);
    }

    return Result.succeed({ taskId: taskId.success, workspaceId: holding.value });
  });

/** A call on one task run as the member, about the workspace that holds it (`memberTaskOf`), handed the task's id; refused in the call's own words where they reach none. */
const onMemberTask = <E, R>(
  named: MemberTaskNamed,
  words: MemberTaskWords,
  read: (call: AgentReadCall, taskId: string) => Effect.Effect<WireRecord, E, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const task = yield* memberTaskOf(member.userId, named, words);

    if (Result.isFailure(task)) return agentToolRejected(task.failure);

    return yield* read(memberCaller(member, task.success.workspaceId), task.success.taskId);
  });

/** A workspace, by its slug. */
const WORKSPACE_SLUG = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(WORKSPACE_BOUNDS.MAX_SLUG_CHARS),
);

/** The workspace a member's call on one task names it in, which a key needs. */
const TASK_WORKSPACE_INPUT = Schema.optionalKey(
  describeWire(
    WORKSPACE_SLUG,
    `The workspace the task stands in, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} ` +
      "answered: required with a key, and with an id the workspace that must hold the task; " +
      "leave it out with an id for whichever workspace it stands in.",
  ),
);

/** A member's call names a task by the id list_tasks answered or by its key, such as ACME-42, in the workspace named. */
const memberTaskInput = (whose: string) =>
  describeWire(
    TASK_REF_INPUT,
    `${whose}, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered, or by its key, such as ACME-42, ` +
      "with the workspace it stands in.",
  );

/** A call's workspace, by the slug `list_workspaces` answered, its words naming what the call does there; every call names it, the member's only workspace included. */
const workspaceInput = (what: string) =>
  describeWire(
    WORKSPACE_SLUG,
    `The workspace ${what}, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered.`,
  );

/** A list's input: the workspace it is about. */
const WORKSPACE_INPUT = workspaceInput("to list");

/** How a call tells the agent to name its workspace. */
const WORKSPACE_WORDS =
  "Name the workspace by its slug, even where the member belongs to one alone; " +
  `${MEMBER_MCP_TOOL.LIST_WORKSPACES} names them.`;

/** `list_workspaces` takes nothing: the member's workspaces are the member's. */
const NoInputSchema = Schema.Struct({});

export const LIST_WORKSPACES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_WORKSPACES,
  description:
    "List the workspaces the member you act for belongs to: each with its id, which every task and agent of it names, its slug, the first step of its links, its name, and the member's role in it (owner, admin, or member). Call it first to learn which workspace to work in.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const workspaces = yield* listWorkspaces(member.userId);

      return {
        workspaces: workspaces.map(({ id, slug, name, role }) => ({ id, slug, name, role })),
      };
    }),
});

/** A list of tasks narrows as the agents' own does, in the workspace named. */
const ListTasksInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...LIST_TASKS_TOOL.inputSchema.fields,
});

const MEMBER_LIST_TASKS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_TASKS,
  description:
    "List the tasks of a workspace the member belongs to, started by any member, the Done and " +
    "Canceled ones among them: each with its id, its key (such as ACME-42), its name, where it " +
    `stands (its status: ${Object.values(TASK_STATUS).join(", ")}) and how much it matters (its ` +
    "priority), who it is assigned to (its assignee's mention link, null for no one), the " +
    "repository its agents work in (null for none yet), who started it, its followers (each " +
    "with their name and id, whether they are its assignee, and whether its " +
    "agents may use their machines; absent where the workspace keeps none), the sectionId of the " +
    "sidebar section the member keeps it in (null for none), the newest first and at most " +
    `${TASKS_LIST_LIMIT} a page, with nextOffset where more stand; and beside them every ` +
    "section the member keeps in that workspace's sidebar, each with its id and title. Narrow " +
    "it by words of a task's name with nameContains, by where it stands with status, and by " +
    `who it is assigned to with assignee. ${WORKSPACE_WORDS} Call it to find a task to read ` +
    `with ${MEMBER_MCP_TOOL.READ_TASK}, or to narrow ${MEMBER_MCP_TOOL.LIST_AGENTS} to one.`,
  input: ListTasksInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => listAsMember(workspace, (call) => runListTasks(call, asked)),
});

/** Why a member's read of a task by its key ran nowhere, in words the agent can act on. */
const MEMBER_READ_TASK_REFUSAL = {
  KEY_WITHOUT_WORKSPACE: keyWithoutWorkspaceRefusal("Not read"),
} as const;

/** A member's read names the task by its id or its key, and the workspace it stands in, which a key needs. */
const MemberReadTaskInputSchema = Schema.Struct({
  workspace: Schema.optionalKey(
    describeWire(
      WORKSPACE_SLUG,
      `The workspace the task stands in, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} ` +
        "answered: required with a key, and with an id the workspace that must hold the task; " +
        "leave it out with an id to read the task in whichever workspace it stands.",
    ),
  ),
  ...READ_TASK_TOOL.inputSchema.fields,
});

/** How a member's read names its task, in the words both of its listings open with. */
const MEMBER_READ_TASK_NAMING =
  "Read one task the member can open, a teammate's included, by its id in whichever of the " +
  "member's workspaces it stands, or by its key (such as ACME-42) in the workspace named: its " +
  "id, key, name, where it stands (its status) and how much it matters (its priority), " +
  "repository, who started it (startedBy, and startedByUserId to link them by), the brief it " +
  "was started with (null for none), the tasks it is blocked by and the tasks it blocks (each " +
  "with its id, name, and status), ";

const MEMBER_READ_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_TASK,
  description:
    MEMBER_READ_TASK_NAMING +
    "its followers (each with their name and id, " +
    "whether they are its assignee, and whether its agents may use their machines; " +
    "absent where the workspace keeps none), and its description as last saved, cut on a " +
    `line at ${DESCRIPTION_TEXT_READ_CHARS} characters with how many were left out. ` +
    `${MEMBER_MCP_TOOL.LIST_AGENTS} with its taskId names the agents on it.`,
  input: MemberReadTaskInputSchema,
  descriptionsOff: {
    description:
      MEMBER_READ_TASK_NAMING +
      "and its followers (each with their " +
      "name and id, whether they are its assignee, and whether its agents may use " +
      "their machines; absent where the workspace keeps none). " +
      `${MEMBER_MCP_TOOL.LIST_AGENTS} with its taskId names the agents on it.`,
    input: MemberReadTaskInputSchema,
  },
  annotations: READ_ONLY,
  run: ({ workspace, taskId }) =>
    Effect.gen(function* () {
      const ref = cliTaskRefOf(taskId);

      if (ref === undefined) return agentToolRejected(READ_TASK_REFUSAL.UNREADABLE);

      // A workspace named holds the read, which refuses an id of a task standing in another.
      if (workspace !== undefined) {
        return yield* listAsMember(workspace, (call) => runReadTask(call, { taskId }));
      }

      if (!("id" in ref)) return agentToolRejected(MEMBER_READ_TASK_REFUSAL.KEY_WITHOUT_WORKSPACE);

      return yield* readAsMember(
        (userId) => readTaskWorkspace(userId, ref.id),
        READ_TASK_REFUSAL.NO_TASK,
        (call) => runReadTask(call, { taskId }),
      );
    }),
});

/** A list of agents narrows as the agents' own does, in the workspace named, bar to a task of the caller's own, since the member works on none. */
const ListAgentsInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  taskId: LIST_AGENTS_TOOL.inputSchema.fields.taskId,
  words: LIST_AGENTS_TOOL.inputSchema.fields.words,
  offset: LIST_AGENTS_TOOL.inputSchema.fields.offset,
});

const MEMBER_LIST_AGENTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AGENTS,
  description:
    "List the coding agents of a workspace the member belongs to, on any task and " +
    "started by any member: each with its id, its title (how the member sees it named), the " +
    "model and effort it runs on with the model's name to say it by, its status " +
    `(${Object.values(AGENT_STATUS).join(", ")}) and why where it failed, its repository and the ` +
    "branch its sandbox is on if a turn has ended, one line of what it last did, its task (id " +
    "and name; null for one the member cannot open), and whether it is archived; the newest started " +
    "first, at most " +
    `${WORKSPACE_AGENTS_LIST_LIMIT} a page, with nextOffset where more stand, which offset ` +
    "reads the next page by. Pass words to search by words of an agent's title or its task's " +
    `name, or a taskId for one task's agents. ${WORKSPACE_WORDS} Failed covers a session that ` +
    "ended for good, which no message reaches again; an agent still running long after its " +
    "last activity may have lost its session.",
  input: ListAgentsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => listAsMember(workspace, (call) => runListAgents(call, asked)),
});

const ReadAgentInputSchema = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${MEMBER_MCP_TOOL.LIST_AGENTS} answered it.`,
  ),
});

const MEMBER_READ_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_AGENT,
  description:
    "Read one coding agent the member can see, by its id, on any task and started by any " +
    "member, in whichever of the member's workspaces it stands: what " +
    `${MEMBER_MCP_TOOL.LIST_AGENTS} says of it, and the messages waiting in its queue, each ` +
    "by its id, its words cut short, how many files go with it, and whether a member holds it, " +
    "with why the queue stands paused where it does. Read one to learn where an agent stands " +
    `and whether it went quiet; ${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT} reads what it said and ` +
    `did, and ${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} its branch and pull request. It only ` +
    "reads: the agent is not told. Answers `accepted` with the reading, or `rejected` and why.",
  input: ReadAgentInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runReadAgentStanding(call, asked.agentId),
    ),
});

const READ_AGENT_CHANGES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_AGENT_CHANGES,
  description:
    "Read what a coding agent the member can see published, by its id, " + READ_AGENT_CHANGES_WORDS,
  input: READ_AGENT_CHANGES_INPUT,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runReadAgentChanges(call, asked),
    ),
});

const READ_AGENT_TRANSCRIPT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT,
  description:
    "Read the whole transcript of a coding agent the member can see, by its id, or of one of " +
    `its workers, page by page: ${TRANSCRIPT_PAGE_WORDS} Each line sent to it also carries ` +
    "its lineId, and each call its callId. Name a worker by the callId of the call that started it to page " +
    "through that worker's transcript instead; name a call by its messageId and callId to read " +
    "that one call whole, its input and its output or its error, which a page leaves out, each " +
    `cut on a line at ${READ_PAGE_CHARS} characters with how many were left out. It only reads: ` +
    "the agent is not told. Answers `accepted` with the page or the call, or `rejected` and why.",
  input: READ_AGENT_TRANSCRIPT_INPUT,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runReadAgentTranscript(call, asked),
    ),
});

const MEMBER_LIST_MODELS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_MODELS,
  description:
    "List the models the member may start an agent on, as they are offered them: each with its " +
    "catalog id, the model's name to say it by, the efforts it lists, its contextWindows, " +
    "the standard and the long with each one's size in tokens and what the long one costs as a " +
    "multiple of the standard price, or none where it runs on one window, and its payers, the " +
    "kinds of credential the member keeps that pay for it (subscription, api_key, both, or none " +
    "where nothing does), which a start never picks between, since each turn of a cloud agent " +
    "takes the first with room; the member's default model, effort, and the window it runs on, which " +
    `the app's own Starts run on and a ${MEMBER_MCP_TOOL.START_AGENT} call never does, and ` +
    "whether it is still offered; and chaptersProviders, " +
    "the providers whose API key the member saved, which " +
    `${MEMBER_MCP_TOOL.GENERATE_PULL_REQUEST_CHAPTERS} may run on, none where they saved none. ` +
    "The models are the member's own, the same in every workspace.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () =>
    Effect.flatMap(AdmittedMember, (member) =>
      Effect.gen(function* () {
        const listed = yield* runListMemberModels(member.userId);

        if (listed.status !== ACTION_RESULT_STATUS.ACCEPTED) return listed;
        const providers = yield* Effect.result(chaptersProvidersFor(member.userId));

        if (Result.isFailure(providers)) return agentToolRejected(LIST_MODELS_REFUSAL.UNAVAILABLE);

        return { ...listed, chaptersProviders: [...providers.success] };
      }),
    ),
});

const MEMBER_LIST_MACHINES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_MACHINES,
  description: MEMBER_LIST_MACHINES_DESCRIPTION,
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () => Effect.flatMap(AdmittedMember, (member) => runMemberListMachines(member.userId)),
});

const ReadPageInputSchema = Schema.Struct({
  pageId: describeWire(wireUuidSchema, "The page's id, as a mention of it or a link to it names."),
  version: READ_PAGE_TOOL.inputSchema.fields.version,
});

const MEMBER_READ_PAGE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_PAGE,
  description:
    "Read a page an agent showed, by the page's id, on a task the member can open, in " +
    "whichever of the member's workspaces it stands: its " +
    `title, the version read (the one you name, by its number or "${READ_PAGE_VERSION.NEWEST}") ` +
    "and the newest there is, its " +
    `task, and its HTML as it stands, cut on a line at ${READ_PAGE_CHARS} characters with ` +
    "how many were left out.",
  input: ReadPageInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => pageWorkspace(userId, asked.pageId),
      READ_PAGE_REFUSAL.NO_PAGE,
      (call) => runReadPage(call, asked),
    ),
});

// A task's repository as its File tab reads it, through the reads its procedures run (`../tasks/task-file.ts`, `../tasks/task-tree.ts`).

/** Why a file is not read or a folder not listed, in words the agent can act on. */
const TASK_FILE_REFUSAL_WORDS = {
  [TASK_FILE_REFUSAL.SECRET]:
    "Not read: the file may hold a secret, so its contents are never read.",
  [TASK_FILE_REFUSAL.MISSING]: `Not read: nothing of that kind stands at that path; ${MEMBER_MCP_TOOL.LIST_TASK_FOLDER} lists what does.`,
  [TASK_FILE_REFUSAL.NOT_TEXT]: "Not read: the file is too large, or not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "Not read: the task has no repository yet.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "Not read: the workspace's GitHub installation does not reach the task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "Not read: GitHub did not answer just now; try again shortly.",
} as const satisfies Record<TaskFileRefusal, string>;

/** A read's answer to the agent: accepted with what it found, or rejected and why, naming the branch GitHub found nothing on. */
function taskFileAnswerOf(read: Option.Option<TaskFileAnswer | TaskTreeAnswer>) {
  if (Option.isNone(read)) return agentToolRejected(READ_TASK_REFUSAL.NO_TASK);
  const answer = read.value;

  if (!("refusal" in answer)) return { status: ACTION_RESULT_STATUS.ACCEPTED, ...answer };
  const words = TASK_FILE_REFUSAL_WORDS[answer.refusal];

  return agentToolRejected(
    answer.branch === undefined ? words : `${words} (read on ${answer.branch})`,
  );
}

const TASK_FILE_TASK_INPUT = memberTaskInput("The task whose repository to read");

/** The branch or commit a member's read of a repository stands at, which every read names. */
const REPOSITORY_REF_INPUT = describeWire(
  START_BRANCH,
  "The branch or commit to read at: a branch by its name, such as the defaultBranch " +
    `${MEMBER_MCP_TOOL.LIST_REPOSITORIES} answers, read at its head, or a commit by its full ` +
    "SHA, such as the head a pull request stands on.",
);

/** How a read of a task's repository words a task it names none of. */
const TASK_FILE_TASK_WORDS = { opening: "Not read", noTask: READ_TASK_REFUSAL.NO_TASK } as const;

const ReadTaskFileInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: TASK_FILE_TASK_INPUT,
  path: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
    "The file's path from the repository's root, such as src/index.ts.",
  ),
  firstLine: Schema.optionalKey(
    describeWire(codeLineSchema, "The first line to read, from 1; 1 where left out."),
  ),
  ref: REPOSITORY_REF_INPUT,
});

const READ_TASK_FILE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_TASK_FILE,
  description:
    "Read a file of the task's repository on GitHub, for a task the member can open, by the " +
    "task's id, the file's path, and the branch or commit to read at, as the task's File tab " +
    "shows it: read through the workspace's installation, never from an agent's sandbox, " +
    "which may hold work not pushed yet. Answers `accepted` with the file's path, the " +
    "repository and the branch or commit read, the commit read at where GitHub named one, the " +
    `line the window starts at, how many lines the whole file has, and up to ` +
    `${TASK_FILE_BOUNDS.WINDOW_LINES} of its lines, each cut at ` +
    `${TASK_FILE_BOUNDS.MAX_LINE_CHARS} characters; pass firstLine to read further. A file ` +
    "that may hold a secret, is too large, or is not text is refused. Answers `rejected` and " +
    `why otherwise. ${MEMBER_MCP_TOOL.LIST_TASK_FOLDER} lists a folder.`,
  input: ReadTaskFileInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, taskId: named, path, firstLine = 1, ref }) =>
    onMemberTask({ workspace, taskId: named }, TASK_FILE_TASK_WORDS, ({ caller }, taskId) => {
      const window = {
        path,
        firstLine,
        lastLine: firstLine + TASK_FILE_BOUNDS.WINDOW_LINES - 1,
        ref,
      };

      return Effect.map(readTaskFile(callerUserId(caller), taskId, window), taskFileAnswerOf);
    }),
});

const ListTaskFolderInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: TASK_FILE_TASK_INPUT,
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
      "The folder's path from the repository's root, such as src; the root where left out.",
    ),
  ),
  recursive: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to list everything under the folder, each entry by its path from the folder; " +
        "false or left out for the folder's own entries.",
    ),
  ),
  ref: REPOSITORY_REF_INPUT,
});

const LIST_TASK_FOLDER_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_TASK_FOLDER,
  description:
    "List a folder of the task's repository on GitHub, for a task the member can open, by the " +
    "task's id and the branch or commit to list at, as the tree beside its File tab lists it: " +
    "read through the workspace's installation, never from an agent's sandbox. Answers " +
    "`accepted` with the folder's path, the repository and the branch or commit read, its " +
    "entries in GitHub's order, " +
    "each with its name and whether it is a file or a folder, and truncated true where there " +
    `were more than ${TASK_TREE_BOUNDS.MAX_ENTRIES} (or ${TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES} ` +
    "with recursive), or `rejected` and why. " +
    `${MEMBER_MCP_TOOL.READ_TASK_FILE} reads a file it lists.`,
  input: ListTaskFolderInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, taskId: named, path = "", recursive, ref }) =>
    onMemberTask({ workspace, taskId: named }, TASK_FILE_TASK_WORDS, ({ caller }, taskId) => {
      const folder = { path, ref, ...(recursive === true ? { recursive } : undefined) };

      return Effect.map(readTaskTree(callerUserId(caller), taskId, folder), taskFileAnswerOf);
    }),
});

/*
 * The writes. Each runs the agents' own door for it (`../agents/agent-tools.ts`,
 * `task-tools.ts`, `task-section-tools.ts`) with the member as the caller, on
 * a full call of the agent tools built once here (`memberWriteCall`), or,
 * where a member's act is not an agent's, the desktop's own operation for
 * it: a description's notes are the member's own edit (`recordMemberDescriptionNotes`),
 * and a message is the member's own words (`steerMemberWords`), as their
 * message box sends them. A write is about the workspace that holds what it
 * names, as a read by id is, or the one its slug names, as a list is.
 */

/** A write that adds to the member's world and takes nothing away. */
const ADDITIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };

/** A change the same call made again leaves as it stood. */
const IDEMPOTENT_CHANGE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

const UpdatePreferencesInputSchema = Schema.Struct({
  model: describeWire(
    modelChoiceSchema.fields.model,
    `The default model, by its catalog id as ${MEMBER_MCP_TOOL.LIST_MODELS} answers it.`,
  ),
  effort: describeWire(
    modelChoiceSchema.fields.effort,
    "The default reasoning effort, as the model lists it.",
  ),
  contextWindow: Schema.optionalKey(
    describeWire(
      contextWindowSchema,
      "The default context window, standard or long: required where " +
        `${MEMBER_MCP_TOOL.LIST_MODELS} lists the model's contextWindows, and refused where it ` +
        "lists none, since that model runs on one window.",
    ),
  ),
});

/** Why a change of the member's preferences took nothing, in words for one acting for the member. */
const UPDATE_PREFERENCES_REFUSAL = {
  NOT_OFFERED:
    "Not changed: the member is not offered that model and effort, or no credential of theirs " +
    `pays for that model; ${MEMBER_MCP_TOOL.LIST_MODELS} lists the choices.`,
  UNAVAILABLE:
    "Not changed: the model catalog or the member's preferences could not be read; try again.",
  windowMissing: (model: string, windows: ContextWindows) =>
    `Not changed: contextWindow is required for ${model}, which runs on two: standard ` +
    `(${windows.standardTokens} tokens) or long (${windows.longTokens} tokens), as ` +
    `${MEMBER_MCP_TOOL.LIST_MODELS} lists them.`,
  windowOffered: (model: string) =>
    `Not changed: ${model} runs on one context window, so it takes no contextWindow; leave ` +
    `it out, as ${MEMBER_MCP_TOOL.LIST_MODELS} lists its contextWindows as none.`,
} as const;

/**
 * Why a default's context window does not fit its model, or nothing where
 * it does: a model that offers two must be given one, and a model with one
 * takes none. A model the member is not offered is left to the write,
 * which refuses it.
 */
function preferencesWindowRefusal(
  offered: readonly OfferedModel[],
  choice: typeof UpdatePreferencesInputSchema.Type,
): string | undefined {
  if (!offered.some((model) => model.id === choice.model)) return undefined;
  const windows = contextWindowsOf(offered, choice.model);

  if (windows !== undefined && choice.contextWindow === undefined) {
    return UPDATE_PREFERENCES_REFUSAL.windowMissing(choice.model, windows);
  }

  if (windows === undefined && choice.contextWindow !== undefined) {
    return UPDATE_PREFERENCES_REFUSAL.windowOffered(choice.model);
  }

  return undefined;
}

/**
 * `update_preferences`: the member's coding agents' default, written as
 * their Settings writes it (`writeOwnPreferences`), so a choice the catalog
 * does not offer them, or one no credential of theirs pays for, is refused
 * as Settings is.
 */
const UPDATE_PREFERENCES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_PREFERENCES,
  description:
    "Change the member's own preferences, as their Settings would: the default model and " +
    "effort their coding agents start on where a start names neither, and its context window, " +
    `as ${MEMBER_MCP_TOOL.LIST_MODELS} lists them: a model it lists contextWindows for takes ` +
    "one of them, and a model it lists none for takes none. The default is the member's own, " +
    "the same in every workspace, and agents already started keep the model they run on. Answers " +
    "`accepted` with the default as it then stands, or `rejected` and why; " +
    `${MEMBER_MCP_TOOL.LIST_MODELS} reads it back.`,
  input: UpdatePreferencesInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (agent) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const choices = yield* Effect.result(accountModelChoices(member.userId));

      if (Result.isFailure(choices)) {
        return agentToolRejected(UPDATE_PREFERENCES_REFUSAL.UNAVAILABLE);
      }

      const windowRefusal = preferencesWindowRefusal(choices.success.offered, agent);

      if (windowRefusal !== undefined) return agentToolRejected(windowRefusal);

      return yield* writeOwnPreferences(accountProcedureSeams(), member.userId, { agent }).pipe(
        Effect.map((written) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          default: written.agent,
        })),
        Effect.catch((refusal) =>
          Effect.succeed(
            agentToolRejected(
              refusal.error === HOSTED_API_ERROR.INVALID_REQUEST
                ? UPDATE_PREFERENCES_REFUSAL.NOT_OFFERED
                : UPDATE_PREFERENCES_REFUSAL.UNAVAILABLE,
            ),
          ),
        ),
      );
    }),
});

/** A write that may take something away, such as a turn under way, an archived agent's place, or a section, which the same call made again leaves as it stood. */
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
};

/** The writer the member's writes go through, over the coding agent's tool set, as the desktop's own writes are made. */
const MEMBER_WRITER = storeWriter({ tools: CODER_TOOL_SET });

/**
 * The member as the agent tools' writing caller, about the workspace a read
 * of it resolved: the sessions the deployment reaches acting for the member,
 * each agent's answered by the runtime its conversation runs on
 * (`sessionsRouter`), the writer over the coding agent's tool set, a key
 * minted fresh for this one call, so a start or a message the client sends
 * again is a second one, and the summary model a start from another agent
 * replays with, as the Start route's.
 */
const memberWriteCall = (read: AgentReadCall) =>
  Effect.gen(function* () {
    const agentSessionsAs = yield* sessionsRouter;
    const environment = yield* HostedEnvironment;

    const call: AgentCall = {
      ...read,
      agentSessions: agentSessionsAs(callerUserId(read.caller)),
      agentSessionsAs,
      writer: MEMBER_WRITER,
      clientKey: randomUUID(),
      summaryModel: (owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        ),
    };

    return call;
  });

/** A write run as the member, about the workspace its slug names; refused, naming theirs, where that names none. */
const listWriteAsMember = <R>(
  slug: string,
  write: (call: AgentCall) => Effect.Effect<WireRecord, never, R>,
) => listAsMember(slug, (read) => Effect.flatMap(memberWriteCall(read), write));

/** A write by id run as the member, about the workspace that holds what it names as the member reaches it; refused in the door's own words where they reach none. */
const writeAsMember = <R, RWrite>(
  workspaceOf: (userId: string) => Effect.Effect<Option.Option<string>, StoreFailure, R>,
  refusal: string | WireRecord,
  write: (call: AgentCall) => Effect.Effect<WireRecord, never, RWrite>,
) => readAsMember(workspaceOf, refusal, (read) => Effect.flatMap(memberWriteCall(read), write));

/** A write on one task run as the member, about the workspace that holds it (`memberTaskOf`), handed the task's id; refused in the call's own words where they reach none. */
const writeOnMemberTask = <R>(
  named: MemberTaskNamed,
  words: MemberTaskWords,
  write: (call: AgentCall, taskId: string) => Effect.Effect<WireRecord, never, R>,
) =>
  onMemberTask(named, words, (read, taskId) =>
    Effect.flatMap(memberWriteCall(read), (call) => write(call, taskId)),
  );

/** The workspace of one of the member's sidebar sections, by its id. */
const sectionWorkspace = (userId: string, sectionId: string) =>
  Effect.map(listTaskSections(userId), ({ sections }) =>
    Option.map(
      Option.fromNullishOr(sections.find((section) => section.id === sectionId)),
      (section) => section.workspaceId,
    ),
  );

/** How a tool that sets an agent to work tells the outside agent to follow it, since nothing reports back to it. */
const FOLLOW_WORDS =
  "Nothing reports back to you, since an agent the member reaches from here has no starting " +
  `agent: follow it with ${MEMBER_MCP_TOOL.READ_AGENT}, which reads where it stands and what it ` +
  `last did, and ${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT}, which reads what it said.`;

/** A task the member makes names the workspace it is made in, and what the agents' own make names. */
const CreateTaskInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  name: CREATE_TASK_TOOL.inputSchema.fields.name,
  repository: CREATE_TASK_TOOL.inputSchema.fields.repository,
  brief: CREATE_TASK_TOOL.inputSchema.fields.brief,
  description: CREATE_TASK_TOOL.inputSchema.fields.description,
  status: CREATE_TASK_TOOL.inputSchema.fields.status,
  priority: CREATE_TASK_TOOL.inputSchema.fields.priority,
  assignee: CREATE_TASK_TOOL.inputSchema.fields.assignee,
  parentTaskId: CREATE_TASK_TOOL.inputSchema.fields.parentTaskId,
  subTaskIds: CREATE_TASK_TOOL.inputSchema.fields.subTaskIds,
  blockedBy: CREATE_TASK_TOOL.inputSchema.fields.blockedBy,
  blocks: CREATE_TASK_TOOL.inputSchema.fields.blocks,
});

/** A task the member makes where none of their workspaces has Task descriptions on: the same, bar its description. */
const { description: _description, ...createTaskFieldsOff } = CreateTaskInputSchema.fields;
const CreateTaskInputSchemaOff = Schema.Struct(createTaskFieldsOff);

/** The words of a member's create, what a task starts with as their workspaces' Task descriptions words it. */
function memberCreateTaskWords(startsWith: string): string {
  return (
    "Make a task in a workspace the member belongs to, as the member's own sidebar New task " +
    `would: owned by them, on the repository named or none, ${startsWith}, and no agent on it; the desktop shows it as one they made. Give ` +
    "it a status, a priority, and an assignee where the member said them. Give it a " +
    "parentTaskId to make it a child task of another, to any depth: a child always works in " +
    "its parent's repository, so leave repository out for one. Give it subTaskIds to make it " +
    "the parent of tasks that have none, and blockedBy and blocks for the tasks it waits on and " +
    `the tasks that wait on it, as ${MEMBER_MCP_TOOL.UPDATE_TASK} names them, all written in the ` +
    "same call: a child that waits on a sibling takes a parentTaskId and a blockedBy. " +
    `${WORKSPACE_WORDS} Then start an agent on it ` +
    `with ${MEMBER_MCP_TOOL.START_AGENT}'s taskId. Each call makes a task of its own, so call ` +
    "it once for each. Answers `accepted` with the task's id, key, name, status, priority, " +
    "assignee, and repository, or `rejected` and why."
  );
}

const MEMBER_CREATE_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_TASK,
  description: memberCreateTaskWords(
    "with their brief and a description to start from where given",
  ),
  input: CreateTaskInputSchema,
  descriptionsOff: {
    description: memberCreateTaskWords("with their brief where given"),
    input: CreateTaskInputSchemaOff,
  },
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateTask(call, asked)),
});

/** A task's pin, in the member's own words. */
const MEMBER_UPDATE_PINNED = Schema.optionalKey(
  describeWire(
    Schema.Boolean,
    "true to pin it in the member's sidebar, false to unpin it; their pin alone, no other " +
      "member's.",
  ),
);

/** A task's sidebar section, in the member's own words. */
const MEMBER_UPDATE_SECTION = Schema.optionalKey(
  describeWire(
    Schema.NullOr(wireUuidSchema),
    "The sidebar section the member keeps it in, by the id " +
      `${MEMBER_MCP_TOOL.LIST_TASKS} or ${MEMBER_MCP_TOOL.CREATE_SECTION} answered; it leaves ` +
      "the section it stood in and lands at the top of this one. null takes it out of its " +
      "section, back under Tasks.",
  ),
);

/** A task's change names what the agents' own does, in the words of the experiments given, the sidebar's words the member's own. */
const updateTaskInputOf = (on: Pick<ExperimentsOn, "descriptionsOn">) =>
  Schema.Struct({
    workspace: TASK_WORKSPACE_INPUT,
    ...updateTaskToolOf(on).inputSchema.fields,
    pinned: MEMBER_UPDATE_PINNED,
    sectionId: MEMBER_UPDATE_SECTION,
  });

/** A task's change names what the agents' own does, the sidebar's words the member's own. */
const UpdateTaskInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  ...UPDATE_TASK_TOOL.inputSchema.fields,
  pinned: MEMBER_UPDATE_PINNED,
  sectionId: MEMBER_UPDATE_SECTION,
});

/** How a member's change of a task words a task it names none of. */
const UPDATE_TASK_WORDS = { opening: "Not run", noTask: UPDATE_TASK_REFUSAL.NO_TASK } as const;

/** What a member's change of a task is told, which names no description. */
const MEMBER_UPDATE_TASK_WORDS =
  "Change a task the member can open, by its id, or by its key in the workspace named, a " +
  "teammate's included, as the member's own " +
  "task menu would: rename it, set or clear its repository, set where it stands (its status) " +
  "or how much it matters (its priority), assign it to a member of its workspace or to no " +
  "one, pin or unpin it in the member's sidebar, move it into one of their sidebar sections " +
  "or back out of it (sectionId), put it under a parent task or take it out from under one, " +
  "or add and take away the tasks it is blocked by and the tasks it blocks; name at least " +
  "one change, and several go in one call. Mark a task whose work is done Done, with status " +
  "done, as the menu's Mark done does; that withdraws every ask still open on its threads, and " +
  `archives every agent on the task, as ${MEMBER_MCP_TOOL.ARCHIVE_AGENT} would but stopping ` +
  "none: an idle one at once, and one at work as its turn ends; Canceled does the same. A change of its status off Done brings those " +
  "agents back, their asks left withdrawn. " +
  "A block is Linear's: the blocker's work comes first and the task it blocks waits on it. " +
  "Both tasks must be in one workspace, a task never blocks itself, and a block that would " +
  "close a cycle is refused. A child task works in its parent's repository, so a parent " +
  "working in another is refused, as is one under which the task would descend from " +
  "itself. Answers `accepted` with the task as it now stands, its parentTaskId, blockedBy, " +
  "and blocks among it where the call changed them, `already` true where every change " +
  "named already stood, or `rejected` and why.";

const MEMBER_UPDATE_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_TASK,
  description: MEMBER_UPDATE_TASK_WORDS,
  input: UpdateTaskInputSchema,
  descriptionsOff: {
    description: MEMBER_UPDATE_TASK_WORDS,
    input: updateTaskInputOf(NO_EXPERIMENT_ON),
  },
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, ...asked }) =>
    writeOnMemberTask({ workspace, taskId: asked.taskId }, UPDATE_TASK_WORDS, (call, taskId) =>
      runUpdateTask(call, { ...asked, taskId }),
    ),
});

const MEMBER_CHANGE_TASK_RELATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CHANGE_TASK_RELATION,
  description:
    "Move one relation between a task the member can open and another task of its workspace " +
    "from the kind it stands in to another, in one step, as the task head's menu changes a " +
    "relation's kind in place: from how the other task stands to the task now (blocked-by, " +
    "blocks, sub-task, or parent) to how it stands once moved, such as a blocker made a " +
    "sub-task, or a block turned around. The old relation is taken away and the new one added " +
    "together, so either both land or neither does; one that did not stand in the kind it " +
    "leaves is left alone, and the new one is added still. A block that would close a cycle " +
    "is refused, as is a parent under which a task would descend from itself, or one working " +
    "in another repository than its child. Answers `accepted` with the task as it now stands, " +
    "its parentTaskId, blockedBy, and blocks among it, `already` true where the relation stood " +
    "as asked, or `rejected` and why.",
  input: Schema.Struct({ workspace: TASK_WORKSPACE_INPUT, ...CHANGE_TASK_RELATION_INPUT.fields }),
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, ...asked }) =>
    writeOnMemberTask({ workspace, taskId: asked.taskId }, UPDATE_TASK_WORDS, (call, taskId) =>
      runChangeTaskRelation(call, { ...asked, taskId }),
    ),
});

/** Why a task was not deleted, in words the agent can act on; the task stands in each. */
const DELETE_TASK_REFUSAL = {
  NO_TASK: `Not deleted: the member can open no task with that id; ${MEMBER_MCP_TOOL.LIST_TASKS} names them.`,
  AT_WORK:
    "Not deleted: an agent of that task is starting or running, and a delete stops none. " +
    `Stop each with ${MEMBER_MCP_TOOL.STOP_AGENT} (${MEMBER_MCP_TOOL.LIST_AGENTS} with the ` +
    "taskId names each agent's status), then delete the task again.",
  UNAVAILABLE:
    "Not deleted: the service could not delete that task just now. The call may be made again.",
} as const;

/** A delete's refusal in the agent's words (`deleteTaskOfStoppedAgents`). */
function deleteTaskRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return DELETE_TASK_REFUSAL.NO_TASK;
    case HOSTED_API_ERROR.AGENT_NOT_READY:
      return DELETE_TASK_REFUSAL.AT_WORK;
    default:
      return DELETE_TASK_REFUSAL.UNAVAILABLE;
  }
}

const DeleteTaskInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: memberTaskInput("The task to delete"),
});

/**
 * `delete_task`: a task deleted as the app's Permanently delete deletes one,
 * on the member's own standing, so the tool deletes what the app lets them
 * delete and nothing more, but stopping no agent (`deleteTaskOfStoppedAgents`):
 * only `stop_agent` stops one.
 */
const MEMBER_DELETE_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_TASK,
  description:
    "Delete a task the member can open for good, by its id, a teammate's included, in " +
    "whichever of the member's workspaces it stands, or by its key in the workspace named, " +
    "as the app's Permanently delete would: " +
    "the task goes with everything on it, its agents and their transcripts among it, and none " +
    "of it can be brought back, while its sub-tasks stay and stand at the top. It stops no agent: while any agent on the task is starting or " +
    `running it is refused, and ${MEMBER_MCP_TOOL.STOP_AGENT} stops each first. A delete ` +
    "refused leaves the task and its agents as they stood. " +
    "Delete one only when the member asks for it, and mark one done or canceled with " +
    `${MEMBER_MCP_TOOL.UPDATE_TASK}'s status where they only want it out of the way. ` +
    "Answers `accepted` with the task's id, or `rejected` and why.",
  input: DeleteTaskInputSchema,
  annotations: DESTRUCTIVE,
  run: (named) =>
    writeOnMemberTask(
      named,
      { opening: "Not deleted", noTask: DELETE_TASK_REFUSAL.NO_TASK },
      (call, taskId) =>
        deleteTaskOfStoppedAgents(callerUserId(call.caller), taskId).pipe(
          Effect.map(() => ({ status: ACTION_RESULT_STATUS.ACCEPTED, taskId })),
          Effect.catch((refusal) =>
            Effect.succeed(agentToolRejected(deleteTaskRefusalWords(refusal))),
          ),
        ),
    ),
});

/** A description's notes name the task and the notetaker's own notes. */
const EditDescriptionInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: memberTaskInput("The task whose description to edit"),
  ...descriptionNotesSchema.fields,
});

const MEMBER_EDIT_DESCRIPTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.EDIT_DESCRIPTION,
  description:
    "Take notes on the description of a task the member can open, by its taskId, its id or its " +
    "key in the workspace named, as the member's own " +
    `edit, which ${MEMBER_MCP_TOOL.READ_TASK} reads first: add a point under one of its ` +
    "headings, or replace text copied exactly from the saved description, as much as names one place, " +
    "headings and whole sections included, with what it becomes, or with nothing to delete " +
    "it. A note's text may open headings of its own, so you can rename, split, merge, move, and " +
    "drop sections. Write a file, a pull request, or an issue a note names as a mention, a " +
    "Markdown link to its page whose words start with @, such as " +
    "[@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so the description draws it as " +
    "a chip. Every save is kept in the description's history as the member's own. A call's notes land " +
    "together or not at all: where one names text or a heading the description does not hold exactly " +
    "once, nothing is saved and the call answers the description as it stands, to retry from. Answers " +
    "`accepted` with how many notes it took, or `rejected` and why.",
  input: EditDescriptionInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false },
  run: ({ workspace, ...asked }) =>
    onMemberTask(
      { workspace, taskId: asked.taskId },
      { opening: "Not saved", noTask: DESCRIPTION_EDIT_REFUSAL.NO_TASK },
      ({ caller }, taskId) =>
        Effect.flatMap(
          experimentOnIn(callerWorkspaceId(caller), EXPERIMENT.DESCRIPTIONS),
          (descriptionsOn) =>
            descriptionsOn
              ? recordMemberDescriptionNotes(
                  { userId: callerUserId(caller), taskId },
                  { ...asked, taskId },
                )
              : Effect.succeed(agentToolRejected(EXPERIMENT_OFF_REFUSAL)),
        ),
    ),
  experiment: EXPERIMENT.DESCRIPTIONS,
});

/*
 * A description's history. Each runs the operation the window's History tab
 * runs through its procedure (`tasks.descriptionRevisions`,
 * `descriptionRevision`, `restoreDescription`): the history read under the
 * member's membership of the task's workspace, and a restore the member's own
 * save, kept as a revision naming the one it brought back.
 */

/** Why a history call answered nothing, in words the agent can act on. */
const DESCRIPTION_HISTORY_REFUSAL = {
  NO_TASK: `Not read: no task the member can open has that id; ${MEMBER_MCP_TOOL.LIST_TASKS} names them.`,
  NO_REVISION: `Not read: the description has no revision of that number; ${MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS} names them.`,
  NOT_RESTORED_NO_TASK: `Not restored: no task the member can open has that id; ${MEMBER_MCP_TOOL.LIST_TASKS} names them.`,
  NOT_RESTORED_NO_REVISION: `Not restored: the description has no revision of that number; ${MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS} names them.`,
  NOT_RESTORED_TOO_LONG: "Not restored: the revision is longer than a description may now be.",
  NOT_RESTORED: "Not restored: the service could not reach its store.",
} as const;

/** What a restore that saved nothing answers, by why. */
const RESTORE_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [DESCRIPTION_SAVE_REFUSAL.NO_TASK, DESCRIPTION_HISTORY_REFUSAL.NOT_RESTORED_NO_TASK],
  [DESCRIPTION_SAVE_REFUSAL.NO_REVISION, DESCRIPTION_HISTORY_REFUSAL.NOT_RESTORED_NO_REVISION],
  [DESCRIPTION_SAVE_REFUSAL.TOO_LONG, DESCRIPTION_HISTORY_REFUSAL.NOT_RESTORED_TOO_LONG],
]);

/** The task whose description's history a call is about. */
const HISTORY_TASK_INPUT = memberTaskInput("The task whose description's history to read");

/** A revision a call names, by its number. */
const revisionSeqInput = (words: string) =>
  describeWire(
    descriptionRevisionSeqSchema,
    `${words}, by the number ${MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS} answered.`,
  );

const ListDescriptionRevisionsInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: HISTORY_TASK_INPUT,
  before: Schema.optionalKey(
    describeWire(
      descriptionRevisionSeqSchema,
      "The earlier a page answered, to read the next older page; leave it out for the newest.",
    ),
  ),
});

const ReadDescriptionRevisionInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: HISTORY_TASK_INPUT,
  seq: revisionSeqInput("The revision to read"),
});

const RestoreDescriptionRevisionInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: memberTaskInput("The task whose description to restore"),
  seq: revisionSeqInput("The revision to put back"),
});

/** Epoch milliseconds as the agent reads a moment. */
const momentOf = (at: number) => new Date(at).toISOString();

/** One revision as the agent reads it: its number, who wrote it, when, how many changes, and the revision it brought back where it is a restore. */
const revisionLineOf = (line: DescriptionRevisionLine) => ({
  seq: line.seq,
  writer: line.lastEdit.actor,
  by: line.lastEdit.by?.name ?? line.lastEdit.label ?? null,
  ...(line.agentId === undefined ? undefined : { agentId: line.agentId }),
  startedAt: momentOf(line.startedAt),
  editedAt: momentOf(line.lastEdit.at),
  changes: line.changes,
  ...(line.restoredFrom === undefined ? undefined : { restoredFrom: line.restoredFrom.seq }),
});

/** A history call run as the member, about the workspace that holds the task as they reach it, refused where that workspace has Task descriptions off. */
const historyAsMember = <R>(
  named: MemberTaskNamed,
  words: MemberTaskWords,
  run: (userId: string, taskId: string) => Effect.Effect<WireRecord, StoreFailure, R>,
) =>
  onMemberTask(named, words, ({ caller }, taskId) =>
    Effect.flatMap(
      experimentOnIn(callerWorkspaceId(caller), EXPERIMENT.DESCRIPTIONS),
      (descriptionsOn) =>
        descriptionsOn
          ? orStoreRefusal(run(callerUserId(caller), taskId))
          : Effect.succeed(agentToolRejected(EXPERIMENT_OFF_REFUSAL)),
    ),
  );

/** How a read of a description's history words a task it names none of. */
const HISTORY_READ_WORDS = {
  opening: "Not read",
  noTask: DESCRIPTION_HISTORY_REFUSAL.NO_TASK,
} as const;

const LIST_DESCRIPTION_REVISIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_DESCRIPTION_REVISIONS,
  description:
    "List the history of a task's description, by its taskId, as its History tab does: every save " +
    "is kept, and saves one writer makes one after another are one revision. Answers the newest " +
    `${DESCRIPTION_HISTORY_BOUNDS.PAGE} revisions first, each with its number (seq), its writer ` +
    "(developer for a member, agent, or earlier for the text from before history began), " +
    "by whom (the member's or the agent's name, null for none), the agentId of an agent's, when it " +
    "began and last moved, how many changes its saves made, and restoredFrom, the revision a " +
    "member's restore brought back; and earlier, which before takes to read the next older page, " +
    `absent on the oldest. ${MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION} reads one revision's text. ` +
    "Answers `accepted` with them, or `rejected` and why.",
  input: ListDescriptionRevisionsInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    historyAsMember(asked, HISTORY_READ_WORDS, (userId, taskId) =>
      Effect.map(listRevisions(userId, taskId, asked.before), (page) => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        revisions: page.revisions.map(revisionLineOf),
        ...(page.earlier === undefined ? undefined : { earlier: page.earlier }),
      })),
    ),
  experiment: EXPERIMENT.DESCRIPTIONS,
});

const READ_DESCRIPTION_REVISION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_DESCRIPTION_REVISION,
  description:
    "Read one revision of a task's description, by its taskId and the revision's number (seq): the " +
    `whole description as it stood after that revision, cut on a line at ${DESCRIPTION_TEXT_READ_CHARS} ` +
    "characters with how many were left out. Read the revision before it, seq less one, to see what " +
    `it changed. Answers \`accepted\` with its text, or \`rejected\` and why.`,
  input: ReadDescriptionRevisionInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    historyAsMember(asked, HISTORY_READ_WORDS, (userId, taskId) =>
      Effect.map(readRevision(userId, taskId, asked.seq), (revision) => {
        if (Option.isNone(revision)) {
          return agentToolRejected(DESCRIPTION_HISTORY_REFUSAL.NO_REVISION);
        }

        const text = cutOnLine(revision.value.description.body, DESCRIPTION_TEXT_READ_CHARS);

        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          revision: { seq: asked.seq, text: text.text, leftOutChars: text.leftOutChars },
        };
      }),
    ),
  experiment: EXPERIMENT.DESCRIPTIONS,
});

const RESTORE_DESCRIPTION_REVISION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RESTORE_DESCRIPTION_REVISION,
  description:
    "Put one revision of a task's description back as its text, by its taskId and the revision's " +
    "number (seq), as the History tab's Restore does: the restore is the member's own save, kept " +
    "as a revision of its own that names the one it brought back, so the text it replaced stays " +
    "in the history, and a restore is undone by restoring the revision before it. Restore one only " +
    "when the member asks for it. Answers `accepted` with the revision restored and whether the " +
    "description changed, false where it already held that text, or `rejected` and why.",
  input: RestoreDescriptionRevisionInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    historyAsMember(
      asked,
      { opening: "Not restored", noTask: DESCRIPTION_HISTORY_REFUSAL.NOT_RESTORED_NO_TASK },
      (userId, taskId) =>
        Effect.map(restoreRevision({ userId, taskId }, asked.seq), (restored) =>
          restored.status === DESCRIPTION_SAVE_STATUS.SAVED
            ? {
                status: ACTION_RESULT_STATUS.ACCEPTED,
                restored: asked.seq,
                changed: restored.txid !== undefined,
              }
            : agentToolRejected(
                RESTORE_REFUSAL_WORDS.get(restored.reason) ??
                  DESCRIPTION_HISTORY_REFUSAL.NOT_RESTORED,
              ),
        ),
    ),
  experiment: EXPERIMENT.DESCRIPTIONS,
});

/** A section the member makes names the workspace it is made in, its title, and its emoji. */
const CreateSectionInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...CREATE_SECTION_TOOL.inputSchema.fields,
});

const MEMBER_CREATE_SECTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_SECTION,
  description:
    "Make a section in the member's sidebar of a workspace they belong to, to keep tasks in: " +
    "it stands in their sidebar alone, as one they made from the sidebar would, with the " +
    `title and the emoji given, and holds no task until ${MEMBER_MCP_TOOL.UPDATE_TASK}'s ` +
    `sectionId moves one in. ${WORKSPACE_WORDS} Answers \`accepted\` with the section's ` +
    "id and title, or `rejected` and why.",
  input: CreateSectionInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateSection(call, asked)),
});

const MEMBER_DELETE_SECTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_SECTION,
  description:
    "Delete one of the member's sidebar sections, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_TASKS} answered it, as their Delete section would: the tasks in it ` +
    "go back under Tasks, and none of them is deleted. Answers `accepted` with the section's " +
    "id and title and how many tasks went back under Tasks, with section null where no such " +
    "section stands, as one already deleted, or `rejected` and why.",
  input: DELETE_SECTION_TOOL.inputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => sectionWorkspace(userId, asked.sectionId),
      { ...NO_SECTION_DELETED },
      (call) => runDeleteSection(call, asked),
    ),
});

/** A start names its task, the agent's own where it starts from one, and what the agents' own start names, bar pictures, since the member keeps no conversation here to hand them from. */
const StartAgentInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: describeWire(
    TASK_REF_INPUT,
    `The task to start the agent on, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered, or by ` +
      "its key, such as ACME-42, with the workspace it stands in; with from, the task of the " +
      "agent it starts from.",
  ),
  prompt: START_AGENT_TOOL.inputSchema.fields.prompt,
  note: START_AGENT_TOOL.inputSchema.fields.note,
  title: START_AGENT_TOOL.inputSchema.fields.title,
  branch: START_AGENT_TOOL.inputSchema.fields.branch,
  ...MEMBER_START_CHOICE_FIELDS,
  from: START_AGENT_TOOL.inputSchema.fields.from,
});

/** A start where none of the member's workspaces has Task descriptions on: the same, its prompt and note in words that name no description. */
const StartAgentInputSchemaOff = Schema.Struct({
  ...StartAgentInputSchema.fields,
  prompt: startAgentToolOf(NO_EXPERIMENT_ON).inputSchema.fields.prompt,
  note: startAgentToolOf(NO_EXPERIMENT_ON).inputSchema.fields.note,
});

type StartAgentInput = typeof StartAgentInputSchema.Type;

/** A start in the workspace of the task it names, by its id or its key in the workspace named. */
const startedAsMember = ({ workspace, ...asked }: StartAgentInput) =>
  writeOnMemberTask(
    { workspace, taskId: asked.taskId },
    { opening: "Not started", noTask: START_AGENT_REFUSAL.NO_SUCH_TASK },
    (call, taskId) => runStartAgent(call, { ...asked, taskId }),
  );

const MEMBER_START_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.START_AGENT,
  description: memberStartAgentWords(
    "on the task's description itself with no prompt, or on the prompt " +
      "given in the description's place, with the note after either",
  ),
  input: StartAgentInputSchema,
  descriptionsOff: {
    description: memberStartAgentWords("on the prompt given, with the note after it"),
    input: StartAgentInputSchemaOff,
  },
  annotations: ADDITIVE,
  run: startedAsMember,
});

/** The words of a member's start, how it is handed what it is told as their workspaces' Task descriptions words it. */
function memberStartAgentWords(handed: string): string {
  return (
    "Start a new coding agent as the member: on a task " +
    `they can open by its taskId, ${handed}; make a task for it first with ` +
    `${MEMBER_MCP_TOOL.CREATE_TASK}. ${START_LEAVES_TASK_WORDS} ${START_PAYER_WORDS} ` +
    "This one call carries everything the agent is told as it starts, and the " +
    "agent sets to work on it at once. Its checkout is the branch named, which must already " +
    "be on GitHub, and every start on a task with a repository but one from another agent " +
    `names it; ${MEMBER_MCP_TOOL.LIST_REPOSITORIES} answers each one's defaultBranch. ` +
    "It runs on the model and effort " +
    "named, as the member is offered them, which every start names but one with from; " +
    `${MEMBER_MCP_TOOL.LIST_MODELS} lists them. With from, it starts from another agent ` +
    "instead: continue an agent that failed, ended, or ran out of context with mode continue, " +
    "which hands it over and stops it, or fork one with mode fork at a messageId to try " +
    "another direction while it goes on. " +
    "Each call starts an agent of its own, so call it once for each. Answers `accepted` with " +
    "the agent's id, title, model, the model's name to say it by, effort, and status once " +
    "its session is open, which may take a minute or two, or `rejected` and why nothing was " +
    `started; a rejected model or effort lists the choices. ${FOLLOW_WORDS}`
  );
}

const AgentIdInputSchema = Schema.Struct({ agentId: ReadAgentInputSchema.fields.agentId });

const MessageAgentInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(AGENT_BOUNDS.MAX_MESSAGE_CHARS)),
    "What to tell the agent, as the member's own words: it reads them as a message the member " +
      "typed in its composer.",
  ),
  queue: describeWire(
    Schema.Boolean,
    "false to steer it into the turn under way, as the composer's ↩ would, or start a turn on " +
      "an idle agent; true to queue it behind the agent's turn, as the composer's ⌘↩ would: it " +
      "waits unsent, and goes as the member's next message once the turn and every message " +
      "queued before it are over, at once where the agent stands idle. Any member who may " +
      "message the agent queues to it.",
  ),
});

type MessageAgentInput = typeof MessageAgentInputSchema.Type;

/** What a queued message came to: waiting behind the turn, or handed on at once to an agent standing idle. */
const MEMBER_QUEUE_DELIVERY = {
  QUEUED: "queued",
  HANDED_ON: "handed-on",
} as const;

/** Why a queued message was not queued, in the member's tool's words: an agent only its starter messages, a full queue, or the service. */
const QUEUE_MESSAGE_REFUSAL = {
  NOT_STARTER:
    "Not queued: that agent runs on its starter's own GitHub token or Mac, so only the member " +
    "who started it queues to it.",
  FULL: `Not queued: that agent's queue already holds ${AGENT_QUEUE_BOUNDS.MAX_MESSAGES} messages.`,
  UNAVAILABLE: "Not queued: the service could not take the message just now.",
} as const;

/** The words for a refusal of the queue change. */
function queueRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return QUEUE_MESSAGE_REFUSAL.NOT_STARTER;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return QUEUE_MESSAGE_REFUSAL.FULL;
    case HOSTED_API_ERROR.NOT_FOUND:
      return MESSAGE_AGENT_REFUSAL.NO_AGENT;
    default:
      return QUEUE_MESSAGE_REFUSAL.UNAVAILABLE;
  }
}

/**
 * One message queued as the member behind the agent's turn, through the
 * change their composer's ⌘↩ makes (`changeAgentQueue`), under the call's
 * key as its id: answered with how many messages wait before it goes.
 */
const memberQueue = (call: AgentCall, userId: string, agent: Agent, text: string) =>
  Effect.gen(function* () {
    const id = call.clientKey;

    const queued = yield* Effect.result(
      changeAgentQueue(userId, agent, { change: QUEUE_CHANGE.ADD, id, text }),
    );

    if (Result.isFailure(queued)) return agentToolRejected(queueRefusalWords(queued.failure));
    const place = queued.success.messages.findIndex((message) => message.id === id);

    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      delivery: place === -1 ? MEMBER_QUEUE_DELIVERY.HANDED_ON : MEMBER_QUEUE_DELIVERY.QUEUED,
      ...(place === -1 ? undefined : { ahead: place }),
      ...(queued.success.paused === undefined ? undefined : { paused: queued.success.paused }),
      agent: { id: agent.id, title: agentName(agent), model: agent.model },
    };
  });

/**
 * One message as the member, to an agent of the workspace the call is about:
 * refused for an agent that is none of it or is archived, and otherwise the
 * member's own send, which refuses an agent it may not write to, in the words
 * the agents' own message is refused in.
 */
const memberMessage = (call: AgentCall, { agentId, text, queue }: MessageAgentInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const { agent } = found.value;

      if (agent.archivedAt !== null) return agentToolRejected(MESSAGE_AGENT_REFUSAL.ARCHIVED);
      const userId = callerUserId(call.caller);
      // A queued message goes on to an idle agent at once, so it is refused as a sent one is.
      const settled = yield* settledTaskRefusal(userId, agent.taskId);

      if (Option.isSome(settled)) return agentToolRejected(settled.value);

      if (queue) return yield* memberQueue(call, userId, agent, text);

      const sent = yield* Effect.result(
        steerMemberWords(call.writer, userId, agent, { text, clientKey: call.clientKey }),
      );

      if (Result.isFailure(sent)) return agentToolRejected(messageRefusalWords(sent.failure));

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        delivery: sent.success.outcome,
        agent: { id: agent.id, title: agentName(agent), model: agent.model },
      };
    }),
  );

const MEMBER_MESSAGE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.MESSAGE_AGENT,
  description:
    "Send a coding agent the member can see a message, by its id, as the member's own words, " +
    "as their composer would: it lands in the agent's conversation under the member's name, " +
    "and a teammate's agent reads it under the member's label. A running agent reads it at " +
    "its next step, and an idle one starts a turn on it; an archived agent is refused, since a " +
    `tool never brings one back: bring it back with ${MEMBER_MCP_TOOL.UNARCHIVE_AGENT} first; and ` +
    "one whose task is done or canceled is refused, since a tool never reopens a task: move " +
    `the task with ${MEMBER_MCP_TOOL.UPDATE_TASK} first. Each ` +
    "call sends a message of its own, so call it once for each. Answers `accepted` once the " +
    "agent's session has taken it, without waiting for it to act or reply, or `rejected` and " +
    "why nothing was sent. With queue true, it waits behind the agent's turn instead, and answers " +
    "`accepted` with `delivery` `queued` and how many messages stand `ahead` of it, or " +
    `\`handed-on\` where the agent stood idle and it goes at once, unconfirmed, since a refusal puts it back and pauses the queue; and \`paused\` with why where ` +
    `the queue stands paused, which sends nothing until ${MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE} resumes it. ` +
    FOLLOW_WORDS,
  input: MessageAgentInputSchema,
  annotations: ADDITIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      MESSAGE_AGENT_REFUSAL.NO_AGENT,
      (call) => memberMessage(call, asked),
    ),
});

/** A queued message, by the id `read_agent`'s queue lists it by. */
const QUEUED_MESSAGE_ID_INPUT = describeWire(
  wireUuidSchema,
  `The queued message's id, as ${MEMBER_MCP_TOOL.READ_AGENT}'s queue lists it.`,
);

/** A queued message's new words, which replace its own and the files it carried. */
const QUEUED_WORDS_INPUT = describeWire(
  MessageAgentInputSchema.fields.text,
  "Its new words, as the member's own: they replace its words, and it goes without the files " +
    "it carried.",
);

/** A change to an agent's queue, by its kind, as the member's queue controls make it: every kind but a message added, which `message_agent`'s queue adds. */
const MemberQueueChangeSchema = Schema.Union([
  Schema.Struct({ change: Schema.Literal(QUEUE_CHANGE.RESUME) }),
  Schema.Struct({
    change: Schema.Literal(QUEUE_CHANGE.HOLD),
    messageId: QUEUED_MESSAGE_ID_INPUT,
    held: describeWire(
      Schema.Boolean,
      "true to hold it, as the member's Edit does, so the queue sends what stands ahead of it " +
        "and nothing from it on; false to let it go again.",
    ),
  }),
  Schema.Struct({
    change: Schema.Literal(QUEUE_CHANGE.EDIT),
    messageId: QUEUED_MESSAGE_ID_INPUT,
    text: QUEUED_WORDS_INPUT,
  }),
  Schema.Struct({
    change: Schema.Literal(QUEUE_CHANGE.DELETE),
    messageId: QUEUED_MESSAGE_ID_INPUT,
  }),
  Schema.Struct({
    change: Schema.Literal(QUEUE_CHANGE.REORDER),
    order: describeWire(
      Schema.Array(wireUuidSchema).check(Schema.isMaxLength(AGENT_QUEUE_BOUNDS.MAX_MESSAGES)),
      "Every message the queue holds, by its id, each once, in the order they are to go.",
    ),
  }),
  Schema.Struct({
    change: Schema.Literal(QUEUE_CHANGE.STEER),
    messageId: QUEUED_MESSAGE_ID_INPUT,
    text: Schema.optionalKey(QUEUED_WORDS_INPUT),
  }),
]);

const ChangeAgentQueueInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  change: describeWire(
    MemberQueueChangeSchema,
    "The change: resume the paused queue; hold a message or let it go; edit its words; " +
      "delete it; reorder the queue; or steer a message into the turn under way now, with new " +
      "words or as it stands.",
  ),
});

type ChangeAgentQueueInput = typeof ChangeAgentQueueInputSchema.Type;

/** Why a queue change changed nothing, in the member's tool's words. */
const CHANGE_QUEUE_REFUSAL = {
  NOT_STARTER:
    "Not changed: that agent runs on its starter's own GitHub token or Mac, so only the member " +
    "who started it changes its queue.",
  NO_MESSAGE:
    "Not changed: that agent's queue holds no message of that id; it may have gone already. " +
    `${MEMBER_MCP_TOOL.READ_AGENT} lists the queue.`,
  BAD_ORDER:
    "Not changed: name every message the queue holds, each once, in the order they are to go; " +
    `${MEMBER_MCP_TOOL.READ_AGENT} lists them.`,
  UNAVAILABLE: "Not changed: the service could not change the queue just now; try again.",
} as const;

/** The words for a refusal of a queue change. */
function changeQueueRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return CHANGE_QUEUE_REFUSAL.NOT_STARTER;
    case HOSTED_API_ERROR.NOT_FOUND:
      return CHANGE_QUEUE_REFUSAL.NO_MESSAGE;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return CHANGE_QUEUE_REFUSAL.BAD_ORDER;
    default:
      return CHANGE_QUEUE_REFUSAL.UNAVAILABLE;
  }
}

/**
 * One change to an agent's queue as the member, through the change their
 * queue controls make (`changeAgentQueue`): refused for an agent of no
 * workspace of the call's or an archived one, as a message is, and
 * answered with the queue as it then stands.
 */
const memberQueueChange = (call: AgentCall, { agentId, change }: ChangeAgentQueueInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const { agent } = found.value;

      if (agent.archivedAt !== null) return agentToolRejected(MESSAGE_AGENT_REFUSAL.ARCHIVED);
      const userId = callerUserId(call.caller);
      // Any change hands the next message on to an idle agent, so none is made while its task stands settled.
      const settled = yield* settledTaskRefusal(userId, agent.taskId);

      if (Option.isSome(settled)) return agentToolRejected(settled.value);

      const changed = yield* Effect.result(changeAgentQueue(userId, agent, change));

      if (Result.isFailure(changed)) {
        return agentToolRejected(changeQueueRefusalWords(changed.failure));
      }

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        queue: queueRecord(changed.success),
        agent: { id: agent.id, title: agentName(agent), model: agent.model },
      };
    }),
  );

const CHANGE_AGENT_QUEUE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE,
  description:
    "Change the queue of a coding agent the member may message, by its id, as their queue " +
    `controls would: the messages ${MEMBER_MCP_TOOL.MESSAGE_AGENT}'s queue left waiting behind ` +
    `its turn, which ${MEMBER_MCP_TOOL.READ_AGENT} lists by id. Resume a queue a Stop, a ` +
    "failed turn, or a refused hand-off paused; hold a message, so the queue stops at it, or " +
    "let it go; edit its words; delete it; reorder the queue; or steer a message into the turn " +
    "under way now, which takes it out of the queue. Any member who may message the agent " +
    "changes any message in its queue, whoever queued it. Where the agent stands idle, every change " +
    "but a delete hands the next message on at once, as a turn's end would, a steer starting a " +
    "turn with its message, so an agent whose task is done or canceled is refused: move the task " +
    `with ${MEMBER_MCP_TOOL.UPDATE_TASK} first. ` +
    "Answers `accepted` with the queue as it then stands, or `rejected` and " +
    `why nothing changed. ${FOLLOW_WORDS}`,
  input: ChangeAgentQueueInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      MESSAGE_AGENT_REFUSAL.NO_AGENT,
      (call) => memberQueueChange(call, asked),
    ),
});

const MEMBER_STOP_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.STOP_AGENT,
  description:
    "Stop a coding agent the member can see, by its id, as their Stop button would: its turn " +
    "under way is canceled and its status reads canceled, while the agent stays available, its " +
    "transcript and branch kept, and a later message starts a new turn. Answers `accepted` " +
    "with the agent's status now and whether it was stopped, " +
    "`stopped` false for an agent already idle, or `rejected` and why. Every stop also cancels " +
    "the agent's booked wakeup and pauses its queue until " +
    `${MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE} resumes it, an idle agent's included. ` +
    `${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT} reads where it stopped.`,
  input: AgentIdInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runStopAgent(call, asked),
    ),
});

/** A change to an agent names what the agents' own does, the sidebar's and the archive's words the member's own. */
const UpdateAgentInputSchema = Schema.Struct({
  ...UPDATE_AGENT_TOOL.inputSchema.fields,
  agentId: AgentIdInputSchema.fields.agentId,
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "Whether the member keeps it pinned in their sidebar, the pin theirs alone.",
    ),
  ),
});

const MEMBER_UPDATE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_AGENT,
  description:
    "Change a coding agent the member can see, by its id, as the member's own menu, model " +
    "chip, and composer would: rename it (empty clears the title), move it to another model " +
    `and effort, and context window, from its next step, as ${MEMBER_MCP_TOOL.LIST_MODELS} ` +
    "lists them, pin or unpin it in the member's sidebar, or replace the list of MCP servers " +
    "switched off for it. Name at least one change, a model only with its effort and a " +
    "contextWindow only with them, required where the model's " +
    `${MEMBER_MCP_TOOL.LIST_MODELS} contextWindows are not empty; the changes land together ` +
    `or not at all. Archive it with ${MEMBER_MCP_TOOL.ARCHIVE_AGENT}. Answers \`accepted\` with ` +
    "the agent as it then stands, or `rejected` and why; a rejected model or effort lists the choices.",
  input: UpdateAgentInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runUpdateAgent(call, asked),
    ),
});

/** An archive names the agent and why, which its archived banner shows beside the member's name. */
const ArchiveAgentInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  reason: describeWire(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS),
    ),
    "Why it is archived, in a short sentence its archived banner shows beside the member's " +
      "name, such as its pull request having merged.",
  ),
});

const MEMBER_ARCHIVE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.ARCHIVE_AGENT,
  description:
    "Archive a coding agent the member can see, by its id, as the member's own Archive agent " +
    "would, the archive recorded as the member's own: it is stopped first, as " +
    `${MEMBER_MCP_TOOL.STOP_AGENT} would, an idle one too, and its open asks are withdrawn; then ` +
    "it leaves the sidebar, its " +
    "task's tabs, and every list but the archived ones, takes no message, and is not woken, its " +
    "transcript, branch, and pull request kept, but one on a member's device has its folder " +
    "removed there, so what it never pushed is lost. One still starting is refused until it can be " +
    `stopped. ${MEMBER_MCP_TOOL.UNARCHIVE_AGENT} brings it back. Answers \`accepted\` with the ` +
    "agent as it then stands, archived among it, or `rejected` and why.",
  input: ArchiveAgentInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runArchiveAgent(call, asked),
    ),
});

const MEMBER_UNARCHIVE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UNARCHIVE_AGENT,
  description:
    "Bring an archived coding agent the member can see back, by its id, as the member's own " +
    "Unarchive would: it stands in its task's lists again and takes messages, its archive's " +
    "record cleared; it starts no turn, the asks its archive withdrew stay withdrawn, and the " +
    `queue its archive paused stays paused until ${MEMBER_MCP_TOOL.CHANGE_AGENT_QUEUE} resumes it. ` +
    "Answers `accepted` with the agent as it then stands, archived among it, or `rejected` and why.",
  input: AgentIdInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runUnarchiveAgent(call, asked),
    ),
});

// A workspace, its members, and its invitations, through the operations the hosted procedures run (`../accounts/workspace-operations.ts`, `workspace-member-operations.ts`, `workspace-invitation-operations.ts`), as the member.

/** What a workspace call's refusals say, by the error its operation refused with; any other is `WORKSPACE_UNANSWERED`. */
type WorkspaceRefusalWords = { readonly [Error in HostedApiError]?: string };

/** A workspace call refused for no reason of the member's. */
const WORKSPACE_UNANSWERED =
  "Not run: the workspace could not be read just now. The call may be made again.";

/** A member named by an account id the workspace does not hold. */
const NO_SUCH_MEMBER = `nobody of that account id is a member of the workspace; ${MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS} names them.`;

/** Why a slug change was refused, in words the agent can act on. */
const SLUG_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]: "Not changed: only the workspace's owner may change its slug.",
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: `Not changed: a slug is lowercase letters and digits, with single hyphens between them, at most ${WORKSPACE_BOUNDS.MAX_SLUG_CHARS} characters.`,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: `Not changed: that slug is reserved by ${PRODUCT_NAME}; choose another.`,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]:
    "Not changed: another workspace holds or held that slug; choose another.",
} as const satisfies WorkspaceRefusalWords;

/** Why a rename was refused. */
const RENAME_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not renamed: only the workspace's owner or an admin may rename it, and an account's " +
    "first workspace, named for its owner, is never renamed.",
} as const satisfies WorkspaceRefusalWords;

/** Why a member's removal was refused. */
const REMOVE_MEMBER_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not removed: the owner removes an admin or a member, and an admin a member alone; " +
    "nobody removes the owner, or themselves, whose way out is leaving.",
  [HOSTED_API_ERROR.NOT_FOUND]: `Not removed: ${NO_SUCH_MEMBER}`,
} as const satisfies WorkspaceRefusalWords;

/** Why a role change was refused. */
const MEMBER_ROLE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not changed: only the workspace's owner gives a role, and never to themselves.",
  [HOSTED_API_ERROR.NOT_FOUND]: `Not changed: ${NO_SUCH_MEMBER}`,
} as const satisfies WorkspaceRefusalWords;

/** Why an invitations read was refused. */
const INVITATIONS_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not read: only the workspace's owner or an admin reads its invitations.",
} as const satisfies WorkspaceRefusalWords;

/** Why an invitation was refused. */
const INVITE_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not invited: only the workspace's owner or an admin invites, the owner alone as an admin; " +
    "or the address is not one an invitation may go to; or the workspace already holds as many " +
    "pending invitations as it may.",
  [HOSTED_API_ERROR.ALREADY_INVITED]:
    "Not invited: that address is already a member's, or already holds a pending invitation.",
} as const satisfies WorkspaceRefusalWords;

/** Why an invitation's cancel was refused. */
const CANCEL_INVITATION_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not canceled: only the workspace's owner or an admin cancels its invitations.",
  [HOSTED_API_ERROR.NOT_FOUND]: `Not canceled: no pending invitation of the workspace has that id; ${MEMBER_MCP_TOOL.LIST_WORKSPACE_INVITATIONS} lists them.`,
} as const satisfies WorkspaceRefusalWords;

/** Why a photo change was refused. */
const PHOTO_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "Not changed: only the workspace's owner or an admin may set its photo.",
} as const satisfies WorkspaceRefusalWords;

/** An operation on the workspace a slug names, as the member; refused in the agent's words. */
const workspaceAsMember = <A extends WireRecord, R>(
  slug: string,
  refusalWords: WorkspaceRefusalWords,
  operation: (
    member: AdmittedMemberValues,
    workspaceId: string,
  ) => Effect.Effect<A, HostedRefusal, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);

    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);

    return yield* operation(member, workspace.success).pipe(
      Effect.map(
        (answered): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answered }),
      ),
      Effect.catch((refusal) =>
        Effect.succeed(agentToolRejected(refusalWords[refusal.error] ?? WORKSPACE_UNANSWERED)),
      ),
    );
  });

/** The members as a tool answers them, owners first, then admins, then members. */
function membersAnswered(
  members: readonly {
    readonly userId: string;
    readonly name: string;
    readonly email: string;
    readonly role: string;
  }[],
) {
  return members.map(({ userId, name, email, role }) => ({ userId, name, email, role }));
}

/** The origin an invitation's accept link is on: the deployment's own, as the hosted procedure's is the request's. */
function invitationOrigin(member: AdmittedMemberValues): string {
  return new URL(member.baseURL).origin;
}

const ListWorkspaceMembersInputSchema = Schema.Struct({ workspace: WORKSPACE_INPUT });

const LIST_WORKSPACE_MEMBERS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS,
  description:
    "List the members of a workspace the member you act for belongs to, as its Settings › " +
    "Members page shows them, owners first, then admins, then members: each with their " +
    "account id, name, email, and role (owner, admin, or member), and, as former, whoever the " +
    "workspace's tasks and agents still name but left it, by account id and name. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with them, or \`rejected\` and why.`,
  input: ListWorkspaceMembersInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    workspaceAsMember(workspace, {}, ({ userId }, workspaceId) =>
      Effect.map(workspaceMembersRead(userId, workspaceId), ({ members, former }) => ({
        members: membersAnswered(members),
        ...(former !== undefined && {
          former: former.map(({ userId: id, name }) => ({ userId: id, name })),
        }),
      })),
    ),
});

const SetWorkspaceSlugInputSchema = Schema.Struct({
  workspace: workspaceInput("whose slug to change"),
  slug: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(WORKSPACE_BOUNDS.MAX_SLUG_CHARS)),
    "The new slug: lowercase letters and digits, with single hyphens between them.",
  ),
});

const SET_WORKSPACE_SLUG_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SET_WORKSPACE_SLUG,
  description:
    "Change the slug of a workspace the member you act for owns, the first step of its links, " +
    "as its Settings › General page would. Only the owner may. A link written under the old " +
    "slug still opens it, since a slug the workspace stood under stays its own, and no other " +
    "workspace may take a slug one holds or held. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the workspace under its new slug, or ` +
    "`rejected` and why: not the owner, or a slug that is malformed, reserved, or taken.",
  input: SetWorkspaceSlugInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, slug }) =>
    workspaceAsMember(workspace, SLUG_REFUSAL_WORDS, ({ userId }, workspaceId) =>
      Effect.map(workspaceSlugSet(userId, workspaceId, slug), ({ workspace: changed }) => ({
        workspace: { id: changed.id, slug: changed.slug ?? slug, name: changed.name },
      })),
    ),
});

const RenameWorkspaceInputSchema = Schema.Struct({
  workspace: workspaceInput("to rename"),
  name: describeWire(
    workspaceRenameRequestSchema.fields.name,
    `The new name, at most ${WORKSPACE_BOUNDS.MAX_NAME_CHARS} characters.`,
  ),
});

const RENAME_WORKSPACE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RENAME_WORKSPACE,
  description:
    "Rename a workspace the member you act for owns or is an admin of, as its Settings › " +
    "General page would. An account's first workspace is named for its owner and is never " +
    "renamed. The slug stays as it stood, so every link still opens it. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the workspace under its new name, or ` +
    "`rejected` and why.",
  input: RenameWorkspaceInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, name }) =>
    workspaceAsMember(workspace, RENAME_REFUSAL_WORDS, ({ userId }, workspaceId) =>
      Effect.map(workspaceRename(userId, workspaceId, name), ({ workspace: renamed }) => ({
        workspace: {
          id: renamed.id,
          name: renamed.name,
          ...(renamed.slug !== undefined && { slug: renamed.slug }),
        },
      })),
    ),
});

/** The member a removal or a role change acts on, by account id. */
const MEMBER_USER_ID_INPUT = describeWire(
  workspaceMemberRemovalSchema.fields.userId,
  `The member's account id, as ${MEMBER_MCP_TOOL.LIST_WORKSPACE_MEMBERS} answered it.`,
);

const RemoveWorkspaceMemberInputSchema = Schema.Struct({
  workspace: workspaceInput("to remove them from"),
  userId: MEMBER_USER_ID_INPUT,
});

const REMOVE_WORKSPACE_MEMBER_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REMOVE_WORKSPACE_MEMBER,
  description:
    "Remove another member from a workspace, as its Settings › Members page would: the owner " +
    "removes an admin or a member, and an admin a member alone. Nobody removes the owner, or " +
    "themselves, whose way out is leaving in the app. The one removed loses the workspace at " +
    "once, and stays named on the tasks they were on as a former member. Coming back takes a new " +
    `invitation. ${WORKSPACE_WORDS} Answers \`accepted\` with the members as they then ` +
    "stand, or `rejected` and why.",
  input: RemoveWorkspaceMemberInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, userId: removed }) =>
    workspaceAsMember(workspace, REMOVE_MEMBER_REFUSAL_WORDS, ({ userId }, workspaceId) =>
      Effect.map(workspaceMemberRemove(userId, workspaceId, removed), ({ members }) => ({
        members: membersAnswered(members),
      })),
    ),
});

const ChangeWorkspaceMemberRoleInputSchema = Schema.Struct({
  workspace: workspaceInput("the member is in"),
  userId: MEMBER_USER_ID_INPUT,
  role: describeWire(
    workspaceMemberRoleSchema.fields.role,
    "The role they take: admin, who manages the workspace's members and settings beside the " +
      "owner, or member.",
  ),
});

const CHANGE_WORKSPACE_MEMBER_ROLE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CHANGE_WORKSPACE_MEMBER_ROLE,
  description:
    "Make another member of a workspace the member you act for owns an admin, or an admin a " +
    "member, as its Settings › Members page would. Only the owner may, and never of " +
    `themselves. ${WORKSPACE_WORDS} Answers \`accepted\` with the members as they then stand, ` +
    "or `rejected` and why.",
  input: ChangeWorkspaceMemberRoleInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, userId: changed, role }) =>
    workspaceAsMember(workspace, MEMBER_ROLE_REFUSAL_WORDS, ({ userId }, workspaceId) =>
      Effect.map(workspaceMemberRoleChange(userId, workspaceId, changed, role), ({ members }) => ({
        members: membersAnswered(members),
      })),
    ),
});

const ListWorkspaceInvitationsInputSchema = Schema.Struct({
  workspace: workspaceInput("whose invitations to list"),
});

const LIST_WORKSPACE_INVITATIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_WORKSPACE_INVITATIONS,
  description:
    "List the pending invitations of a workspace the member you act for owns or is an admin " +
    "of, as its Settings › Members page shows them, soonest to expire first: each with its id, " +
    "the address it was sent to, the role it offers, when it expires, and its accept link, " +
    `which only the invited address's account accepts. ${WORKSPACE_WORDS} Answers ` +
    "`accepted` with them, or `rejected` and why.",
  input: ListWorkspaceInvitationsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    workspaceAsMember(workspace, INVITATIONS_REFUSAL_WORDS, (member, workspaceId) =>
      workspaceInvitationsRead(member.userId, workspaceId, invitationOrigin(member)),
    ),
});

const InviteToWorkspaceInputSchema = Schema.Struct({
  workspace: workspaceInput("to invite them to"),
  email: describeWire(
    workspaceInviteRequestSchema.fields.email,
    "The address to invite, whose account alone may accept.",
  ),
  role: describeWire(
    workspaceInviteRequestSchema.fields.role,
    "The role it offers: member, or admin, which only the owner may offer.",
  ),
});

const INVITE_TO_WORKSPACE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.INVITE_TO_WORKSPACE,
  description:
    "Invite an address to a workspace the member you act for owns or is an admin of, as its " +
    "Settings › Members page would: the owner may invite an admin, and an owner or an admin a " +
    "member. The invitation is emailed to the address where the deployment sends mail, and " +
    "expires in 48 hours. Only the invited address's account accepts it. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the invitation and its accept link, to ` +
    "hand on where no email goes, or `rejected` and why: not permitted, or the address is " +
    "already a member's or already invited.",
  input: InviteToWorkspaceInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, email, role }) =>
    workspaceAsMember(workspace, INVITE_REFUSAL_WORDS, (member, workspaceId) =>
      workspaceInvite(member.userId, { workspaceId, email, role }, invitationOrigin(member)),
    ),
});

const CancelWorkspaceInvitationInputSchema = Schema.Struct({
  workspace: workspaceInput("the invitation is to"),
  invitationId: describeWire(
    workspaceInvitationCancelSchema.fields.invitationId,
    `The invitation's id, as ${MEMBER_MCP_TOOL.LIST_WORKSPACE_INVITATIONS} answered it.`,
  ),
});

const CANCEL_WORKSPACE_INVITATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CANCEL_WORKSPACE_INVITATION,
  description:
    "Cancel a pending invitation to a workspace the member you act for owns or is an admin " +
    "of, as its Settings › Members page would, so its accept link stops working. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the invitations still pending, or ` +
    "`rejected` and why.",
  input: CancelWorkspaceInvitationInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, invitationId }) =>
    workspaceAsMember(workspace, CANCEL_INVITATION_REFUSAL_WORDS, (member, workspaceId) =>
      workspaceInvitationCancel(member.userId, workspaceId, invitationId, invitationOrigin(member)),
    ),
});

/** A photo set names the workspace and the photo, as a `data:` URL the window would send, or null to remove it. */
const SetWorkspacePhotoInputSchema = Schema.Struct({
  workspace: workspaceInput("whose photo to set"),
  photo: describeWire(
    workspacePhotoSetRequestSchema.fields.photo,
    `The photo as a base64 \`data:\` URL of a PNG, JPEG, or WebP image ` +
      `(${Object.values(WORKSPACE_PHOTO_TYPE).join(", ")}), at most ${WORKSPACE_PHOTO_BOUNDS.MAX_BYTES} bytes decoded, such as a 256-pixel ` +
      "square; null removes it, and the member's own first workspace then shows their sign-in picture.",
  ),
});

const SET_WORKSPACE_PHOTO_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SET_WORKSPACE_PHOTO,
  description:
    "Set or remove the photo of a workspace the member you act for belongs to, the picture " +
    "beside its name in the sidebar and the workspace switcher, as its Settings › General page " +
    "would. Only its owner or an admin may. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the workspace and its photo's new version, ` +
    "null once removed, or `rejected` and why.",
  input: SetWorkspacePhotoInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, photo }) =>
    workspaceAsMember(workspace, PHOTO_REFUSAL_WORDS, ({ userId }, workspaceId) =>
      Effect.map(workspacePhotoSet(userId, workspaceId, photo), ({ workspace: changed }) => ({
        workspace: {
          id: changed.id,
          slug: changed.slug ?? null,
          name: changed.name,
          photoVersion: changed.photoVersion ?? null,
        },
      })),
    ),
});

/*
 * An agent rewound, deleted, and woken, through the one operation each that
 * the hosted `agents` procedures run (`../agents/agent-lifecycle.ts`), as
 * the admitted member: each reaches the agent as the member's own window
 * does, and refuses what it refuses.
 */

/** What a lifecycle call does, as its refusal says it was not done. */
const LIFECYCLE_VERB = { REWOUND: "rewound", DELETED: "deleted", WOKEN: "woken" } as const;

type LifecycleVerb = (typeof LIFECYCLE_VERB)[keyof typeof LIFECYCLE_VERB];

/** Why an agent was not rewound, deleted, or woken, in words for one acting for the member. */
const AGENT_LIFECYCLE_REFUSAL = {
  NO_AGENT: AGENT_TOOL_REFUSAL.NO_AGENT,
  NO_LINE:
    "Not rewound: that agent is none the member can see, is archived, or holds no line of " +
    `that lineId; ${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT} names each line's lineId.`,
  INSIDE_TURN:
    "Not rewound: that line was sent while a turn was working, so the agent cannot be taken " +
    "back to just before it; name a line that opened a turn.",
  STARTER_ONLY: (verb: string) =>
    `Not ${verb}: only the member who started that agent may do that, since it runs on their ` +
    "own GitHub token, subscription, or Mac.",
  AT_WORK: (verb: string) =>
    `Not ${verb}: the agent is starting or running, and this stops nothing. Stop it with ` +
    `${MEMBER_MCP_TOOL.STOP_AGENT}, then call this again.`,
  RETIRED: "Not woken: that agent is archived, and an archived agent's sandbox is not woken.",
  SNAPSHOT_GONE: "Not woken: the sandbox's snapshot is gone, so nothing can resume it.",
  UNAVAILABLE: (verb: string) =>
    `Not ${verb}: the service could not do it just now. The call may be made again.`,
} as const;

/** A refusal of the lifecycle operations in the words above, by what was asked. */
function lifecycleRefusalWords(refusal: HostedRefusal, verb: LifecycleVerb) {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return verb === LIFECYCLE_VERB.REWOUND
        ? AGENT_LIFECYCLE_REFUSAL.NO_LINE
        : AGENT_LIFECYCLE_REFUSAL.NO_AGENT;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return AGENT_LIFECYCLE_REFUSAL.INSIDE_TURN;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return AGENT_LIFECYCLE_REFUSAL.STARTER_ONLY(verb);
    case HOSTED_API_ERROR.AGENT_NOT_READY:
      return AGENT_LIFECYCLE_REFUSAL.AT_WORK(verb);
    case HOSTED_API_ERROR.AGENT_RETIRED:
      return AGENT_LIFECYCLE_REFUSAL.RETIRED;
    case HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE:
      return AGENT_LIFECYCLE_REFUSAL.SNAPSHOT_GONE;
    default:
      return AGENT_LIFECYCLE_REFUSAL.UNAVAILABLE(verb);
  }
}

/** One lifecycle operation run as the admitted member, its refusal answered in the words above. */
const lifecycleAsMember = <R>(
  verb: LifecycleVerb,
  run: (userId: string) => Effect.Effect<WireRecord, HostedRefusal, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;

    return yield* run(member.userId).pipe(
      Effect.catch((refusal) =>
        Effect.succeed(agentToolRejected(lifecycleRefusalWords(refusal, verb))),
      ),
    );
  });

const RewindAgentInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  lineId: describeWire(
    agentRewindRequestSchema.fields.messageId,
    `The line to take the agent back to just before, by the lineId ` +
      `${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT} names on a line sent to the agent.`,
  ),
});

const REWIND_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REWIND_AGENT,
  description:
    "Rewind a coding agent the member can see, by its id, as the member's own Rewind would: " +
    "it is taken back to just before one of the lines sent to it, as though that line and " +
    "everything after it were never said, the workers it started since deleted. It stops no " +
    `turn: an agent starting or running is refused, and ${MEMBER_MCP_TOOL.STOP_AGENT} stops it ` +
    "first; it cancels a wakeup the agent booked and ends its idle runner. Its checkout " +
    "and branch are left as they stand: only the conversation goes back. Name the line by the " +
    `lineId ${MEMBER_MCP_TOOL.READ_AGENT_TRANSCRIPT} names on it; a line sent while a turn was working is ` +
    "refused. Only the member who started an agent rewinds one on their own GitHub token, " +
    "subscription, or Mac. Answers `accepted` with the agent's status now, or `rejected` and " +
    `why. ${MEMBER_MCP_TOOL.MESSAGE_AGENT} then starts it again from there.`,
  input: RewindAgentInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true },
  run: ({ agentId, lineId }) =>
    lifecycleAsMember(LIFECYCLE_VERB.REWOUND, (userId) =>
      Effect.map(rewoundStoppedAgentById(userId, agentId, lineId), (agent) => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: { id: agent.id, title: agent.title ?? agent.model, status: agent.status },
      })),
    ),
});

const DELETE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_AGENT,
  description:
    "Delete a coding agent the member can see, by its id, for good, as the member's own " +
    "Delete agent would: its transcript is deleted and its session ended, and nothing brings " +
    "it back. It stops nothing: an agent starting or running is refused, and " +
    `${MEMBER_MCP_TOOL.STOP_AGENT} stops it first. Its branch and pull request on ` +
    "GitHub stay. Any member who can see an agent may delete it, as in the app, but a Manager " +
    "only by the member who started it or the workspace's owner or an admin. Delete only an " +
    "agent the member asked you to; to put one away and keep it, archive it with " +
    `${MEMBER_MCP_TOOL.ARCHIVE_AGENT} instead. Answers \`accepted\` once it is deleted, or ` +
    "`rejected` and why.",
  input: AgentIdInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ agentId }) =>
    lifecycleAsMember(LIFECYCLE_VERB.DELETED, (userId) =>
      Effect.as(deletedStoppedAgent(userId, agentId), {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        deleted: true,
      }),
    ),
});

const WAKE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.WAKE_AGENT,
  description:
    "Wake the cloud sandbox of a coding agent the member can see, by its id, as the member's " +
    "own Resume would: a stopped sandbox is resumed from its snapshot with its files, and the " +
    "agent's runner is started where none runs, so its next message, shell, or shared port " +
    "answers at once. A sandbox already running is left as it is, and one never opened stays " +
    "starting until the agent's first command. Only the member who started an agent wakes one " +
    "on their own GitHub token or Mac, and an archived agent is not woken. Answers " +
    "`accepted` with where the sandbox stands now (" +
    `${Object.values(SANDBOX_STATE).join(", ")}), or \`rejected\` and why.`,
  input: AgentIdInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ agentId }) =>
    lifecycleAsMember(LIFECYCLE_VERB.WOKEN, (userId) =>
      Effect.gen(function* () {
        const sandbox = yield* resumedAgentSandbox(userId, agentId);
        yield* warmedAgent(userId, agentId);

        return { status: ACTION_RESULT_STATUS.ACCEPTED, sandbox };
      }),
    ),
});

// An agent's cloud sandbox's ports, through the agents' own `list_ports` and `share_port` (`../agents/port-tools.ts`), reached as the member by the Terminal tab's rule.

/** The agent whose sandbox a call reaches, as the admitted member. */
const memberPortsReach = (agentId: string) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;

    return { userId: member.userId, agentId };
  });

/** A share names the agent and the port the agents' own share names, in words that name the member's list. */
const ShareAgentPortInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  port: describeWire(
    SHARE_PORT_TOOL.inputSchema.fields.port,
    `The port to share, one a server listens on as ${MEMBER_MCP_TOOL.LIST_AGENT_PORTS} lists ` +
      "them; null to stop sharing.",
  ),
});

const LIST_AGENT_PORTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AGENT_PORTS,
  description:
    "List the TCP ports a server listens on in the cloud sandbox of a coding agent the member " +
    "can see, by its id, such as a dev server it started, the lowest first, and the port it " +
    `shares by link now, if any, with that link, to choose one to share with ` +
    `${MEMBER_MCP_TOOL.SHARE_AGENT_PORT}. A sandbox that is not running is never woken: it ` +
    "answers running false with no ports, as does an agent on a Mac. Answers `accepted` with " +
    "whether the sandbox is running, its ports, labels saying what serves each port where it " +
    "could be read (such as `storybook dev`), and the port shared with its link, or shared " +
    "null, or `rejected` and why.",
  input: AgentIdInputSchema,
  annotations: READ_ONLY,
  run: (asked) => Effect.flatMap(memberPortsReach(asked.agentId), runListPortsShared),
});

const SHARE_AGENT_PORT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SHARE_AGENT_PORT,
  description:
    "Share a port of the cloud sandbox of a coding agent the member can see, by its id, by a " +
    "link, so a running app, such as a dev server it started, opens from a browser, as the " +
    "member's Share would: a member of the agent's workspace who can reach it opens it signed " +
    "in. One port is " +
    "shared at a time: sharing another replaces the first, and the link lives only while the " +
    "sandbox runs; a sandbox that is not running is refused, never woken. Pass null to stop " +
    "sharing. Answers `accepted` with the port and its link, or with shared null once sharing " +
    `stopped, or \`rejected\` and why. ${MEMBER_MCP_TOOL.LIST_AGENT_PORTS} reads the link back.`,
  input: ShareAgentPortInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ agentId, port }) =>
    Effect.flatMap(memberPortsReach(agentId), (reach) => runSharePort(reach, { port })),
});

/*
 * An agent's cloud browser's tabs, through the one operation the Browser
 * tab's procedures run (`../agents/agent-browser-tabs.ts`), reached as the
 * member by the agent's own rule. A tab is answered by its address and
 * title as the service keeps them, and who drives it; never a frame, a
 * screenshot, or the page's text.
 */

/** Why a tab call changed nothing, in words for one acting for the member. */
const BROWSER_TAB_REFUSAL = {
  NOT_FOUND:
    "Not run: the member sees no such agent, or no such tab in its browser; " +
    `${MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS} lists its tabs.`,
  NOT_PERMITTED:
    "Not run: only the agent's starter may drive its browser, since the agent works on their " +
    "own GitHub token.",
  RETIRED: "Not opened: the agent is archived.",
  NOT_READY:
    "Not opened: the agent has opened no sandbox yet, or its sandbox is starting. The call " +
    "may be made again in a moment.",
  NOT_AN_ADDRESS: "Not opened: give an http or https address.",
  UNAVAILABLE:
    "Not run: the agent's browser could not be reached just now. The call may be made again.",
} as const;

/** Each refusal of the tabs operation in the words above; any other is the browser unavailable. */
const BROWSER_TAB_REFUSAL_WORDS = new Map<HostedRefusal["error"], string>([
  [HOSTED_API_ERROR.NOT_FOUND, BROWSER_TAB_REFUSAL.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, BROWSER_TAB_REFUSAL.NOT_PERMITTED],
  [HOSTED_API_ERROR.AGENT_RETIRED, BROWSER_TAB_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.AGENT_NOT_READY, BROWSER_TAB_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.INVALID_REQUEST, BROWSER_TAB_REFUSAL.NOT_AN_ADDRESS],
]);

/** Who drives a tab, as the member's agent reads it: the agent, the member, or another member. */
const BROWSER_TAB_DRIVER = {
  AGENT: "agent",
  YOU: "you",
  ANOTHER_MEMBER: "another member",
} as const;

/** A tab as the tools answer it: its id, address, title, who opened it, and who drives it until when; never its cursor. */
function memberBrowserTab(tab: AgentBrowserTab, userId: string) {
  const driver =
    tab.driver === null
      ? BROWSER_TAB_DRIVER.AGENT
      : tab.driver.userId === userId
        ? BROWSER_TAB_DRIVER.YOU
        : BROWSER_TAB_DRIVER.ANOTHER_MEMBER;

  return {
    id: tab.id,
    address: tab.address,
    title: tab.title,
    openedBy: tab.openedBy.kind,
    driver,
    ...(tab.driver !== null && { heldUntil: new Date(tab.driver.heldUntil).toISOString() }),
  };
}

/** A tab call run as the member: the operation's answer as accepted, or its refusal in words. */
const browserTabAnswer = <A, R>(
  operation: (userId: string) => Effect.Effect<A, HostedRefusal, R>,
  answered: (answer: A, userId: string) => WireRecord,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;

    return yield* operation(member.userId).pipe(
      Effect.map((answer) => answered(answer, member.userId)),
      Effect.catch((refusal) =>
        Effect.succeed(
          agentToolRejected(
            BROWSER_TAB_REFUSAL_WORDS.get(refusal.error) ?? BROWSER_TAB_REFUSAL.UNAVAILABLE,
          ),
        ),
      ),
    );
  });

/** One tab as a write answers it. */
const oneTab = ({ tab }: { readonly tab: AgentBrowserTab }, userId: string): WireRecord => ({
  status: ACTION_RESULT_STATUS.ACCEPTED,
  tab: memberBrowserTab(tab, userId),
});

const AgentBrowserTabInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  tabId: describeWire(
    wireUuidSchema,
    `The tab's id, as ${MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS} answered it.`,
  ),
});

const OpenAgentBrowserTabInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  address: describeWire(Schema.String, "The http or https address to open the tab at."),
});

/** How long a takeover stands, in the tools' words. */
const TAKEOVER_WORDS =
  `A takeover stands for ${BROWSER_TAKEOVER_HOLD_MS / 1_000} seconds past the member's last ` +
  `take, which ${MEMBER_MCP_TOOL.TAKE_OVER_AGENT_BROWSER_TAB} moves on when called again, and ` +
  "the tab goes back to the agent once it lapses.";

const LIST_AGENT_BROWSER_TABS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AGENT_BROWSER_TABS,
  description:
    "List the tabs open in the cloud browser of a coding agent the member can see, by its id, " +
    "the oldest first, as the agent's Browser tab lists them: each by its id, address, and " +
    "title, who opened it, the agent or a member, and who drives it, the agent, you (the " +
    "member), or another member, with when that member's takeover lapses. Answers `accepted` " +
    "with the tabs, or `rejected` and why.",
  input: AgentIdInputSchema,
  annotations: READ_ONLY,
  run: ({ agentId }) =>
    browserTabAnswer(
      (userId) => listAgentBrowserTabs(userId, { agentId }),
      ({ tabs }, userId) => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        tabs: tabs.map((tab) => memberBrowserTab(tab, userId)),
      }),
    ),
});

const OPEN_AGENT_BROWSER_TAB_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.OPEN_AGENT_BROWSER_TAB,
  description:
    "Open a tab at an http or https address in the cloud browser of a coding agent the member " +
    "can see and controls, by its id, as the member's Browser tab opens one, such as a sign-in " +
    "page the member should finish for the agent; a stopped sandbox is resumed for it. The " +
    "tab is taken over for the member at once, so the agent does not act on it until it is " +
    `handed back with ${MEMBER_MCP_TOOL.HAND_BACK_AGENT_BROWSER_TAB}. ${TAKEOVER_WORDS} ` +
    "Answers `accepted` with the tab, or `rejected` and why.",
  input: OpenAgentBrowserTabInputSchema,
  annotations: ADDITIVE,
  run: ({ agentId, address }) =>
    browserTabAnswer((userId) => openAgentBrowserTab(userId, { agentId, address }), oneTab),
});

const TAKE_OVER_AGENT_BROWSER_TAB_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.TAKE_OVER_AGENT_BROWSER_TAB,
  description:
    "Take over a tab in the cloud browser of a coding agent the member controls, by the " +
    "agent's id and the tab's, as the member's Browser tab's Take over does, so the agent does " +
    `not act on it, or move the member's own takeover on. ${TAKEOVER_WORDS} A tab another ` +
    "member drives is left to them and answered with them as its driver. Answers `accepted` " +
    "with the tab as it then stands, or `rejected` and why.",
  input: AgentBrowserTabInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ agentId, tabId }) =>
    browserTabAnswer((userId) => takeOverAgentBrowserTab(userId, { agentId }, tabId), oneTab),
});

const HAND_BACK_AGENT_BROWSER_TAB_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.HAND_BACK_AGENT_BROWSER_TAB,
  description:
    "Hand a tab the member drives in a coding agent's cloud browser back to the agent, by the " +
    "agent's id and the tab's, as the member's Browser tab's Hand back does, so the agent may " +
    "act on it again. A tab the member does not drive is left as it stands. Answers " +
    "`accepted` with the tab as it then stands, or `rejected` and why.",
  input: AgentBrowserTabInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ agentId, tabId }) =>
    browserTabAnswer((userId) => handBackAgentBrowserTab(userId, { agentId }, tabId), oneTab),
});

// The repositories a workspace reaches on GitHub and their files, through the operations the hosted `github` procedures run (`../github/workspace-repositories.ts`); the member's GitHub token is never read into an answer.

/** Why a repository's file, folder, or skills are not read, in words the agent can act on: a task's read's own, but where they name the task. */
const REPOSITORY_READ_REFUSAL_WORDS = {
  ...TASK_FILE_REFUSAL_WORDS,
  [TASK_FILE_REFUSAL.MISSING]: `Not read: nothing of that kind stands at that path; ${MEMBER_MCP_TOOL.LIST_REPOSITORY_FOLDER} lists what does.`,
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "Not read: no repository was named.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "Not read: neither the workspace's GitHub installation nor a repository added on the " +
    `member's token reaches that repository; ${MEMBER_MCP_TOOL.LIST_REPOSITORIES} lists those that do.`,
} as const satisfies Record<TaskFileRefusal, string>;

/** A refusal of the hosted operations, in the agent's words. */
function repositoryRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return "Not run: the member is not in that workspace.";
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return "Not changed: only the member who added the repository, or a workspace owner or admin, may remove it.";
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return "Not added: the member's own GitHub token may not push to that repository, or saved none.";
    case HOSTED_API_ERROR.GITHUB_UNANSWERED:
      return "Not changed: GitHub could not be reached just now. The call may be made again.";
    default:
      return "Not run: GitHub or the store did not answer just now; try again shortly.";
  }
}

/** A read's own refusal inside its answer (`TaskFileRefusal`), failed in the agent's words, naming the branch GitHub found nothing on. */
function readOrRefused<A extends object>(
  read: A | { readonly refusal: TaskFileRefusal; readonly branch?: string },
): Effect.Effect<A, string> {
  if (!("refusal" in read)) return Effect.succeed(read);
  const words = REPOSITORY_READ_REFUSAL_WORDS[read.refusal];

  return Effect.fail(read.branch === undefined ? words : `${words} (read on ${read.branch})`);
}

/** A repository operation run as the member, in the workspace its slug names, accepted with what it found or rejected in its refusal's words. */
const repositoryAsMember = <A extends object, R>(
  slug: string,
  run: (userId: string, workspaceId: string) => Effect.Effect<A, HostedRefusal | string, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);

    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);

    return yield* run(member.userId, workspace.success).pipe(
      Effect.map((found) => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        ...found,
      })),
      Effect.catch((refusal) =>
        Effect.succeed(
          agentToolRejected(
            Predicate.isString(refusal) ? refusal : repositoryRefusalWords(refusal),
          ),
        ),
      ),
    );
  });

/** A repository, by its full name. */
const REPOSITORY_INPUT = describeWire(
  githubRepositoryFullNameSchema,
  `The repository, by its full name (owner/name), as ${MEMBER_MCP_TOOL.LIST_REPOSITORIES} lists it.`,
);

const ListRepositoriesInputSchema = Schema.Struct({ workspace: WORKSPACE_INPUT });

const LIST_REPOSITORIES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_REPOSITORIES,
  description:
    "List the GitHub repositories the member can choose for a task in a workspace, as the " +
    "repository chip lists them: whether a GitHub installation is connected to the workspace " +
    `(installed), its installations, the link a person opens to install ${PRODUCT_NAME}'s GitHub App ` +
    "(installationUrl), and the repositories, the most recently updated first, each with its " +
    "full name, default branch, whether it is private, and how it is reached (access: app " +
    "for the workspace's installation, token for one a member added on their own GitHub " +
    "token that the member's token may push to); beside them, addable, those the member's own " +
    `token may push to that neither lists, which ${MEMBER_MCP_TOOL.SET_TOKEN_REPOSITORY} adds; ` +
    "and tokenRepositories, every repository members added on their tokens, each with who " +
    "added it, when, and whether the member may remove it. The token itself is never " +
    `answered. ${WORKSPACE_WORDS}`,
  input: ListRepositoriesInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      Effect.gen(function* () {
        const listed = yield* listWorkspaceRepositories(userId, workspaceId);
        const added = yield* workspaceTokenRepositories(userId, workspaceId);

        return { ...listed, tokenRepositories: added.repositories };
      }),
    ),
});

const SetTokenRepositoryInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  repository: REPOSITORY_INPUT,
  added: describeWire(
    Schema.Boolean,
    "true to add the repository on the member's own GitHub token, false to remove it.",
  ),
});

const SET_TOKEN_REPOSITORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SET_TOKEN_REPOSITORY,
  description:
    "Add a GitHub repository to a workspace on the member's own GitHub token, as Settings › " +
    "Workspace's Add repository does, so its tasks and agents may work in it where the " +
    "workspace's installation does not reach it; or remove one, which its adder or a " +
    "workspace owner or admin may. An add is refused where the member's token may not push " +
    "to the repository or they saved none; one the workspace's installation reaches is left " +
    "as it stands, since the installation wins. A removal leaves the workspace's tasks as " +
    "they stand. Answers `accepted` with the repositories added on members' tokens as they " +
    `then stand, or \`rejected\` and why. ${WORKSPACE_WORDS}`,
  input: SetTokenRepositoryInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, repository, added }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      setWorkspaceTokenRepository(userId, { workspaceId, repository, added }),
    ),
});

const ReadRepositoryFileInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  repository: REPOSITORY_INPUT,
  path: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
    "The file's path from the repository's root, such as src/index.ts.",
  ),
  firstLine: Schema.optionalKey(
    describeWire(codeLineSchema, "The first line to read, from 1; 1 where left out."),
  ),
  ref: REPOSITORY_REF_INPUT,
});

const READ_REPOSITORY_FILE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_REPOSITORY_FILE,
  description:
    "Read a file of a GitHub repository the workspace reaches, by its full name and the " +
    "file's path, with no task naming it: read through the workspace's installation, or the " +
    "member's own token for a repository added on it, at the branch or commit you name. " +
    "Answers `accepted` with the file's path, the repository and the branch or commit read, " +
    "the commit read at where GitHub named one, the line the window starts at, how many " +
    `lines the whole file has, and up to ${TASK_FILE_BOUNDS.WINDOW_LINES} of its lines, each ` +
    `cut at ${TASK_FILE_BOUNDS.MAX_LINE_CHARS} characters; pass firstLine to read further. A ` +
    "file that may hold a secret, is too large, or is not text is refused. Answers " +
    `\`rejected\` and why otherwise. ${MEMBER_MCP_TOOL.LIST_REPOSITORY_FOLDER} lists a folder. ` +
    WORKSPACE_WORDS,
  input: ReadRepositoryFileInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, repository, path, firstLine = 1, ref }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      Effect.flatMap(
        readPlaceFile(
          userId,
          { workspaceId, repository },
          {
            path,
            firstLine,
            lastLine: firstLine + TASK_FILE_BOUNDS.WINDOW_LINES - 1,
            ref,
          },
        ),
        readOrRefused,
      ),
    ),
});

const ListRepositoryFolderInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  repository: REPOSITORY_INPUT,
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
      "The folder's path from the repository's root, such as src; the root where left out.",
    ),
  ),
  recursive: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to list everything under the folder, each entry by its path from the folder; " +
        "false or left out for the folder's own entries.",
    ),
  ),
  ref: REPOSITORY_REF_INPUT,
});

const LIST_REPOSITORY_FOLDER_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_REPOSITORY_FOLDER,
  description:
    "List a folder of a GitHub repository the workspace reaches, by its full name, with no " +
    "task naming it, at the branch or commit you name. Answers `accepted` with the folder's " +
    "path, the repository and the branch or commit read, its entries in GitHub's order, each " +
    "with its name " +
    "and whether it is a file or a folder, and truncated true where there were more than " +
    `${TASK_TREE_BOUNDS.MAX_ENTRIES} (or ${TASK_TREE_BOUNDS.MAX_RECURSIVE_ENTRIES} with ` +
    `recursive), or \`rejected\` and why. ${MEMBER_MCP_TOOL.READ_REPOSITORY_FILE} reads a ` +
    `file it lists. ${WORKSPACE_WORDS}`,
  input: ListRepositoryFolderInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, repository, path = "", recursive, ref }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      Effect.flatMap(
        readPlaceTree(
          userId,
          { workspaceId, repository },
          { path, ref, ...(recursive === true ? { recursive } : undefined) },
        ),
        readOrRefused,
      ),
    ),
});

const ListRepositorySkillsInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  repository: Schema.optionalKey(
    describeWire(
      githubRepositoryFullNameSchema,
      "The repository whose skills lead the list, by its full name (owner/name); the " +
        "member's installed skills alone where left out.",
    ),
  ),
});

const LIST_REPOSITORY_SKILLS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_REPOSITORY_SKILLS,
  description:
    "List the skills a developer may choose by name for an agent in a workspace, as the " +
    "composer's / list offers them: the repository's, where you name one, as its default " +
    "branch holds them on GitHub, then the member's enabled installed skills, the " +
    "workspace's and then their own, a name an earlier source holds left out. Answers " +
    "`accepted` with the repository and the branch read (null where none is named), and the " +
    "skills, each with its name, what it is for, where it comes from (repository, " +
    "workspace, or personal), and for one of the repository's its SKILL.md's path, or " +
    `\`rejected\` and why. ${WORKSPACE_WORDS}`,
  input: ListRepositorySkillsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, repository }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      Effect.flatMap(readPlaceSkills(userId, workspaceId, repository ?? null, true), readOrRefused),
    ),
});

const ReadGitHubIssueInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  repository: REPOSITORY_INPUT,
  number: describeWire(
    githubPullRequestNumberSchema,
    "The issue's or pull request's number in the repository.",
  ),
});

const READ_GITHUB_ISSUE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_GITHUB_ISSUE,
  description:
    "Read the title, page, and state of an issue or a pull request of a GitHub repository the " +
    "workspace reaches, by its full name and the number, as a link to it draws: GitHub numbers " +
    "issues and pull requests of a repository in one series, so a number names one or the " +
    "other. Answers `accepted` with pullRequest (its number, title, url, state, author, and " +
    "what GitHub says of its size, branches, and labels) where the number is a pull request, " +
    "issue (its number, title, url, state, and author) where it is an issue, and each null " +
    "where it is not, or where the repository is not reached or does not grant issues; or " +
    `\`rejected\` and why. ${WORKSPACE_WORDS}`,
  input: ReadGitHubIssueInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, repository, number }) =>
    repositoryAsMember(workspace, (userId, workspaceId) =>
      Effect.gen(function* () {
        const place = { workspaceId, repository };
        const pullRequest = yield* readPlacePullRequest(userId, place, number);
        // Note that a pull request is read as an issue too by GitHub's issues API, so the issue is read only where no pull request answered.
        const issue = pullRequest === null ? yield* readPlaceIssue(userId, place, number) : null;

        return { pullRequest, issue };
      }),
    ),
});

const READ_GITHUB_CONNECTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_GITHUB_CONNECTION,
  description:
    `Read whether the member you act for has connected their GitHub account to ${PRODUCT_NAME}, ` +
    "which pull request changes on GitHub are made as, and their GitHub login where it is. " +
    `Connecting needs a browser: a person connects it from ${PRODUCT_NAME}'s Settings. Never ` +
    "answers a token.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const connection = yield* githubConnection(member.userId);

      return { status: ACTION_RESULT_STATUS.ACCEPTED, ...connection };
    }),
});

// The member's inbox (`inbox.ts`): the threads their agents ask them things on, read and worked as theirs.

/** How an answer or a message tells the agent what the thread's agent hears. */
/** What a call that would reach an archived agent meets, said in every such tool's description. */
const ARCHIVED_AGENT_WORDS =
  "Where that agent is archived, the call is refused before anything is written, since a " +
  `tool never brings an agent back: bring it back with ${MEMBER_MCP_TOOL.UNARCHIVE_AGENT} first.`;

/** What a call that would wake an agent on a settled task meets, said in every such tool's description. */
const SETTLED_AGENT_WORDS =
  "Where that agent's task is done or canceled, the call is refused before anything is " +
  `written, since a tool never reopens a task: move the task with ${MEMBER_MCP_TOOL.UPDATE_TASK} first. ` +
  ARCHIVED_AGENT_WORDS;

/** The same for a call that tells the thread's agent only where it waits on the member's answer. */
const WAITING_SETTLED_WORDS =
  "Where it would tell an agent waiting on the answer whose task is done or canceled, or one " +
  "that is archived, it is refused before anything is written, since a tool never reopens a " +
  `task or brings an agent back: move the task with ${MEMBER_MCP_TOOL.UPDATE_TASK}, or bring ` +
  `the agent back with ${MEMBER_MCP_TOOL.UNARCHIVE_AGENT}, first.`;

/** What settling a thread may set off: a finished automation run, with Mark finished runs Done on, put away (`automations/run-archive.ts`). */
const RUN_SETTLED_WORDS =
  "Where this settles the last thing an automation run with Mark finished runs Done waits on, " +
  "its agents are archived and its task moves to Done.";

const HANDED_WORDS =
  "It is written on the thread as the member's own and handed at once to the thread's agent, " +
  "which takes it up in its next turn, starting one where it was idle. " +
  SETTLED_AGENT_WORDS;

/** A thread by its id, as the inbox read names it. */
const THREAD_ID = describeWire(
  wireUuidSchema,
  `The thread's id, as ${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
);

const ReadInboxInputSchema = Schema.Struct({ workspace: WORKSPACE_INPUT });

const READ_INBOX_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_INBOX,
  description:
    "Read what waits on the member you act for in a workspace's inbox, where its coding agents " +
    "ask them things in threads: every thread they may read, whichever member's agent posted " +
    "it, those whose ask waits on the member first, then every other open ask, then the notices " +
    `still open, then the latest ${INBOX_BOUNDS.MAX_SETTLED_TOLD} settled, each the latest ` +
    "changed first. Each thread has its id, which the other inbox tools take, its title, where " +
    `it stands (${Object.values(INBOX_STATUS).join(", ")}) and its revision, the agent that ` +
    "posted it (agentId), who it waits on by name and whether that is the member " +
    "(waitsOnMember), whether it is unread for them, and its messages in order: who wrote each (agent, `you` for the " +
    "member, or another member by name, with fromUserId to link a member by), its words, its " +
    "files by name, the ask it ends with " +
    "and where that stands, and the answer a member's message carries. An open ask reads " +
    `whole: a ${INBOX_ASK.DECIDE}'s options, those recommended, and whether several may be ` +
    `picked; a ${INBOX_ASK.DO}'s steps, which the member does by hand; or an ` +
    `${INBOX_ASK.ANSWER}'s fields, or none where words are the answer; and the thread's askId ` +
    `names the message it stands on, which ${MEMBER_MCP_TOOL.ANSWER_ASK} takes. A thread ` +
    `longer than ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages reads its first, its open ask, and ` +
    "its latest; a settled one reads its latest messages and its latest ask and answer, with " +
    `how many earlier it leaves out. ${WORKSPACE_WORDS}`,
  input: ReadInboxInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const listed = yield* listedWorkspace(member.userId, workspace);

      if (Result.isFailure(listed)) return agentToolRejected(listed.failure);

      return yield* readMemberInbox(member.userId, listed.success);
    }),
});

/** What a call meets that leaves out a reply's field: what each reply takes, so one retry fixes it. */
const ANSWER_FIELD_MISSING =
  `Not answered: answer.reply "${INBOX_REPLY.CHOSE}" takes choices (the option labels); ` +
  `"${INBOX_REPLY.SUBMITTED}" takes values (each field by its label); "${INBOX_REPLY.DONE}" ` +
  `and "${INBOX_REPLY.NOT_DONE}" take steps (the places of the steps done, from 0); ` +
  `"${INBOX_REPLY.ANSWERED}" takes none, its words in note.`;

/** A reply's own field, refused in those words where it is left out. */
const answerField = <S extends Schema.Top>(schema: S, description: string) =>
  describeWire(schema, description).pipe(
    Schema.annotateKey({ messageMissingKey: ANSWER_FIELD_MISSING }),
  );

/** The steps of a do the member did, by their places from 0, which done and not done alike carry. */
const DONE_STEPS = (words: string) =>
  answerField(
    inboxAnswersSchema.fields.steps.schema,
    `The steps of the ${INBOX_ASK.DO} the member did, by their places from 0: ${words}`,
  );

/** One answer per reply, each carrying exactly what that reply takes, as the window's answer does. */
const AskAnswerSchema = Schema.Union([
  Schema.Struct({
    reply: Schema.Literal(INBOX_REPLY.CHOSE),
    choices: answerField(
      inboxAnswersSchema.fields.choices.schema,
      "The labels of the options the member picks: one, or several where the ask lets several " +
        "be picked.",
    ),
  }),
  Schema.Struct({ reply: Schema.Literal(INBOX_REPLY.ANSWERED) }),
  Schema.Struct({
    reply: Schema.Literal(INBOX_REPLY.SUBMITTED),
    values: answerField(
      inboxAnswersSchema.fields.values.schema,
      "The fields the member fills: each by its field's label, with words, a number, one of a " +
        "select's options, or true or false, as its type asks; every required field filled.",
    ),
  }),
  Schema.Struct({
    reply: Schema.Literal(INBOX_REPLY.DONE),
    steps: DONE_STEPS("every one."),
  }),
  Schema.Struct({
    reply: Schema.Literal(INBOX_REPLY.NOT_DONE),
    steps: DONE_STEPS("those they did, or none."),
  }),
]);

/** An answer names its thread and the ask it answers, how the member answers with what that takes, and their words, as the window's answer carries them. */
const AnswerAskInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  askId: describeWire(
    wireUuidSchema,
    `The id of the message whose ask you answer: the thread's askId, as ` +
      `${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
  ),
  answer: describeWire(
    AskAnswerSchema,
    `How the member answers, by its reply: ${INBOX_REPLY.CHOSE}, with choices, for a ` +
      `${INBOX_ASK.DECIDE}; ${INBOX_REPLY.ANSWERED}, with their words in note, where no option ` +
      `of a ${INBOX_ASK.DECIDE} fits or an ${INBOX_ASK.ANSWER} asks no fields; ` +
      `${INBOX_REPLY.SUBMITTED}, with values, for an ${INBOX_ASK.ANSWER}'s fields; and ` +
      `${INBOX_REPLY.DONE} or ${INBOX_REPLY.NOT_DONE}, with steps, for a ${INBOX_ASK.DO}.`,
  ),
  note: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
      `The member's words with the answer, in Markdown: the answer itself for ` +
        `${INBOX_REPLY.ANSWERED}, and otherwise anything they add; none where left out.`,
    ),
  ),
});

const ANSWER_ASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.ANSWER_ASK,
  description:
    "Answer the open ask of a thread in the member's inbox as the member, as they would in the " +
    `window. ${HANDED_WORDS} Name the thread and its askId as ` +
    `${MEMBER_MCP_TOOL.READ_INBOX} answered them, and the member's answer. A ` +
    `${INBOX_ASK.DO}'s steps are things the member does by hand, such as a setting on GitHub ` +
    `or a secret: answer ${INBOX_REPLY.DONE}, with every step's place, only once every step is ` +
    `really done, and ${INBOX_REPLY.NOT_DONE} where they could not or would not; never mark one ` +
    "done to clear it away. Answer only what the member decided or told you to, and ask them " +
    "where you do not know their answer. Answers `accepted` with the thread as it then stands, " +
    "or `rejected` and why nothing was written, such as an ask no longer open or an answer " +
    `that does not fit it. ${RUN_SETTLED_WORDS}`,
  input: AnswerAskInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ threadId, askId, answer, note }) =>
    Effect.flatMap(AdmittedMember, (member) =>
      answerAskAsMember(member.userId, {
        threadId,
        note: note ?? "",
        answers: { ask: askId, ...answer },
      }),
    ),
});

const AcknowledgeThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  revision: describeWire(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    `The thread's revision, as ${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
  ),
});

const ACKNOWLEDGE_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.ACKNOWLEDGE_THREAD,
  description:
    "Acknowledge a notice in the member's inbox, an open thread that holds no ask, as the " +
    "member's Got it in the window does, at the revision " +
    `${MEMBER_MCP_TOOL.READ_INBOX} answered, so a thread its agent changed since is not ` +
    "settled unseen. It tells the thread's agent the member saw it, where the agent waits to " +
    `hear; unlike ${MEMBER_MCP_TOOL.CLOSE_THREAD}, which tells it the member does not want ` +
    `what it asked. ${WAITING_SETTLED_WORDS} A thread that holds an ask is refused: answer it with ` +
    `${MEMBER_MCP_TOOL.ANSWER_ASK}. Acknowledge only what the member has seen or told you ` +
    "to. Answers `accepted` with the thread as it then stands, or `rejected` and why it was " +
    `not acknowledged. ${RUN_SETTLED_WORDS}`,
  input: AcknowledgeThreadInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => acknowledgeThreadAsMember(member.userId, asked)),
});

const ReplyToThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
    "The member's message, in Markdown, short and complete.",
  ),
});

const REPLY_TO_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REPLY_TO_THREAD,
  description:
    "Write a message on a thread in the member's inbox as the member, open or settled. " +
    `${HANDED_WORDS} It answers no ask, even one standing open: answer that with ` +
    `${MEMBER_MCP_TOOL.ANSWER_ASK}. Answers \`accepted\` with the thread as it then stands, ` +
    "or `rejected` and why nothing was written.",
  input: ReplyToThreadInputSchema,
  annotations: ADDITIVE,
  run: (asked) => Effect.flatMap(AdmittedMember, (member) => replyAsMember(member.userId, asked)),
});

const CloseThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  revision: describeWire(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    `The thread's revision, as ${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
  ),
});

const CLOSE_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CLOSE_THREAD,
  description:
    "Close an open thread in the member's inbox without answering it, as the member, at the " +
    `revision ${MEMBER_MCP_TOOL.READ_INBOX} answered, so a thread its agent changed since is ` +
    "not closed unseen. An agent waiting on its answer is told at once that the member closed " +
    "it, which it takes as their not wanting what it asked; any other reads the close in its " +
    `own time. ${WAITING_SETTLED_WORDS} Close only what the member does not want. ` +
    "Answers `accepted` with the thread as " +
    `it then stands, or \`rejected\` and why it was not closed. ${RUN_SETTLED_WORDS}`,
  input: CloseThreadInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => closeThreadAsMember(member.userId, asked)),
});

const MarkThreadReadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  read: describeWire(
    Schema.Boolean,
    "true to mark it read, as opening it does; false to mark it unread, which holds until the " +
      "member reads it again.",
  ),
});

const MARK_THREAD_READ_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.MARK_THREAD_READ,
  description:
    "Mark a thread in the member's inbox read or unread for them alone, as they would in the " +
    "window: no other member's read moves, and no agent hears of it. Answers `accepted` with " +
    "the thread's id and whether it is now unread, or `rejected` and why.",
  input: MarkThreadReadInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => markThreadReadAsMember(member.userId, asked)),
});

const MARK_INBOX_READ_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.MARK_INBOX_READ,
  description:
    "Mark every thread of a workspace's inbox read for the member you act for, open or " +
    "settled, as Mark all read does in the window: no other member's read moves, and no agent " +
    "hears of it. Answers `accepted` with how many were unread, or `rejected` and why. " +
    WORKSPACE_WORDS,
  input: ReadInboxInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace }) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const listed = yield* listedWorkspace(member.userId, workspace);

      if (Result.isFailure(listed)) return agentToolRejected(listed.failure);

      return yield* markInboxReadAsMember(member.userId, listed.success);
    }),
});

const RemindThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  at: describeWire(
    Schema.NullOr(dateTimeSchema),
    "When the thread comes back, as a time with its offset, such as 2026-10-20T09:00-07:00, " +
      "in the member's own zone where you know it; null to end a reminder set before.",
  ),
});

const REMIND_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REMIND_THREAD,
  description:
    "Set a reminder on a thread in the member's inbox for them alone, as Remind me does in the " +
    "window: it stays out of their inbox until the time named, and comes back then, read or " +
    "unread as it stands. A reminder set again replaces the one before, and null ends it. No " +
    "agent hears of it. Answers `accepted` with the thread's id, when it comes back, and " +
    "whether it is unread, or `rejected` and why.",
  input: RemindThreadInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ threadId, at }) =>
    Effect.flatMap(AdmittedMember, (member) =>
      remindThreadAsMember(member.userId, {
        threadId,
        at: at === null ? null : Date.parse(at),
      }),
    ),
});

const StartThreadInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  title: Schema.optionalKey(
    describeWire(
      inboxStartRequestSchema.fields.title.schema,
      "The thread's subject; leave it out to have it titled from the message.",
    ),
  ),
  text: ReplyToThreadInputSchema.fields.text,
});

const START_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.START_THREAD,
  description:
    "Start a thread in the member's inbox with a coding agent they may message, as the member, " +
    "as a new mail is written: its subject and first message. " +
    `${HANDED_WORDS} The agent answers on the thread, which ${MEMBER_MCP_TOOL.READ_INBOX} ` +
    "reads. Answers `accepted` with the thread as it then stands, or `rejected` and why " +
    "nothing was written.",
  input: StartThreadInputSchema,
  annotations: ADDITIVE,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => startThreadAsMember(member.userId, asked)),
});

/**
 * The kept published answers of this function's instance, made on its first
 * change: the server is a function of its own, so a change lets go of what
 * this instance and the agent's row kept, and the hosted router's instances
 * let go of theirs within `CODER.PUBLISHED_TTL`, as after a change made on
 * any other instance (`asked-pull-request.ts`'s `forgetPublished`).
 */
const KEPT_PUBLISHED = instancePublishedCache();

/** Why a change was not made, in words the agent can act on: the desktop's own where its tab says one. */
const AGENT_PULL_REQUEST_ACTION_REFUSAL = {
  SIGN_IN:
    "Not made: sign in with GitHub to make this change as the member. They hold no GitHub " +
    `sign-in GitHub takes, which signing in with GitHub again in ${PRODUCT_NAME} mends.`,
  REFUSED: (words: string) => `Not made: GitHub refused this change, saying: ${words}`,
  NO_PULL_REQUEST:
    "Not made: that agent works in no repository, or its repository holds no pull request of " +
    `that number; ${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers the number of the agent's own.`,
  NOT_REACHABLE:
    "Not made: the GitHub installation connected to the workspace no longer reaches that " +
    "agent's repository.",
  UNANSWERED: "Not made: GitHub could not be reached just now. The call may be made again.",
} as const;

/** A change names the agent, the pull request of its repository by number, and the change as the agent's Pull request tab asks for it. */
const AgentPullRequestActionInputSchema = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${MEMBER_MCP_TOOL.LIST_AGENTS} answered it.`,
  ),
  number: describeWire(
    githubPullRequestNumberSchema,
    "The pull request of the agent's repository to change, by its number: the agent's own, " +
      `which ${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers, or another, such as one stacked on it.`,
  ),
  change: describeWire(
    agentPullRequestActionRequestSchema,
    "The change, named by its action, with the fields that action takes.",
  ),
});

/** How GitHub took the change, as the agent reads it: accepted where GitHub made it, else the refusal the desktop shows, as the tool's error. */
function actionAnswerOf(answer: PullRequestWriteAnswer): WireRecord {
  switch (answer.outcome) {
    case PULL_REQUEST_WRITE_OUTCOME.DONE:
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    case PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED:
      return agentToolRejected(AGENT_PULL_REQUEST_ACTION_REFUSAL.SIGN_IN);
    case PULL_REQUEST_WRITE_OUTCOME.REFUSED:
      return agentToolRejected(AGENT_PULL_REQUEST_ACTION_REFUSAL.REFUSED(answer.words));
  }
}

/** A change that never reached GitHub, in the agent's words: no pull request, a repository out of reach, or GitHub or the store not answering. */
function unmadeWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.NO_PULL_REQUEST;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.NOT_REACHABLE;
    default:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.UNANSWERED;
  }
}

/**
 * `agent_pull_request_action`: the change the agent's Pull request tab
 * makes, through the operation its procedure runs
 * (`agentPullRequestAction`), on the member's own GitHub sign-in, the
 * agent's kept published answers let go after it. A merge is one of its
 * changes and cannot be taken back, so the tool says it may destroy.
 */
const AGENT_PULL_REQUEST_ACTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
  description:
    "Make one change to a pull request of the repository of a coding agent the member can see, " +
    "by the agent's id and the pull request's number, in whichever of the member's workspaces it stands, as the agent's Pull request tab " +
    "makes it: on GitHub as the member, on their own GitHub sign-in, so GitHub allows what " +
    "their own account may and nothing more. Name the change by its action " +
    `(${Object.values(PULL_REQUEST_ACTION).join(", ")}) with the fields that action takes. A ` +
    "merge and turning auto-merge on name the head commit you saw, as headSha, which " +
    `${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers, so GitHub refuses one against a head pushed ` +
    "since; an edit of the description names the words it began from, as expectedBody, and " +
    "writes nothing where GitHub's changed since; a review thread, a comment, and what a " +
    "reaction is on are named by GitHub's own node ids. Answers `accepted` once " +
    "GitHub made it, or `rejected` and why not: GitHub's own words where it refused, or that " +
    "the member must sign in with GitHub again.",
  input: AgentPullRequestActionInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true },
  run: ({ agentId, number, change }) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) =>
        orStoreRefusal(
          Effect.gen(function* () {
            const found = yield* workspaceAgentOf(call.caller, agentId);

            if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);

            return yield* agentPullRequestAction(
              KEPT_PUBLISHED,
              callerUserId(call.caller),
              found.value.agent,
              number,
              change,
            ).pipe(
              Effect.map(actionAnswerOf),
              Effect.catch((refusal) => Effect.succeed(agentToolRejected(unmadeWords(refusal)))),
            );
          }),
        ),
    ),
});

// A pull request of a coding agent's repository by the agent's id and its number, or any pull request of a repository the member's workspace reaches by its repository and number (`pull-request-tools.ts`).

/** Why a pull request call reached nothing before it began, in words the agent can act on. */
const PULL_REQUEST_NAME_ONE =
  "Not run: name the pull request's repository either by agentId or by repository " +
  "(owner/name), not both and not neither, beside its number.";

/** The words of a pull request call's workspace, which a pull request named by its repository needs and one named by its agent never takes. */
const PULL_REQUEST_WORKSPACE_WORDS =
  `The workspace whose GitHub installation reaches the repository, by the slug ` +
  `${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered: required with repository; leave it out with ` +
  "agentId, whose agent settles it.";

/** How a pull request tool tells the agent to name its workspace, which only a pull request named by its repository takes. */
const PULL_REQUEST_BY_REPOSITORY_WORDS =
  "With repository, name the workspace by its slug, even where the member belongs to one " +
  `alone; ${MEMBER_MCP_TOOL.LIST_WORKSPACES} names them.`;

/** With repository, the workspace whose installation reaches it. */
const PULL_REQUEST_WORKSPACE = Schema.optionalKey(
  describeWire(WORKSPACE_SLUG, PULL_REQUEST_WORKSPACE_WORDS),
);

/** A read names the pull request, by its agent or its repository, and its part. */
const ReadPullRequestInputSchema = Schema.Struct({
  workspace: PULL_REQUEST_WORKSPACE,
  ...READ_PULL_REQUEST_FIELDS,
});

/** A mark names the pull request, by its agent or its repository, and its files. */
const MarkPullRequestFilesViewedInputSchema = Schema.Struct({
  workspace: PULL_REQUEST_WORKSPACE,
  ...MARK_FILES_VIEWED_FIELDS,
});

/** The pull request a call names, either way. */
interface PullRequestNamedInput {
  readonly agentId: string | undefined;
  readonly repository: string | undefined;
  readonly number: number;
  readonly workspace: string | undefined;
}

/** Each way a pull request call runs: on an agent the member reached, or on a repository's pull request in the workspace given. */
interface PullRequestCall<R> {
  readonly agent: (
    userId: string,
    agent: Agent,
    number: number,
  ) => Effect.Effect<WireRecord, never, R>;
  readonly repository: (
    userId: string,
    workspaceId: string,
    named: { readonly repository: string; readonly number: number },
  ) => Effect.Effect<WireRecord, never, R>;
}

/** A pull request call run as the member on the pull request its input names: by the agent, found as `read_agent` finds it, or by its repository and number in the workspace named. */
const pullRequestAsMember = <R>(named: PullRequestNamedInput, call: PullRequestCall<R>) => {
  const { agentId, repository, number, workspace } = named;

  if (agentId !== undefined) {
    if (repository !== undefined || workspace !== undefined) {
      return Effect.succeed(agentToolRejected(PULL_REQUEST_NAME_ONE));
    }

    return readAsMember(
      (userId) => agentWorkspace(userId, { id: agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (member) =>
        orStoreRefusal(
          Effect.gen(function* () {
            const found = yield* workspaceAgentOf(member.caller, agentId);

            if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);

            return yield* call.agent(callerUserId(member.caller), found.value.agent, number);
          }),
        ),
    );
  }

  if (repository === undefined) {
    return Effect.succeed(agentToolRejected(PULL_REQUEST_NAME_ONE));
  }

  if (workspace === undefined) {
    return Effect.succeed(
      agentToolRejected(MEMBER_WORKSPACE_REFUSAL.MISSING("a pull request named by repository")),
    );
  }

  return listAsMember(workspace, (member) =>
    call.repository(callerUserId(member.caller), callerWorkspaceId(member.caller), {
      repository,
      number,
    }),
  );
};

const READ_PULL_REQUEST_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_PULL_REQUEST,
  description:
    "Read a pull request one part a call, as its Pull request tab draws it, by its number: " +
    "one of a coding agent's repository by the agent's id, or one of any repository the " +
    "member's workspace reaches on GitHub by its repository (owner/name). " +
    `${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers the number of an agent's own. ` +
    "overview (the default) answers the pull request as GitHub holds it now: its state, its " +
    "checks in one word, the head commit it stands on (headSha), the lines it adds and removes, " +
    "the branch it is from, and its overview: its body as written in Markdown, cut to a bound, its " +
    "base and head, whether it would merge, who opened it, who it asks for a review, its labels, " +
    "and the stack it stands in. checks answers each check on its head and its deployments. " +
    "conversation answers where each reviewer stands and its comments and reviews, newest " +
    "first, each with its review threads, a page at a time held to a bound, with nextOffset " +
    "where more stand. changes answers the files it changes, a page at a time with nextOffset, " +
    "each with what became of it, the lines it adds and removes, and whether the member marked " +
    "it viewed; name a path to read that file's patch as well. " +
    `${PULL_REQUEST_BY_REPOSITORY_WORDS} Answers \`rejected\` and why where the member ` +
    "reaches no such agent, " +
    "the member is in no such workspace, or the repository holds no pull request of that " +
    "number. It only reads.",
  input: ReadPullRequestInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, agentId, repository, number, ...asked }) =>
    pullRequestAsMember(
      { workspace, agentId, repository, number },
      {
        agent: (userId, agent, other) =>
          runReadAgentPullRequest(KEPT_PUBLISHED, userId, agent, other, asked),
        repository: (userId, workspaceId, named) =>
          runReadPullRequest(userId, workspaceId, named, asked),
      },
    ),
});

const MARK_PULL_REQUEST_FILES_VIEWED_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.MARK_PULL_REQUEST_FILES_VIEWED,
  description:
    "Mark files of a pull request as viewed, or unmark them, as GitHub's own Viewed box does: " +
    "on GitHub as the member, on their own GitHub sign-in. Name the pull request by its " +
    "number, of a coding agent's repository by the agent's id or of any repository the " +
    "member's workspace reaches by its repository (owner/name), and the files by their paths as " +
    `${MEMBER_MCP_TOOL.READ_PULL_REQUEST}'s changes name them. ` +
    `${PULL_REQUEST_BY_REPOSITORY_WORDS} Answers \`accepted\` with the paths marked, or ` +
    "`rejected` and why " +
    "at the first GitHub did not take, naming those marked before it.",
  input: MarkPullRequestFilesViewedInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, agentId, repository, number, ...asked }) =>
    pullRequestAsMember(
      { workspace, agentId, repository, number },
      {
        agent: (userId, agent, other) =>
          runMarkAgentFilesViewed(KEPT_PUBLISHED, userId, agent, other, asked),
        repository: (userId, workspaceId, named) =>
          runMarkFilesViewed(userId, workspaceId, named, asked),
      },
    ),
});

/*
 * A pull request's chapters, read and generated as its Pull request tab
 * reads and generates them, through the operations its procedures run
 * (`../chapters/pull-request-chapters-procedures.ts`): an agent's pull
 * request by the agent's id, or any pull request of a repository the
 * workspace reaches by its repository and number. A Generate runs one model
 * call on the member's own API key, as the tab's does, held to its claim, so
 * a second Generate of the same head while one runs answers it as it stands.
 */

/** Why chapters were not read or generated, in words the agent can act on. */
const CHAPTERS_REFUSAL = {
  NO_PULL_REQUEST:
    "Not run: the member reaches no such pull request: the agent, the workspace, or the " +
    "repository's pull request of that number is none of theirs.",
  NOT_REACHABLE:
    "Not run: the GitHub installation connected to the workspace no longer reaches that " +
    "repository.",
  NO_KEY:
    "Not generated: the member saved no API key to generate chapters on, or the service could " +
    `not run it just now. Chapters run on the member's own Anthropic or OpenAI key, saved in ` +
    `${PRODUCT_NAME}'s settings.`,
  UNANSWERED:
    "Not run: GitHub or the service could not be reached just now. The call may be made again.",
} as const;

/** A refusal of a chapters read or Generate, in the agent's words: unavailable is a Generate's missing key, or a read's store down. */
function chaptersRefusalWords(refusal: HostedRefusal, generates: boolean): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return CHAPTERS_REFUSAL.NO_PULL_REQUEST;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return CHAPTERS_REFUSAL.NOT_REACHABLE;
    case HOSTED_API_ERROR.UNAVAILABLE:
      return generates ? CHAPTERS_REFUSAL.NO_KEY : CHAPTERS_REFUSAL.UNANSWERED;
    default:
      return CHAPTERS_REFUSAL.UNANSWERED;
  }
}

/** A chapters call names an agent's pull request, or a repository's by its number, in the workspace a slug names. */
const PullRequestChaptersInputSchema = Schema.Struct({
  agentId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `An agent whose repository the pull request is of, by its id as ` +
        `${MEMBER_MCP_TOOL.LIST_AGENTS} answered it, with number; leave it out to name the ` +
        "repository instead.",
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      githubRepositoryFullNameSchema,
      "The repository whose pull request to read, as owner/name, with number; leave it out " +
        "with agentId.",
    ),
  ),
  number: describeWire(
    githubPullRequestNumberSchema,
    "The pull request's number, in the repository that repository or agentId names. For an " +
      `agent's own pull request, pass the number ${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers.`,
  ),
  workspace: PULL_REQUEST_WORKSPACE,
});

type PullRequestChaptersInput = typeof PullRequestChaptersInputSchema.Type;

/** A Generate names the pull request as a read does, and the provider whose key it spends. */
const GeneratePullRequestChaptersInputSchema = Schema.Struct({
  ...PullRequestChaptersInputSchema.fields,
  provider: describeWire(
    modelApiProviderSchema,
    "The provider whose API key the member saved to generate on, one of the chaptersProviders " +
      `${MEMBER_MCP_TOOL.LIST_MODELS} answers.`,
  ),
});

/** Why a Generate naming a provider the member saved no key of ran nothing, naming those they did. */
function chaptersProviderRefusal(providers: readonly ModelProvider[]): string {
  return providers.length === 0
    ? CHAPTERS_REFUSAL.NO_KEY
    : `Not generated: the member saved no API key of that provider; name one they did as ` +
        `provider: ${providers.map((provider) => `\`${provider}\``).join(", ")}.`;
}

/** The two ways a chapters call reaches its pull request: through the agent that published it, or by its repository and number. */
interface ChaptersCall<R> {
  /** Whether it generates, which spends the member's key, rather than reads. */
  readonly generates: boolean;
  readonly agent: (
    userId: string,
    agent: Agent,
    number: number,
  ) => Effect.Effect<PullRequestChaptersAnswer, HostedRefusal, R>;
  readonly repository: (
    userId: string,
    query: { readonly workspaceId: string; readonly repository: string; readonly number: number },
  ) => Effect.Effect<PullRequestChaptersAnswer, HostedRefusal, R>;
}

/** A chapters read or Generate run as the member on the pull request its input names, answered with the chapters as the tab reads them, or refused in the agent's words. */
const chaptersAsMember = <R>(asked: PullRequestChaptersInput, call: ChaptersCall<R>) => {
  const answered = (effect: Effect.Effect<PullRequestChaptersAnswer, HostedRefusal, R>) =>
    effect.pipe(
      Effect.map((answer): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answer })),
      Effect.catch((refusal) =>
        Effect.succeed(agentToolRejected(chaptersRefusalWords(refusal, call.generates))),
      ),
    );

  const { agentId, repository, number, workspace } = asked;

  return pullRequestAsMember(
    { agentId, repository, number, workspace },
    {
      agent: (userId, agent, other) => answered(call.agent(userId, agent, other)),
      repository: (userId, workspaceId, named) =>
        answered(call.repository(userId, { workspaceId, ...named })),
    },
  );
};

/** How a chapters tool tells the agent what it answers. */
const CHAPTERS_ANSWER_WORDS =
  "Answers `accepted` with the pull request's number, whether the member can generate " +
  "chapters (generatable) and on which model and provider (runsOn), and where its newest " +
  `chapters stand (${Object.values(PULL_REQUEST_CHAPTERS_STATE).join(", ")}): the head and base ` +
  "they were told for, and, where ready, each chapter's title, summary, kind, risk and why, key " +
  "changes with the lines they are on, and the hunks it holds; chapters told for a head older " +
  "than the pull request's now are stale. pullRequest is null where the agent works in no " +
  "repository, or its repository holds no pull request of that number. Or `rejected` and why.";

const READ_PULL_REQUEST_CHAPTERS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_PULL_REQUEST_CHAPTERS,
  description:
    "Read a pull request's chapters as its Pull request tab shows them: the story of its diff " +
    "told as chapters a reviewer reads in order. Name the pull request by its number, of a " +
    "coding agent's repository by the agent's id or of any repository the workspace's GitHub " +
    "installation reaches by its repository. It only reads, and never generates: " +
    `${MEMBER_MCP_TOOL.GENERATE_PULL_REQUEST_CHAPTERS} does, where none stand or they are stale. ` +
    CHAPTERS_ANSWER_WORDS,
  input: PullRequestChaptersInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    chaptersAsMember(asked, {
      generates: false,
      agent: (userId, agent, number) => agentChaptersRead(KEPT_PUBLISHED, userId, agent, number),
      repository: repositoryChaptersRead,
    }),
});

const GENERATE_PULL_REQUEST_CHAPTERS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.GENERATE_PULL_REQUEST_CHAPTERS,
  description:
    "Generate a pull request's chapters for its head now, as its Pull request tab's Generate " +
    "does, then answer them as " +
    `${MEMBER_MCP_TOOL.READ_PULL_REQUEST_CHAPTERS} does. It runs one model call on the member's ` +
    "own API key, which costs them money, and is far slower than reading, often a minute or " +
    `more: read first with ${MEMBER_MCP_TOOL.READ_PULL_REQUEST_CHAPTERS}, and generate only ` +
    "where no chapters stand, they are stale, or they failed. Where another Generate of the " +
    "same head is under way, it answers that one as generating rather than starting a second. " +
    "A pull request too large to tell is answered as failed, too_large. It runs on the " +
    "provider named, whose API key the member saved, as chaptersProviders in " +
    `${MEMBER_MCP_TOOL.LIST_MODELS} lists them, and is refused where they saved none of it. ` +
    "Name the pull request as the read does. " +
    CHAPTERS_ANSWER_WORDS,
  input: GeneratePullRequestChaptersInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  run: ({ provider, ...asked }) =>
    Effect.flatMap(AdmittedMember, (member) =>
      Effect.gen(function* () {
        const saved = yield* Effect.result(chaptersProvidersFor(member.userId));

        if (Result.isFailure(saved)) return agentToolRejected(CHAPTERS_REFUSAL.UNANSWERED);

        if (!saved.success.includes(provider)) {
          return agentToolRejected(chaptersProviderRefusal(saved.success));
        }

        return yield* chaptersAsMember(asked, {
          generates: true,
          agent: (userId, agent, number) =>
            agentChaptersGenerate({}, KEPT_PUBLISHED, userId, agent, String(number), provider),
          repository: (userId, query) => repositoryChaptersGenerate({}, userId, query, provider),
        });
      }),
    ),
});

/*
 * The comments and the memory. A description's comment threads, and its task's
 * pages', are read, answered, resolved, and reopened as the member, on a task
 * they can open, as their window's own threads are: a read and a settle run
 * the agents' own door (`../tasks/comment-tools.ts`), written under the
 * member rather than an agent, and a comment, a reply or a thread started on
 * the description's words, is answered as the desktop answers one
 * (`memberCommentAnswer`), so it hands its thread to the agents in it, and to
 * each one its words mention, as one typed in the window does. The
 * workspace's shared memory is searched, kept, and forgotten as the member,
 * in the workspace a slug names, only while that workspace
 * has Memory on (`experimentOnIn`), as Settings › Memory stands only then, and is
 * held to what the desktop holds the member to: the workspace's bound of
 * memories, and a forget of another member's words only for one who owns or
 * administers the workspace.
 */

/** Why a comment or a memory call took nothing, in words for one acting for the member. */
const MEMBER_NOTE_REFUSAL = {
  NO_WORDS:
    "Not posted: the description does not hold those words exactly once; copy them, or more of them, " +
    `from the description as ${MEMBER_MCP_TOOL.READ_TASK} reads it.`,
  NOT_MEMBER: "Not forgotten: the member no longer belongs to that workspace.",
  NOT_FORGETTABLE:
    "Not forgotten: the member may forget a memory in their own words alone, unless they own " +
    "or administer the workspace.",
} as const;

/** Who writes a member's comment: the member, never an agent. */
type MemberCommentWriter = Extract<
  DescriptionCommentWriterRef,
  { readonly actor: typeof DESCRIPTION_COMMENT_ACTOR.MEMBER }
>;

/** A comment call run as the member, on the task it names as the member reaches it, told whether its workspace has Task descriptions on, which the description's own threads stand on and a page's do not; refused where they reach no task. */
const commentAsMember = <R>(
  named: MemberTaskNamed,
  act: (
    writer: MemberCommentWriter,
    descriptionsOn: boolean,
    taskId: string,
  ) => Effect.Effect<WireRecord, never, R>,
) =>
  onMemberTask(
    named,
    { opening: "Not run", noTask: COMMENT_TOOL_REFUSAL.NO_TASK },
    ({ caller }, taskId) =>
      Effect.flatMap(
        experimentOnIn(callerWorkspaceId(caller), EXPERIMENT.DESCRIPTIONS),
        (descriptionsOn) =>
          act(
            { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: callerUserId(caller) },
            descriptionsOn,
            taskId,
          ),
      ),
  );

/** A member's comment as the store came to it, answered as the window's own is, its thread handed to the agents it reaches; a task or thread not reached refused. */
const memberCommented = (outcome: DescriptionCommentOutcome, comment: MentioningComment) => {
  if (outcome.status === DESCRIPTION_COMMENT_OUTCOME.DONE) {
    return Effect.map(memberCommentAnswer(outcome, comment), commentAnswerRead);
  }

  return Effect.succeed(
    commentToolRejected(
      outcome.status === DESCRIPTION_COMMENT_OUTCOME.NO_TASK
        ? COMMENT_TOOL_REFUSAL.NO_TASK
        : COMMENT_TOOL_REFUSAL.NO_THREAD,
    ),
  );
};

/** The task a comment tool acts on, by its id. */
const COMMENTED_TASK_INPUT = memberTaskInput("The task whose description's comments to act on");

/** A comment's words, as the member's own. */
const COMMENT_WORDS_INPUT = describeWire(
  descriptionCommentWordsSchema,
  "The comment, in plain words, as the member's own: every member of the workspace reads it " +
    "under the member's name.",
);

const ReadCommentsInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: COMMENTED_TASK_INPUT,
  page: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One of the task's pages, by the id a mention of it or a link to it names, to read its " +
        "threads instead of the description's.",
    ),
  ),
  status: READ_COMMENTS_TOOL.inputSchema.fields.status,
});

/** The task a comment call names where none of the member's workspaces has Task descriptions on, whose pages' comments it acts on. */
const PAGES_COMMENTED_TASK_INPUT = memberTaskInput("The task whose pages' comments to act on");

/** A read of a page's comments, where none of the member's workspaces has Task descriptions on: the task, the page, and which threads. */
const ReadCommentsInputSchemaOff = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: PAGES_COMMENTED_TASK_INPUT,
  page: describeWire(
    wireUuidSchema,
    "One of the task's pages, by the id a mention of it or a link to it names, whose threads " +
      "to read.",
  ),
  status: ReadCommentsInputSchema.fields.status,
});

const MEMBER_READ_COMMENTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_COMMENTS,
  description:
    "Read the comment threads on the description of a task the member can open, by its taskId, a " +
    "teammate's included, in whichever of the member's workspaces it stands, or on one of its " +
    "pages where you name the page: each thread's id, the words of the description it is on and their " +
    "section, whether those words were since deleted, every comment with who wrote it, when, " +
    "and the names of the files it carries, and the agents it was sent to. A page's thread " +
    "names the version it was left on and the element it is on, by its words and its path, or " +
    "none for the whole page. The open threads or the resolved ones, as status names. It only reads: " +
    "nobody is told.",
  input: ReadCommentsInputSchema,
  descriptionsOff: {
    description:
      "Read the comment threads on one of the pages of a task the member can open, by its taskId " +
      "and the page's id, a teammate's included, in whichever of the member's workspaces it " +
      "stands: each thread's id, the version it was left on and the element it is on, by its " +
      "words and its path, or none for the whole page, every comment with who wrote it, when, " +
      "and the names of the files it carries, and the agents it was sent to. The open threads " +
      "or the resolved ones, as status names. It only reads: nobody is told.",
    input: ReadCommentsInputSchemaOff,
  },
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) =>
    commentAsMember({ workspace, taskId: asked.taskId }, (writer, descriptionsOn, taskId) =>
      runCommentTool(
        READ_COMMENTS_TOOL.name,
        { taskId, writer, descriptionsOn },
        { ...asked, taskId },
      ),
    ),
});

const CommentOnDescriptionInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: COMMENTED_TASK_INPUT,
  quote: describeWire(
    Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
    ),
    "The words of the description the thread stands on, copied exactly from the description as " +
      `${MEMBER_MCP_TOOL.READ_TASK} reads it, as much as stands there exactly once.`,
  ),
  words: COMMENT_WORDS_INPUT,
});

type CommentOnDescriptionInput = typeof CommentOnDescriptionInputSchema.Type;

/**
 * A thread started on the words of the description as saved, the one place they
 * stand there, found as a note's replacement finds its words, with the
 * member's first comment, handed to the agents its words mention.
 */
const memberDescriptionComment = (writer: MemberCommentWriter, asked: CommentOnDescriptionInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const task = yield* readTask(writer.userId, asked.taskId);

      if (Option.isNone(task)) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
      const { text } = task.value;
      const anchor = locatedPhrase(text, asked.quote);

      if (anchor === undefined) return commentToolRejected(MEMBER_NOTE_REFUSAL.NO_WORDS);
      const clientKey = randomUUID();

      const outcome = yield* startDescriptionCommentThread(writer, asked.taskId, {
        clientKey,
        scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
        quote: text.slice(anchor.from, anchor.to),
        anchor,
        text,
        words: asked.words,
      });

      return yield* memberCommented(outcome, {
        userId: writer.userId,
        taskId: asked.taskId,
        words: asked.words,
        clientKey,
        isReply: false,
      });
    }),
  );

/** How a comment tool tells the outside agent whom a comment reaches. */
const MENTION_WORDS =
  "Each agent of the task the words mention by its link, built from the id " +
  `${MEMBER_MCP_TOOL.LIST_AGENTS} answers as this server's instructions say, joins the thread ` +
  "and is sent it, as a mention typed in the window does.";

const MEMBER_COMMENT_ON_DESCRIPTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.COMMENT_ON_DESCRIPTION,
  description:
    "Start a comment thread on words of the description of a task the member can open, by its taskId, " +
    "as the member's own comment in the description's margin: name the words by copying them from " +
    `the description as ${MEMBER_MCP_TOOL.READ_TASK} reads it, as much as stands there exactly once, ` +
    "and give the first comment. Every member of the workspace sees it beside those words. " +
    `${MENTION_WORDS} Each call starts a thread of its own, so call it once for each. Answers ` +
    "`accepted` with the thread as it stands, or `rejected` and why nothing was posted.",
  input: CommentOnDescriptionInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    commentAsMember({ workspace, taskId: asked.taskId }, (writer, descriptionsOn, taskId) =>
      descriptionsOn
        ? memberDescriptionComment(writer, { ...asked, taskId })
        : Effect.succeed(commentToolRejected(EXPERIMENT_OFF_REFUSAL)),
    ),
  experiment: EXPERIMENT.DESCRIPTIONS,
});

const ReplyToCommentInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: COMMENTED_TASK_INPUT,
  thread: REPLY_TO_COMMENT_TOOL.inputSchema.fields.thread,
  words: COMMENT_WORDS_INPUT,
});

type ReplyToCommentInput = typeof ReplyToCommentInputSchema.Type;

/**
 * A reply in the thread as the member's own words, refused on a resolved
 * thread, which the window offers no reply on, and handed to every agent in
 * the thread and each one its words mention.
 */
const memberReply = (
  writer: MemberCommentWriter,
  asked: ReplyToCommentInput,
  descriptionsOn: boolean,
) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const standing = Option.getOrUndefined(
        yield* readDescriptionCommentThread(writer.userId, asked.taskId, asked.thread),
      );

      if (descriptionThreadOff(standing, descriptionsOn)) {
        return commentToolRejected(EXPERIMENT_OFF_REFUSAL);
      }

      if (standing?.status === DESCRIPTION_COMMENT_STATUS.RESOLVED) {
        return commentToolRejected(COMMENT_TOOL_REFUSAL.RESOLVED);
      }

      const clientKey = randomUUID();

      const outcome = yield* actOnDescriptionCommentThread(writer, asked.taskId, asked.thread, {
        action: DESCRIPTION_COMMENT_ACTION.REPLY,
        clientKey,
        words: asked.words,
      });

      return yield* memberCommented(outcome, {
        userId: writer.userId,
        taskId: asked.taskId,
        words: asked.words,
        clientKey,
        isReply: true,
      });
    }),
  );

const MEMBER_REPLY_TO_COMMENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REPLY_TO_COMMENT,
  description:
    "Reply in one comment thread on the description of a task the member can open, or on one of its " +
    "pages, by the thread's id, as the member's own reply in the window would: every member " +
    "of the workspace sees it, and the thread is sent to every agent in it, each one sent it " +
    "before or that answered in it, and, on a page, the agent that showed the page; each reads " +
    `it as a message from the member and answers in the thread. ${MENTION_WORDS} A resolved ` +
    `thread takes no reply until ${MEMBER_MCP_TOOL.UPDATE_COMMENT} reopens it. Each call posts ` +
    "a reply of its own, so call it once for each. Answers `accepted` with the thread as it " +
    "now stands and, in unsent, the agents in it it could not reach, an archived one say, the " +
    "reply posted all the same; or `rejected` and why nothing was posted.",
  input: ReplyToCommentInputSchema,
  descriptionsOff: {
    description:
      "Reply in one comment thread on one of the pages of a task the member can open, by the " +
      "thread's id, as the member's own reply in the window would: every member of the " +
      "workspace sees it, and the thread is sent to every agent in it, each one sent it before " +
      "or that answered in it, and the agent that showed the page; each reads it as a message " +
      `from the member and answers in the thread. ${MENTION_WORDS} A resolved thread takes no ` +
      `reply until ${MEMBER_MCP_TOOL.UPDATE_COMMENT} reopens it. Each call posts a reply of its ` +
      "own, so call it once for each. Answers `accepted` with the thread as it now stands and, " +
      "in unsent, the agents in it it could not reach, an archived one say, the reply posted " +
      "all the same; or `rejected` and why nothing was posted.",
    input: Schema.Struct({
      ...ReplyToCommentInputSchema.fields,
      taskId: PAGES_COMMENTED_TASK_INPUT,
    }),
  },
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    commentAsMember({ workspace, taskId: asked.taskId }, (writer, descriptionsOn, taskId) =>
      memberReply(writer, { ...asked, taskId }, descriptionsOn),
    ),
});

const UpdateCommentInputSchema = Schema.Struct({
  workspace: TASK_WORKSPACE_INPUT,
  taskId: COMMENTED_TASK_INPUT,
  thread: UPDATE_COMMENT_TOOL.inputSchema.fields.thread,
  resolved: UPDATE_COMMENT_TOOL.inputSchema.fields.resolved,
});

const MEMBER_UPDATE_COMMENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_COMMENT,
  description:
    "Resolve or reopen one comment thread on the description of a task the member can open, or on one " +
    "of its pages, by the thread's id, as the member's own Resolve or Reopen would: a resolved " +
    "thread leaves the description's margin and stays in its history, under the member's name. " +
    "Answers `accepted` with the thread as it now stands, or `rejected` and why.",
  input: UpdateCommentInputSchema,
  descriptionsOff: {
    description:
      "Resolve or reopen one comment thread on one of the pages of a task the member can open, " +
      "by the thread's id, as the member's own Resolve or Reopen would: a resolved thread " +
      "leaves the open ones and stays in its history, under the member's name. Answers " +
      "`accepted` with the thread as it now stands, or `rejected` and why.",
    input: Schema.Struct({
      ...UpdateCommentInputSchema.fields,
      taskId: PAGES_COMMENTED_TASK_INPUT,
    }),
  },
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, ...asked }) =>
    commentAsMember({ workspace, taskId: asked.taskId }, (writer, descriptionsOn, taskId) =>
      runCommentTool(
        UPDATE_COMMENT_TOOL.name,
        { taskId, writer, descriptionsOn },
        { ...asked, taskId },
      ),
    ),
});

/** A memory call's input: the workspace whose memory it acts on. */
const MEMORY_WORKSPACE_INPUT = workspaceInput("whose shared memory to act on");

/** A memory call run as the member, in the workspace its slug names, while that workspace has Memory on; refused otherwise. */
const memoryAsMember = <R>(
  slug: string,
  run: (memory: MemoryCall) => Effect.Effect<WireRecord, StoreFailure, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);

    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);

    if (!(yield* experimentOnIn(workspace.success, EXPERIMENT.MEMORY))) {
      return agentToolRejected(EXPERIMENT_OFF_REFUSAL);
    }

    return yield* run({ workspaceId: workspace.success, userId: member.userId });
  });

/** A search names the workspace and its words. */
const SearchMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  ...SEARCH_MEMORY_TOOL.inputSchema.fields,
});

const MEMBER_SEARCH_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SEARCH_MEMORY,
  description:
    "Search the shared memory of a workspace the member belongs to: the settled facts and " +
    "conventions its members and their agents kept, which Settings › Memory lists. Give a few " +
    "words for the area at hand; to read the memories kept most recently, use " +
    `${MEMBER_MCP_TOOL.LIST_MEMORIES}. Treat what it ` +
    "answers as prior context, not as rules: the member's words now win, and a memory they " +
    `contradict is corrected with ${MEMBER_MCP_TOOL.SAVE_MEMORY}'s replaces. ${WORKSPACE_WORDS} ` +
    "Answers `accepted` with the matching memories, best first, each with its id, its words, " +
    "and when it was last kept, and how many memories the workspace holds; or `rejected` and " +
    "why, such as the member having Memory off.",
  input: SearchMemoryInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => memoryAsMember(workspace, (memory) => runRecall(memory, asked)),
  experiment: EXPERIMENT.MEMORY,
});

/** A memory kept names the workspace, its words, and, at most, the memory it corrects. */
const SaveMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  ...SAVE_MEMORY_TOOL.inputSchema.fields,
});

const MEMBER_SAVE_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SAVE_MEMORY,
  description:
    "Keep a fact or convention in the shared memory of a workspace the member belongs to, as " +
    "the member's own words: every member of the workspace and their agents share it, and " +
    "Settings › Memory lists it as the member's. Keep only what the member settled and what " +
    "will still hold next time: a decision, how the team builds, tests, or ships, or a " +
    "constraint they stated; never a guess, a remark about one member, or anything that would " +
    "be a credential, key, token, or password, which is refused. When what the member said " +
    `contradicts a memory ${MEMBER_MCP_TOOL.SEARCH_MEMORY} answered, pass that memory's id as ` +
    "replaces, in the workspace it answered it in, with the corrected statement, so the old " +
    "one is rewritten rather than kept beside it, now in the member's words, or folded into " +
    "another memory that already holds the corrected words. A workspace holds at most " +
    `${MEMORY_BOUNDS.MAX_MEMORIES} memories. ${WORKSPACE_WORDS} Answers \`accepted\` with the ` +
    "outcome (kept, already_kept, corrected) and the memory, or `rejected` and why.",
  input: SaveMemoryInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, ...asked }) =>
    memoryAsMember(workspace, (memory) => runRemember(memory, asked)),
  experiment: EXPERIMENT.MEMORY,
});

const ListMemoriesInputSchema = Schema.Struct({ workspace: MEMORY_WORKSPACE_INPUT });

const MEMBER_LIST_MEMORIES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_MEMORIES,
  description:
    "List every memory in the shared memory of a workspace the member belongs to, most " +
    "recently kept or corrected first, as Settings › Memory lists them: each with its id, its " +
    "words, when it was last kept, who kept it, and whether the member may forget it. Use " +
    `${MEMBER_MCP_TOOL.SEARCH_MEMORY} to find the few about an area at hand; list them all ` +
    `only when the member asks to review what the workspace keeps. ${WORKSPACE_WORDS} ` +
    "Answers `accepted` with the memories and how many there are, or `rejected` and why, such " +
    "as the member having Memory off.",
  input: ListMemoriesInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) => memoryAsMember(workspace, runListMemories),
  experiment: EXPERIMENT.MEMORY,
});

const ForgetMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  memoryId: describeWire(
    memoryIdSchema,
    `The memory to forget, by the id ${MEMBER_MCP_TOOL.SEARCH_MEMORY} answered it.`,
  ),
});

/**
 * One of the workspace's memories forgotten as the member, as their Forget
 * in Settings › Memory does: refused where its words are another member's
 * and the member does not manage the workspace, and counted as theirs.
 */
const memberForget = (memory: MemoryCall, memoryId: string) =>
  Effect.gen(function* () {
    const { userId, workspaceId } = memory;
    const answer = yield* forgetWorkspaceMemory(userId, workspaceId, memoryId);

    switch (answer.kind) {
      case WORKSPACE_MEMORY.NOT_MEMBER:
        return agentToolRejected(MEMBER_NOTE_REFUSAL.NOT_MEMBER);
      case WORKSPACE_MEMORY.NOT_PERMITTED:
        return agentToolRejected(MEMBER_NOTE_REFUSAL.NOT_FORGETTABLE);
      case WORKSPACE_MEMORY.READ:
        yield* recordServerEvent(SERVER_EVENT.MEMORY_FORGET, { userId, workspaceId }, {});

        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          forgotten: memoryId,
          total: answer.memories.length,
        };
    }
  });

const MEMBER_FORGET_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.FORGET_MEMORY,
  description:
    "Forget one memory of a workspace the member belongs to, by its id, as their Forget in " +
    "Settings › Memory would: it is deleted for good, and no later search finds it. The member " +
    "may forget a memory in their own words, and one in any member's where they own or " +
    `administer the workspace. ${WORKSPACE_WORDS} Answers \`accepted\` with the memory's id and ` +
    "how many memories the workspace then holds, a memory already gone among it, or " +
    "`rejected` and why.",
  input: ForgetMemoryInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, memoryId }) =>
    memoryAsMember(workspace, (memory) => memberForget(memory, memoryId)),
  experiment: EXPERIMENT.MEMORY,
});

/*
 * The automations. Each runs the agents' own door for it
 * (`../agents/automation-tools.ts`) with the member as the caller, on the
 * member's write call: an automation is made in the workspace its slug
 * names, in the repositories named or none, since the member works in none,
 * as the member's own, and one named by its id is about the workspace that
 * holds it, as the member reads it. A webhook trigger is never made or set
 * here, so no answer carries a webhook secret: its secret is shown once, in
 * the window that minted it (`AGENTS.md`).
 */

/** The workspace of an automation the member may read, by its id. */
const automationWorkspace = (userId: string, automationId: string) =>
  Effect.map(
    readAutomation(userId, automationId),
    Option.map((automation) => automation.organizationId),
  );

/** How an automation tool tells the agent the trigger it never makes. */
const WEBHOOK_WORDS =
  `A webhook trigger is made only on the automations page in ${PRODUCT_NAME}, which shows ` +
  "its secret once, so no answer here carries one.";

/** The fields whose agents' words name the coding agent's own world, in the member's: no repository is theirs by default, and their connections are named by what they connect. */
const MEMBER_AUTOMATION_FIELDS = {
  repositories: Schema.optionalKey(
    describeWire(
      automationCreateRequestSchema.fields.repositories.schema,
      "owner/name, reached by the workspace's GitHub installation; runs start in the first. [] " +
        "for none, which a GitHub trigger cannot take.",
    ),
  ),
  disabledServers: Schema.optionalKey(
    describeWire(
      disabledServersSchema,
      "The member's connections each run's agent is not handed, by what they connect, such as " +
        "neon, sentry, or notion-2 for a second Notion account; the whole list.",
    ),
  ),
  slackDelivery: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      `Send each run's result to the member on Slack from ${PRODUCT_NAME}'s bot, so the run's ` +
        "agent needs no Slack of its own; the workspace must have the bot connected.",
    ),
  ),
};

/** A list of automations names the workspace it lists, or one automation to read whole. */
const ListAutomationsInputSchema = Schema.Struct({
  workspace: Schema.optionalKey(
    describeWire(
      WORKSPACE_SLUG,
      `The workspace to list, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered: ` +
        "required without automationId; leave it out with automationId, whose automation " +
        "settles it.",
    ),
  ),
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One automation to read whole, its prompt in full and its newest runs, by the id this " +
        "tool answered; leave it out to list them all.",
    ),
  ),
});

const MEMBER_LIST_AUTOMATIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AUTOMATIONS,
  description:
    "List the automations of a workspace the member belongs to that the member may read, " +
    "newest first: each with its id, name, whether it is on, its trigger, the start of its " +
    "prompt, the model and effort its runs take, its repositories, where its runs land, its " +
    "scope, when it is next due, its newest run, and whether the member made it " +
    "(madeByYourDeveloper). Name an automationId to read that one whole, in whichever of the " +
    "member's workspaces it stands, its prompt in full and its newest runs, each with why it " +
    "was skipped or failed and the agent it started. An automation fires on a schedule, a " +
    "GitHub event, a webhook, or a Sentry event, and starts an agent on its prompt, as its " +
    "creator. Name the workspace to list by its slug, even where the member belongs to one " +
    `alone; ${MEMBER_MCP_TOOL.LIST_WORKSPACES} names them. Answers \`accepted\` with them, or ` +
    "`rejected` and why.",
  input: ListAutomationsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => {
    const { automationId } = asked;
    const list = (call: AgentReadCall) => runListAutomations(call, asked);

    if (automationId !== undefined) {
      return readAsMember(
        (userId) => automationWorkspace(userId, automationId),
        AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
        list,
      );
    }

    return workspace === undefined
      ? Effect.succeed(
          agentToolRejected(MEMBER_WORKSPACE_REFUSAL.MISSING("a list with no automationId")),
        )
      : listAsMember(workspace, list);
  },
});

/** An automation the member makes names the workspace it is made in, and what the agents' own make names, in the member's words. */
const CreateAutomationInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...CREATE_AUTOMATION_TOOL.inputSchema.fields,
  ...MEMBER_AUTOMATION_FIELDS,
  repositories: MEMBER_AUTOMATION_FIELDS.repositories.schema,
  slackDelivery: MEMBER_AUTOMATION_FIELDS.slackDelivery.schema,
  runsOn: describeWire(
    AUTOMATION_RUNS_ON,
    `Where each run's agent starts: ${JSON.stringify({ machine: AGENT_MACHINE.VERCEL })} for ` +
      `the cloud, or ${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, device: "<name>" })} for ` +
      "one of the member's own devices (a Mac or a host) by its name, or " +
      `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, deviceId: "<id>" })} by its id; ` +
      `${MEMBER_MCP_TOOL.LIST_MACHINES} lists each place with the runsOn to pass. A run that ` +
      "fires while its device is offline fails. It places each agent a run starts: a run handed " +
      "to the one agent named runs where that agent already runs.",
  ),
});

const MEMBER_CREATE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_AUTOMATION,
  description:
    "Make an automation in a workspace the member belongs to, as their own automations page " +
    `would: each time its trigger fires, ${PRODUCT_NAME} starts an agent on its prompt, in its ` +
    "repositories or in none, on the member's keys and connections, on a task of its own with no " +
    "one watching, or hands the run to the one agent named. It is on as it is made, runs as the " +
    "member, and the desktop shows it as one they made. It works in the repositories named, " +
    "or in none where you name []. Name its repositories, model, effort, scope, " +
    "archiveSuccessful, slackDelivery, and the machine its runs start on (runsOn): none is " +
    `taken from the member's defaults; ${MEMBER_MCP_TOOL.LIST_MODELS} answers the models and ` +
    `efforts, and ${MEMBER_MCP_TOOL.LIST_MACHINES} the machines. One fired by Sentry needs ${PRODUCT_NAME}'s Sentry ` +
    `integration installed on the workspace first. ${WEBHOOK_WORDS} ${WORKSPACE_WORDS} Make ` +
    `one when the member asks for it, and read ${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} first so ` +
    "you make none they already have. Each call makes an automation of its own, so call it " +
    "once for each. Answers `accepted` with the automation as it stands, or `rejected` and why.",
  input: CreateAutomationInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateAutomation(call, asked)),
});

/** A change to an automation names what the agents' own does, in the member's words. */
const UpdateAutomationInputSchema = Schema.Struct({
  ...UPDATE_AUTOMATION_TOOL.inputSchema.fields,
  ...MEMBER_AUTOMATION_FIELDS,
});

const MEMBER_UPDATE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_AUTOMATION,
  description:
    "Change an automation the member may change, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} answered it, in whichever of the member's workspaces ` +
    "it stands, as its editor on the automations page would: what you leave out stands, and a " +
    "trigger given replaces the one standing whole, a switch to Sentry needing " +
    `${PRODUCT_NAME}'s Sentry integration installed on the workspace. A personal automation ` +
    "is its creator's alone to change, and a workspace's its creator's, owners', and admins'; " +
    "enabled alone, which pauses or resumes it, is open to more of the workspace. " +
    `${WEBHOOK_WORDS} Change one only where the member asked for it. Answers \`accepted\` ` +
    "with the automation as it now stands, or `rejected` and why.",
  input: UpdateAutomationInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runUpdateAutomation(call, asked),
    ),
});

const MEMBER_RUN_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RUN_AUTOMATION,
  description:
    `Run an automation the member may run now, by its id as ${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} ` +
    "answered it, in whichever of the member's workspaces it stands, as its Run now on the " +
    "automations page would: one run, whatever its trigger, " +
    "starting its agent on its prompt as its creator, as a scheduled run would, or " +
    "handing it to the one agent it names. A personal automation is its creator's to run, and " +
    "a workspace's every member's. Run one when the member asks for it, such as to try an " +
    "automation just made. Each call is a run of its own, so call it once for each. Answers " +
    "`accepted` with the run, started with its agent or skipped or failed and why, or " +
    `\`rejected\` and why. ${FOLLOW_WORDS}`,
  input: RUN_AUTOMATION_TOOL.inputSchema,
  annotations: ADDITIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runRunAutomation(call, asked),
    ),
});

const MEMBER_DELETE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_AUTOMATION,
  description:
    "Delete an automation the member may delete, with its history of runs, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} answered it, in whichever of the member's workspaces ` +
    "it stands, as its Delete on the automations page would; the agents its runs started " +
    "stay. A personal automation is its creator's alone, and a workspace's its creator's, " +
    "owners', and admins'. Delete one only when the member asks for it, and pause one with " +
    `${MEMBER_MCP_TOOL.UPDATE_AUTOMATION}'s enabled false where they only want it to stop. ` +
    "Answers `accepted` with the automation's id and name, or `rejected` and why.",
  input: DELETE_AUTOMATION_TOOL.inputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runDeleteAutomation(call, asked),
    ),
});

/*
 * The member's own integrations, the outside MCP clients they allowed, and
 * their workspaces' Sentry (`integrations.ts`), each through the operation
 * its window's procedure runs. A connect answers the address the member
 * opens to sign in, and runs no sign-in; no answer carries a credential.
 */

/** One account at a provider, by the connection name `list_integrations` answered. */
const INTEGRATION_CONNECTION_INPUT = describeWire(
  integrationConnectionNameSchema,
  `The account, by the connection name ${MEMBER_MCP_TOOL.LIST_INTEGRATIONS} answered, such as ` +
    "notion, or notion-2 for a second Notion account.",
);

/** The provider a connection name is an account at; its pattern names one, so the name itself stands in only for a defect. */
const connectionProvider = (connection: string): string =>
  integrationConnectionOf(connection)?.provider ?? connection;

const LIST_INTEGRATIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_INTEGRATIONS,
  description:
    "List the member's own integrations, as Settings › Integrations shows them: where each " +
    "provider stands for them (connected, pending, expired, disconnected, or unavailable on " +
    "this deployment), every account they hold, each by its connection name, its provider, " +
    "its label, and where it stands, the providers they may add another account at, and any " +
    "sign-in that ended without a grant, and why. A sign-in under way is settled first. " +
    "Answers `accepted` with them, never a token, or `rejected` and why.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: listIntegrationsAsMember,
});

const ConnectIntegrationInputSchema = Schema.Struct({
  provider: describeWire(integrationProviderSchema, "The provider to sign in to."),
  account: describeWire(
    Schema.Union([
      Schema.Struct({
        connection: describeWire(
          integrationConnectionNameSchema,
          `The account to sign in, by the connection name ${MEMBER_MCP_TOOL.LIST_INTEGRATIONS} ` +
            "answered to sign it in again, or the provider's own name, such as notion, for its " +
            "first account.",
        ),
      }),
      Schema.Struct({
        add: describeWire(
          Schema.Literal(true),
          "true to sign in another account at the provider, where it takes more than one.",
        ),
      }),
    ]),
    "Which account: {connection} to sign one in by its name, or {add: true} for a new one.",
  ),
});

const CONNECT_INTEGRATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CONNECT_INTEGRATION,
  description:
    "Begin connecting one of the member's integrations, as their Connect in Settings › " +
    "Integrations does, and answer the link they open in their own browser to sign in to the " +
    "provider: nothing is connected until they finish it there, so hand them the link, and " +
    `read where it stands afterwards with ${MEMBER_MCP_TOOL.LIST_INTEGRATIONS}. Answers ` +
    "`accepted` with the link and the connection name of the account it signs in, or " +
    "`rejected` and why, such as a provider this deployment does not offer them.",
  input: ConnectIntegrationInputSchema,
  annotations: ADDITIVE,
  run: connectIntegrationAsMember,
});

const ListIntegrationToolsInputSchema = Schema.Struct({
  connection: INTEGRATION_CONNECTION_INPUT,
});

const LIST_INTEGRATION_TOOLS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_INTEGRATION_TOOLS,
  description:
    "List the tools one of the member's connected integration accounts offers their agents, " +
    "by its connection name, as Settings › Integrations lists them: each tool's name, which " +
    "an agent calls it by, and what it does as the provider's server describes it. Where the " +
    "server listed none, such as a grant the provider no longer honors, it answers why " +
    `instead, which ${MEMBER_MCP_TOOL.CONNECT_INTEGRATION} may mend. Answers \`accepted\` with ` +
    "them, never a token, or `rejected` and why, such as an account not connected.",
  input: ListIntegrationToolsInputSchema,
  annotations: READ_ONLY,
  run: ({ connection }) => listIntegrationToolsAsMember(connectionProvider(connection), connection),
});

const RenameIntegrationInputSchema = Schema.Struct({
  connection: INTEGRATION_CONNECTION_INPUT,
  label: describeWire(
    integrationRenameRequestSchema.fields.label,
    "What the member calls the account, such as the workspace it is at the provider.",
  ),
});

const RENAME_INTEGRATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RENAME_INTEGRATION,
  description:
    "Rename one of the member's integration accounts, by its connection name, as their " +
    "Rename in Settings › Integrations does: the label they know it by. Answers `accepted` " +
    "with the account as it then stands, or `rejected` and why.",
  input: RenameIntegrationInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ connection, label }) =>
    renameIntegrationAsMember(connectionProvider(connection), connection, label),
});

const DisconnectIntegrationInputSchema = Schema.Struct({
  connection: INTEGRATION_CONNECTION_INPUT,
});

const DISCONNECT_INTEGRATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DISCONNECT_INTEGRATION,
  description:
    "Disconnect one of the member's integration accounts, by its connection name, as their " +
    "Disconnect in Settings › Integrations does: their agents lose its tools from their next " +
    "step, and the provider's grant is revoked; every other account stands. GitHub, whose " +
    `grant is the member's own GitHub sign-in, is refused. Connecting it again takes ` +
    `${MEMBER_MCP_TOOL.CONNECT_INTEGRATION} and the member's browser. Answers \`accepted\` with ` +
    "where the account then stands, or `rejected` and why.",
  input: DisconnectIntegrationInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ connection }) =>
    disconnectIntegrationAsMember(connectionProvider(connection), connection),
});

const LIST_MCP_CLIENTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_MCP_CLIENTS,
  description:
    `List the outside MCP clients the member allowed to act for them on ${PRODUCT_NAME}'s MCP ` +
    "server, as Settings › MCP lists them, and the server's address: each client by its id " +
    "and name, where it signs in, when the member allowed it, and when it last renewed its " +
    `access. ${MEMBER_MCP_TOOL.REVOKE_MCP_CLIENT} revokes one. Answers \`accepted\` with them, ` +
    "never a token, or `rejected` and why.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: listMcpClientsAsMember,
});

const RevokeMcpClientInputSchema = Schema.Struct({
  clientId: describeWire(
    mcpClientIdSchema,
    `The client, by the id ${MEMBER_MCP_TOOL.LIST_MCP_CLIENTS} answered.`,
  ),
});

const REVOKE_MCP_CLIENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REVOKE_MCP_CLIENT,
  description:
    "Revoke one outside MCP client the member allowed, by its id, as Revoke in Settings › MCP " +
    "does: the member's own consent to it and the tokens it holds for them are deleted, and " +
    "no other member's. It cannot renew its access, and its next sign-in asks the member " +
    `again. Revoking the client making this call cuts that client off: its access ends within ` +
    `${MCP_ACCESS_TOKEN_MINUTES} minutes and it must sign in again. A client the member never ` +
    `allowed, or ${PRODUCT_NAME}'s own Mac or iPhone app, is left as it is. Answers \`accepted\` with ` +
    "the clients as they then stand, never a token, or `rejected` and why.",
  input: RevokeMcpClientInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ clientId }) => revokeMcpClientAsMember(clientId),
});

const ListSentryInstallationsInputSchema = Schema.Struct({ workspace: WORKSPACE_INPUT });

const LIST_SENTRY_INSTALLATIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_SENTRY_INSTALLATIONS,
  description:
    "List the Sentry organizations a workspace the member belongs to has linked through " +
    `${PRODUCT_NAME}'s Sentry integration, as its Settings › Integrations shows them: whether ` +
    "this deployment offers the integration, and each installation by its id and the " +
    `organization it is on, where known. ${WORKSPACE_WORDS} Linking one takes the member's ` +
    "browser, in the app. Answers `accepted` with them, or `rejected` and why.",
  input: ListSentryInstallationsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) => asMemberInWorkspace(workspace, readSentryAsMember),
});

const DisconnectSentryInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  installationId: describeWire(
    workspaceSentryDisconnectRequestSchema.fields.installationId,
    `The installation, by the id ${MEMBER_MCP_TOOL.LIST_SENTRY_INSTALLATIONS} answered.`,
  ),
});

const DISCONNECT_SENTRY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DISCONNECT_SENTRY,
  description:
    "Disconnect one of a workspace's Sentry installations, by its id, as its Disconnect in " +
    "Settings › Integrations does: its issues and alerts start no automation of the workspace " +
    "from then on, though the integration stays installed on the Sentry organization until " +
    "it is uninstalled there. Only an owner or an admin of the workspace may. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the installations left, or \`rejected\` and why.`,
  input: DisconnectSentryInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, installationId }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      disconnectSentryAsMember(userId, workspaceId, installationId),
    ),
});

// A workspace's cloud sandbox setup (`../workspace-sandbox-setup/workspace-sandbox-setup.ts`), read and saved as Settings does.

/** Why a setup was not read or saved, in words the agent can act on. */
const SANDBOX_SETUP_REFUSAL = {
  NO_WORKSPACE: `Not run: the member is no longer in that workspace; ${MEMBER_MCP_TOOL.LIST_WORKSPACES} names theirs.`,
  NOT_PERMITTED:
    "Not saved: only an owner or an admin of the workspace saves its sandbox setup, and the " +
    "member is neither.",
  UNAVAILABLE:
    "Not run: the service could not reach the workspace's sandbox setup just now. The call may " +
    "be made again.",
} as const;

/** A read's or a save's refusal in the agent's words. */
function sandboxSetupRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return SANDBOX_SETUP_REFUSAL.NO_WORKSPACE;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return SANDBOX_SETUP_REFUSAL.NOT_PERMITTED;
    default:
      return SANDBOX_SETUP_REFUSAL.UNAVAILABLE;
  }
}

/** A setup read or saved as the member, as the agent reads it, or the refusal in its words. */
const sandboxSetupAnswer = <R>(
  answered: Effect.Effect<WorkspaceSandboxSetupAnswer, HostedRefusal, R>,
  accepted: (setup: WorkspaceSandboxSetupAnswer) => WireRecord,
) =>
  answered.pipe(
    Effect.map(accepted),
    Effect.catch((refusal) => Effect.succeed(agentToolRejected(sandboxSetupRefusalWords(refusal)))),
  );

/** The workspace whose setup a call reads or saves. */
const SANDBOX_SETUP_WORKSPACE_INPUT = workspaceInput("whose setup it is");

const ReadSandboxSetupInputSchema = Schema.Struct({ workspace: SANDBOX_SETUP_WORKSPACE_INPUT });

/** Which script a save replaces: the workspace's install script, or one repository's setup script. */
const SANDBOX_SETUP_TARGET_KIND = {
  WORKSPACE: "workspace",
  REPOSITORY: "repository",
} as const;

const SandboxSetupTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(SANDBOX_SETUP_TARGET_KIND.WORKSPACE) }),
  Schema.Struct({
    kind: Schema.Literal(SANDBOX_SETUP_TARGET_KIND.REPOSITORY),
    repository: describeWire(
      githubRepositoryFullNameSchema,
      "The repository whose setup script to save, as owner/name.",
    ),
  }),
]);

const EditSandboxSetupInputSchema = Schema.Struct({
  workspace: SANDBOX_SETUP_WORKSPACE_INPUT,
  target: describeWire(
    SandboxSetupTargetSchema,
    `The script to save: kind ${SANDBOX_SETUP_TARGET_KIND.WORKSPACE} for the workspace's install ` +
      `script, which runs once in each build of a repository's base snapshot; or kind ` +
      `${SANDBOX_SETUP_TARGET_KIND.REPOSITORY} with repository, as owner/name, for that ` +
      "repository's setup script, which runs once in each new agent sandbox of it.",
  ),
  script: describeWire(
    workspaceInstallScriptPutRequestSchema.fields.script,
    "The whole script, which replaces the one that stood; an empty one removes it.",
  ),
});

const READ_SANDBOX_SETUP_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_SANDBOX_SETUP,
  description:
    "Read the cloud sandbox setup of a workspace the member belongs to, as its Settings › Cloud " +
    "environment shows it: its install script, which runs once in each build of a repository's base " +
    "snapshot; each repository's setup script, which runs once in each new agent sandbox " +
    "of it after its checkout, each script with when it was last saved in epoch milliseconds and how " +
    "it last ran where it has; and each repository's run actions, the commands a member runs " +
    "in one of its agents' sandboxes from the Run menu, each with its id, label, command, " +
    `icon, and whether it is the default. ${WORKSPACE_WORDS} Answers the install script, or ` +
    "install null where none is saved, the repositories' setup scripts and " +
    "run actions, each in the order of their names, or `rejected` and why.",
  input: ReadSandboxSetupInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    listAsMember(workspace, ({ caller }) =>
      sandboxSetupAnswer(
        readSandboxSetup(callerUserId(caller), callerWorkspaceId(caller)),
        (setup) => setup,
      ),
    ),
});

const EDIT_SANDBOX_SETUP_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.EDIT_SANDBOX_SETUP,
  description:
    "Save one script of the cloud sandbox setup of a workspace the member is an owner or an " +
    "admin of, as its Settings › Cloud environment would: the target names which, the " +
    "workspace's install script or a repository's setup script, under any casing of its name. The " +
    "script given replaces the one that stood whole, so read it first with " +
    `${MEMBER_MCP_TOOL.READ_SANDBOX_SETUP} to change part of it; an empty script removes it. ` +
    "Sandboxes already running keep the script they ran. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the setup as it then stands, or ` +
    "`rejected` and why.",
  input: EditSandboxSetupInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, target, script }) =>
    listAsMember(workspace, ({ caller }) =>
      sandboxSetupAnswer(
        target.kind === SANDBOX_SETUP_TARGET_KIND.WORKSPACE
          ? saveInstallScript(callerUserId(caller), callerWorkspaceId(caller), script)
          : saveRepositorySetup(
              callerUserId(caller),
              callerWorkspaceId(caller),
              target.repository,
              script,
            ),
        (setup) => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...setup }),
      ),
    ),
});

/*
 * A repository's run actions, one at a time, through the operation the
 * hosted `editRunAction` runs (`editRunAction`), which reads the list as it
 * stands and writes it back under the repository's lock; and one of them
 * run or stopped in a coding agent's sandbox, through the operations the
 * Run menu's procedures run (`../agents/run-actions.ts`), as the member, by
 * the Terminal tab's rule.
 */

/** Why an edit of a run action saved nothing, in words the agent can act on. */
const RUN_ACTION_EDIT_REFUSAL = {
  NOT_FOUND:
    "Not saved: the member is no longer in that workspace, or the repository has no run action " +
    `of that id; ${MEMBER_MCP_TOOL.READ_SANDBOX_SETUP} lists each repository's actions.`,
  INVALID:
    `Not saved: a repository keeps at most ${WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS} ` +
    "run actions, so remove one before adding another.",
} as const;

/** An edit's refusal in the agent's words: the edit's own, or a setup save's. */
function runActionEditRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return RUN_ACTION_EDIT_REFUSAL.NOT_FOUND;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return RUN_ACTION_EDIT_REFUSAL.INVALID;
    default:
      return sandboxSetupRefusalWords(refusal);
  }
}

const RUN_ACTION_FIELDS = workspaceRunActionEditRequestSchema.fields;

/** What an edit of a run action does, which names the fields it takes. */
const RUN_ACTION_OPERATION = {
  ADD: "add",
  CHANGE: "change",
  REMOVE: "remove",
} as const;

const RUN_ACTION_ID_INPUT = describeWire(
  RUN_ACTION_FIELDS.actionId.schema,
  `The action, by the id ${MEMBER_MCP_TOOL.READ_SANDBOX_SETUP} answered.`,
);

const RUN_ACTION_LABEL_WORDS = "What the Run menu and the action's Terminal tab call it.";

const RUN_ACTION_COMMAND_WORDS =
  "The bash it runs from the repository's checkout, with the workspace's environment " +
  "variables, such as pnpm dev.";

/** The fields an add sets and a change may change; each left out is the menu's own on an add and unchanged on a change. */
const RUN_ACTION_SETTINGS = {
  icon: Schema.optionalKey(
    describeWire(
      RUN_ACTION_FIELDS.icon.schema,
      "The icon it wears in the Run menu, one emoji or one Lucide icon by its kebab-case name " +
        "in a color or none, such as rocket; null for the menu's own.",
    ),
  ),
  isDefault: Schema.optionalKey(
    describeWire(
      RUN_ACTION_FIELDS.isDefault.schema,
      "true to make it the repository's default, which the Run button runs, so no other " +
        "action is; false to make it no longer the default.",
    ),
  ),
  position: Schema.optionalKey(
    describeWire(
      RUN_ACTION_FIELDS.position.schema,
      "Its place in the list after the edit, from 0, a place past the end being the last; an " +
        "added action goes last and a changed one stays where it stood where left out.",
    ),
  ),
};

/** One edit, by its operation, with only the fields that operation takes. */
const RunActionEditSchema = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal(RUN_ACTION_OPERATION.ADD),
    label: describeWire(RUN_ACTION_FIELDS.label.schema, RUN_ACTION_LABEL_WORDS),
    command: describeWire(RUN_ACTION_FIELDS.command.schema, RUN_ACTION_COMMAND_WORDS),
    ...RUN_ACTION_SETTINGS,
  }),
  Schema.Struct({
    operation: Schema.Literal(RUN_ACTION_OPERATION.CHANGE),
    actionId: RUN_ACTION_ID_INPUT,
    label: Schema.optionalKey(describeWire(RUN_ACTION_FIELDS.label.schema, RUN_ACTION_LABEL_WORDS)),
    command: Schema.optionalKey(
      describeWire(RUN_ACTION_FIELDS.command.schema, RUN_ACTION_COMMAND_WORDS),
    ),
    ...RUN_ACTION_SETTINGS,
  }),
  Schema.Struct({
    operation: Schema.Literal(RUN_ACTION_OPERATION.REMOVE),
    actionId: RUN_ACTION_ID_INPUT,
  }),
]);

/**
 * An edit names the workspace, the repository, and the edit. Note that the
 * edit is nested under `edit`, because a tool's input must be an object at
 * its top, and an object may not be a union there.
 */
const EditRunActionInputSchema = Schema.Struct({
  workspace: SANDBOX_SETUP_WORKSPACE_INPUT,
  repository: describeWire(
    RUN_ACTION_FIELDS.repository,
    "The repository whose run actions to edit, as owner/name, under any casing of its name.",
  ),
  edit: describeWire(
    RunActionEditSchema,
    "The edit, by its operation, with only the fields it takes: add (label, command, and " +
      "optionally icon, isDefault, and position); change (actionId, and any of label, command, " +
      "icon, isDefault, and position, each left out unchanged); or remove (actionId).",
  ),
});

/** An edit as the hosted operation reads it: a remove its flag, a change and an add their fields. */
function runActionEdit(
  edit: typeof RunActionEditSchema.Type,
): Omit<WorkspaceRunActionEdit, "workspaceId" | "repository"> {
  switch (edit.operation) {
    case RUN_ACTION_OPERATION.REMOVE:
      return { actionId: edit.actionId, remove: true };
    case RUN_ACTION_OPERATION.CHANGE:
    case RUN_ACTION_OPERATION.ADD: {
      const { operation: _operation, ...fields } = edit;

      return fields;
    }
  }
}

const EDIT_RUN_ACTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.EDIT_RUN_ACTION,
  description:
    "Add, change, move, or remove one run action of a repository in a workspace the member " +
    "is an owner or an admin of, as its Settings › Cloud environment would. A run action is a " +
    "command a member runs in one of the repository's cloud agents' sandboxes, from the Run " +
    "menu over the agent's tabs, each only when pressed. With no actionId an action is added " +
    "with its label and command; with one, that action changes in only what is given, or is " +
    "removed. The service edits the list as it stands, so an edit never undoes another made " +
    "meanwhile, and an action keeps its id as it changes. Agents already running list the " +
    `actions afresh. ${WORKSPACE_WORDS} Answers \`accepted\` with the setup as it then ` +
    "stands, or `rejected` and why.",
  input: EditRunActionInputSchema,
  // Note that an add made twice adds two actions, so the edit is not idempotent as a save is.
  annotations: { readOnlyHint: false, destructiveHint: true },
  run: ({ workspace, repository, edit }) =>
    listAsMember(workspace, ({ caller }) =>
      editRunAction(callerUserId(caller), callerWorkspaceId(caller), {
        ...runActionEdit(edit),
        repository,
        workspaceId: callerWorkspaceId(caller),
      }).pipe(
        Effect.map((setup): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...setup })),
        Effect.catch((refusal) =>
          Effect.succeed(agentToolRejected(runActionEditRefusalWords(refusal))),
        ),
      ),
    ),
});

/** Why a run action was not run or stopped, in words for one acting for the member. */
const RUN_ACTION_REFUSAL = {
  NOT_FOUND:
    "Not run: the member sees no such agent, or it runs on a Mac or has no repository, its " +
    "workspace has Run actions off, or it has no run action of that id, saved to run or " +
    `running to stop; ${MEMBER_MCP_TOOL.READ_SANDBOX_SETUP} lists each repository's actions.`,
  NOT_PERMITTED:
    "Not run: only the agent's starter may run in its sandbox, since the agent works on their " +
    "own GitHub token.",
  RETIRED: "Not run: the agent is archived.",
  NOT_READY:
    "Not run: the agent has opened no sandbox yet, or its sandbox is starting. The call may be " +
    "made again in a moment.",
  STOPPED: `Not run: the agent's sandbox is stopped; ${MEMBER_MCP_TOOL.WAKE_AGENT} resumes it.`,
  SNAPSHOT_GONE: "Not run: the agent's sandbox can no longer be resumed; its snapshot is gone.",
  UNAVAILABLE:
    "Not run: the agent's sandbox could not be reached just now. The call may be made again.",
} as const;

/** Each refusal of a run or a stop in the words above; any other is the sandbox unavailable. */
const RUN_ACTION_REFUSAL_WORDS = new Map<HostedRefusal["error"], string>([
  [HOSTED_API_ERROR.NOT_FOUND, RUN_ACTION_REFUSAL.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, RUN_ACTION_REFUSAL.NOT_PERMITTED],
  [HOSTED_API_ERROR.AGENT_RETIRED, RUN_ACTION_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.AGENT_NOT_READY, RUN_ACTION_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.SANDBOX_STOPPED, RUN_ACTION_REFUSAL.STOPPED],
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE, RUN_ACTION_REFUSAL.SNAPSHOT_GONE],
]);

/** A run or a stop as the member: the operation's answer as accepted, or its refusal in words. */
const runActionAnswer = <A extends object, R>(
  operation: (userId: string) => Effect.Effect<A, HostedRefusal, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;

    return yield* operation(member.userId).pipe(
      Effect.map((answer): WireRecord => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answer })),
      Effect.catch((refusal) =>
        Effect.succeed(
          agentToolRejected(
            RUN_ACTION_REFUSAL_WORDS.get(refusal.error) ?? RUN_ACTION_REFUSAL.UNAVAILABLE,
          ),
        ),
      ),
    );
  });

const AgentRunActionInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  actionId: describeWire(
    wireUuidSchema,
    "The run action, by its id among the agent's repository's actions as " +
      `${MEMBER_MCP_TOOL.READ_SANDBOX_SETUP} answered them.`,
  ),
});

const RUN_ACTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RUN_ACTION,
  description:
    "Run one of the run actions of a coding agent's repository in its cloud sandbox, by the " +
    "agent's id and the action's, as the member's press in the agent's Run menu would: its " +
    "command runs from the checkout with the workspace's environment variables in a Terminal " +
    "tab of its own, and an action already running is left running rather than started twice. " +
    "Only a cloud agent with a repository has them. A " +
    "sandbox that is not running is refused, never woken; " +
    `${MEMBER_MCP_TOOL.WAKE_AGENT} wakes it. Only the member who started an agent runs one on ` +
    "their own GitHub token. Answers `accepted` with the action's shell, or `rejected` and " +
    `why. ${MEMBER_MCP_TOOL.LIST_AGENT_PORTS} then names a server it started.`,
  input: AgentRunActionInputSchema,
  annotations: ADDITIVE,
  run: ({ agentId, actionId }) =>
    runActionAnswer((userId) => ranRunAction(userId, agentId, actionId)),
});

const STOP_RUN_ACTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.STOP_RUN_ACTION,
  description:
    "Interrupt what a run action runs in a coding agent's cloud sandbox, by the agent's id " +
    "and the action's, as the member's Stop in the agent's Run menu would, even one removed " +
    "from its repository's list since it started; its Terminal tab stays open. Only the member who started an agent stops one on their own GitHub token. " +
    "Answers `accepted` with where the sandbox stands and its shells, each with whether it is " +
    "running, or `rejected` and why.",
  input: AgentRunActionInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ agentId, actionId }) =>
    runActionAnswer((userId) => stoppedRunAction(userId, agentId, actionId)),
});

/*
 * The installed skills (`../installed-skills/installed-skills.ts`), each
 * through the operation Settings › Skills' procedures run, as the member:
 * the store holds who may read, install, and remove what, so a tool adds
 * no rule of its own. An install takes what Add skill sends once its
 * preview is shown: the skills chosen by name from a GitHub source and the
 * commit the preview pinned, or a text's name and description.
 */

/** Why a skill call was refused, in words the agent can act on. */
const SKILL_TOOL_REFUSAL = {
  NO_SKILL: "Not run: the member sees no installed skill of that id.",
  NO_WORKSPACE: "Not run: the member belongs to no such workspace.",
  NOT_INSTALLABLE:
    "Not run: the member may no longer install skills in that workspace; nothing was installed.",
  NOT_PERMITTED:
    "Not run: the member may not remove that skill; a workspace's skill is removed by its " +
    "installer and the workspace's owners and admins.",
  NOT_REACHABLE:
    "Not run: the workspace's GitHub installation does not reach that repository; the member " +
    `adds it to the installation in ${PRODUCT_NAME}'s GitHub settings.`,
  UNANSWERED: "Not run: GitHub or the store did not answer; nothing was installed. Try again.",
  NOTHING_TO_INSTALL:
    "Not run: nothing to install. Either install.skills names none of the skills the source " +
    `holds, as ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} lists them, or scope is workspace in the ` +
    "member's personal workspace, where scope personal is the one there is.",
  WRONG_KIND: {
    [SKILL_PASTE_KIND.SOURCE]:
      "Not run: that source is a GitHub source, so install.kind is source, with install.skills " +
      `and install.sha as ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} answered them; call it ` +
      "first, show the member what it lists, and pass its sha.",
    [SKILL_PASTE_KIND.TEXT]:
      "Not run: that source is a skill's text, so install.kind is text, with install.name and " +
      `install.summary, such as those ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} read from ` +
      "its frontmatter.",
  },
  UNSUPPORTED:
    "Not run: that is neither a GitHub repository, a link to one of its folders, an `npx " +
    "skills add` line naming one, nor a skill's text; skills install from GitHub alone.",
  NAME_TAKEN: (name: string) =>
    `Not run: a skill named ${name} is already installed there, so nothing was installed.`,
  FILES_REFUSED: (name: string, why: string) =>
    `Not run: ${name}'s files were refused (${why}), so nothing was installed.`,
} as const;

/** A skill's refused files, in the agent's words. */
const SKILL_FILES_WORDS: Readonly<Record<InstalledSkillRefusal, string>> = {
  [INSTALLED_SKILL_REFUSAL.NO_SKILL_FILE]: `no ${INSTALLED_SKILL_MAIN_FILE} at its folder's root`,
  [INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID]: `its ${INSTALLED_SKILL_MAIN_FILE} names no valid skill or carries no summary`,
  [INSTALLED_SKILL_REFUSAL.TOO_LARGE]: "a file is larger than a skill may hold",
  [INSTALLED_SKILL_REFUSAL.CREDENTIAL]: "a file holds what looks like a credential",
};

/** What a skill call says where what it asked by is out of reach: the workspace or the skill. */
interface SkillCallWords {
  readonly notFound: string;
  readonly notPermitted: string;
}

/** A call about a workspace: its list, a preview, or an install. */
const ABOUT_WORKSPACE: SkillCallWords = {
  notFound: SKILL_TOOL_REFUSAL.NO_WORKSPACE,
  notPermitted: SKILL_TOOL_REFUSAL.NOT_INSTALLABLE,
};

/** A call about one skill: a read or a removal. */
const ABOUT_SKILL: SkillCallWords = {
  notFound: SKILL_TOOL_REFUSAL.NO_SKILL,
  notPermitted: SKILL_TOOL_REFUSAL.NOT_PERMITTED,
};

/** A refusal from the skills' operation, in the agent's words, those naming what the call asked by its own. */
function skillRefusalWords(refusal: HostedRefusal, words: SkillCallWords): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return words.notFound;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return words.notPermitted;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return SKILL_TOOL_REFUSAL.NOT_REACHABLE;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return SKILL_TOOL_REFUSAL.NOTHING_TO_INSTALL;
    case HOSTED_API_ERROR.SKILL_NAME_TAKEN:
      return SKILL_TOOL_REFUSAL.NAME_TAKEN(refusal.skillName ?? "that");
    case HOSTED_API_ERROR.SKILL_FILES_REFUSED:
      return SKILL_TOOL_REFUSAL.FILES_REFUSED(
        refusal.skillName ?? "a skill",
        refusal.skillRefusal === undefined ? "invalid" : SKILL_FILES_WORDS[refusal.skillRefusal],
      );
    default:
      return SKILL_TOOL_REFUSAL.UNANSWERED;
  }
}

/** A skill call's answer: `accepted` with what the operation answered, or `rejected` in the refusal's words. */
const skillAnswer = <A extends object, R>(
  operation: Effect.Effect<A, HostedRefusal, R>,
  words: SkillCallWords,
): Effect.Effect<WireRecord, never, R> =>
  Effect.match(operation, {
    onFailure: (refusal) => agentToolRejected(skillRefusalWords(refusal, words)),
    onSuccess: (answer) => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...answer }),
  });

/** A skill call about one skill by its id, as the member. */
const skillAsMember = <R>(run: (userId: string) => Effect.Effect<WireRecord, never, R>) =>
  Effect.flatMap(AdmittedMember, (member) => run(member.userId));

/** The workspace a skill call is about. */
const SKILL_WORKSPACE_INPUT = workspaceInput(
  "whose skills to list or whose GitHub installation reads a source",
);

/** A skill by its id. */
const SkillIdInputSchema = Schema.Struct({
  skillId: describeWire(
    Schema.String.check(Schema.isNonEmpty()),
    `The installed skill's id, as ${MEMBER_MCP_TOOL.LIST_INSTALLED_SKILLS} answered it.`,
  ),
});

/** What to install from, as the member would paste it into Add skill. */
const SKILL_SOURCE_INPUT = describeWire(
  installedSkillInstallRequestSchema.fields.text,
  "What to install from, as the member would paste it into Add skill: a GitHub repository " +
    "(owner/name or its address), a link to one of its folders, an `npx skills add` line " +
    "naming one, or a skill's own SKILL.md text.",
);

const ListInstalledSkillsInputSchema = Schema.Struct({ workspace: SKILL_WORKSPACE_INPUT });

const PreviewSkillInstallInputSchema = Schema.Struct({
  workspace: SKILL_WORKSPACE_INPUT,
  source: SKILL_SOURCE_INPUT,
});

/** What an install takes from each kind of source, as Add skill's Install sends it once its preview is shown. */
const SkillInstallVariantSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal(SKILL_PASTE_KIND.SOURCE),
    skills: describeWire(
      Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
      `The skills to install by name, as ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} listed them; ` +
        "at least one.",
    ),
    sha: describeWire(
      installedSkillInstallRequestSchema.fields.sha.schema,
      `The commit ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} answered, so the files installed are ` +
        "the ones the member was shown.",
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal(SKILL_PASTE_KIND.TEXT),
    name: describeWire(
      Schema.NonEmptyString,
      `The name to install the skill by, such as the one ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} ` +
        "read from its frontmatter.",
    ),
    summary: describeWire(
      Schema.NonEmptyString,
      "The summary to install the skill by, which tells agents when to use it, such as the one " +
        `${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} read from its frontmatter.`,
    ),
  }),
]);

const InstallSkillInputSchema = Schema.Struct({
  workspace: SKILL_WORKSPACE_INPUT,
  source: SKILL_SOURCE_INPUT,
  scope: describeWire(
    installedSkillInstallRequestSchema.fields.scope,
    "Whose the skills are: personal, the member's alone in every workspace they belong to; or " +
      "workspace, offered to the agents of every member of the workspace, never in the " +
      "member's personal workspace.",
  ),
  install: describeWire(
    SkillInstallVariantSchema,
    `What to install, by the kind ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} answered for the ` +
      "source: source with the skills and the commit sha it answered, or text with the name and " +
      "summary to install the skill by.",
  ),
});

/** What an install asks of the skills' operation, by its kind. */
function installAsked(install: typeof SkillInstallVariantSchema.Type) {
  return install.kind === SKILL_PASTE_KIND.SOURCE
    ? { skills: install.skills, sha: install.sha }
    : { name: install.name, description: install.summary };
}

const LIST_INSTALLED_SKILLS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_INSTALLED_SKILLS,
  description:
    "List the skills installed into a workspace the member belongs to that the member's " +
    "agents load, as Settings › Skills lists them: the workspace's, then the member's own " +
    "personal ones. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with each skill's id, name, summary, scope ` +
    "(personal or workspace), where its files came from, and whether the member may remove " +
    "it (manageable), or `rejected` and why.",
  input: ListInstalledSkillsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      skillAnswer(listSkills(userId, workspaceId), ABOUT_WORKSPACE),
    ),
});

const READ_INSTALLED_SKILL_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_INSTALLED_SKILL,
  description:
    "Read one installed skill the member sees, by its id, as its View in Settings › Skills " +
    `shows it: its ${INSTALLED_SKILL_MAIN_FILE} whole, and every file it holds with its size. ` +
    "Answers `accepted` with them, or `rejected` and why.",
  input: SkillIdInputSchema,
  annotations: READ_ONLY,
  run: ({ skillId }) =>
    skillAsMember((userId) => skillAnswer(readSkill(userId, skillId), ABOUT_SKILL)),
});

const PREVIEW_SKILL_INSTALL_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL,
  description:
    "Read what installing from a source would install, as Add skill in Settings › Skills " +
    "shows it before its Install, installing nothing. A GitHub source is read at the commit " +
    "its ref stands at now, through the workspace's GitHub installation, and every skill " +
    "folder there is listed, with the ones the source names marked selected; a skill's text " +
    "answers the name and summary its frontmatter declares. Installing a skill hands " +
    "outside instructions to the member's agents, so show the member what this answers " +
    `before ${MEMBER_MCP_TOOL.INSTALL_SKILL}. ${WORKSPACE_WORDS} Answers \`accepted\` with ` +
    "kind source (the repository, its ref, the commit sha, and its skills), or kind text, or " +
    "`rejected` and why.",
  input: PreviewSkillInstallInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, source }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      Effect.map(
        skillAnswer(previewSkillPaste(userId, { text: source, workspaceId }), ABOUT_WORKSPACE),
        // Note that a paste the preview reads as neither source nor text is answered as no preview at all.
        (answer) =>
          answer.kind === SKILL_PASTE_KIND.UNSUPPORTED
            ? agentToolRejected(SKILL_TOOL_REFUSAL.UNSUPPORTED)
            : answer,
      ),
    ),
});

const INSTALL_SKILL_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.INSTALL_SKILL,
  description:
    "Install skills from a source for the member's agents, as Add skill's Install in " +
    `Settings › Skills does once its preview is shown: call ${MEMBER_MCP_TOOL.PREVIEW_SKILL_INSTALL} ` +
    "first, show the member what it answered, and install only what they chose. Pass install " +
    "of the kind the preview answered: source with the skills to install and the commit sha " +
    "the preview answered, so the files installed are the ones shown; or text with the name " +
    "and summary to install the skill by. Every skill asked is installed or none is. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the skills installed, each with its id, or ` +
    "`rejected` and why, such as a name already taken.",
  input: InstallSkillInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, source, scope, install }) => {
    const pasted = parseSkillPaste(source).kind;

    if (pasted === SKILL_PASTE_KIND.UNSUPPORTED) {
      return Effect.succeed(agentToolRejected(SKILL_TOOL_REFUSAL.UNSUPPORTED));
    }

    // Note that the install's kind must be the source's, so a GitHub install always takes the commit its preview pinned and what installs is what the member was shown.
    return pasted !== install.kind
      ? Effect.succeed(agentToolRejected(SKILL_TOOL_REFUSAL.WRONG_KIND[pasted]))
      : asMemberInWorkspace(workspace, (userId, workspaceId) =>
          skillAnswer(
            Effect.map(
              installSkills(userId, { ...installAsked(install), scope, text: source, workspaceId }),
              (installed) => ({ skills: installed.skills }),
            ),
            ABOUT_WORKSPACE,
          ),
        );
  },
});

const REMOVE_INSTALLED_SKILL_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REMOVE_INSTALLED_SKILL,
  description:
    "Remove an installed skill the member may remove, by its id, with its files, as its " +
    "Delete in Settings › Skills does: agents started afterwards no longer load it, a " +
    "workspace's skill for every member of the workspace, and installing it again takes its " +
    "source again. The member may remove their own personal skills, and a workspace's skill " +
    "they installed or, as an owner or admin, any of the workspace's. Remove one only when " +
    "the member asks for it. Answers `accepted` with the skill's id, or `rejected` and why.",
  input: SkillIdInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ skillId }) =>
    skillAsMember((userId) =>
      skillAnswer(
        Effect.map(removeSkill(userId, skillId), (removed) => ({ removed: removed.id })),
        ABOUT_SKILL,
      ),
    ),
});

/*
 * The workspace's Slack bot and the member's repository pins. The bot is
 * read and set through the operations its Settings rows run
 * (`../slack/slack-bot-operations.ts`), so an owner or admin alone sets its
 * repositories and channels, and any member their own notifications; the
 * pins are the member's own, through the sidebar's operations
 * (`../github/repository-pins.ts`).
 */

/** Why a Slack bot or pin change was not made, in words the agent can act on. */
const SETTINGS_REFUSAL = {
  NO_BOT:
    "Not made: the workspace's Slack bot is not connected; an owner or admin connects it in " +
    `${PRODUCT_NAME}'s Settings.`,
  NOT_PERMITTED:
    "Not made: only an owner or admin of the workspace may set its Slack bot's repository or " +
    "channels, or disconnect it.",
  NOT_REACHABLE:
    "Not made: the GitHub installation connected to the workspace reaches no repository of " +
    "that name.",
  GITHUB_UNANSWERED: "Not made: GitHub could not be reached just now. The call may be made again.",
  TOO_MANY_PINS: `Not made: the member already holds ${REPOSITORY_PIN_BOUNDS.MAX_PINS} pins, the most there may be; unpin one first.`,
  UNAVAILABLE:
    "Not made: Slack, or this deployment's Slack bot, could not be reached just now. The call " +
    "may be made again.",
  UNCONFIRMED:
    "Not confirmed: the change may have been made, in part or whole, and the bot could not be " +
    `read back; read it with ${MEMBER_MCP_TOOL.READ_SLACK_BOT} before trying again.`,
} as const;

/** A refusal of the Slack bot's or the pins' operations, in the agent's words. */
function settingsRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return SETTINGS_REFUSAL.NO_BOT;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return SETTINGS_REFUSAL.NOT_PERMITTED;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return SETTINGS_REFUSAL.NOT_REACHABLE;
    case HOSTED_API_ERROR.GITHUB_UNANSWERED:
      return SETTINGS_REFUSAL.GITHUB_UNANSWERED;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return SETTINGS_REFUSAL.TOO_MANY_PINS;
    default:
      return SETTINGS_REFUSAL.UNAVAILABLE;
  }
}

/** The bot as an agent reads it: the wire's answer bar the transaction a desktop waits for. */
function slackBotRecord({ txid: _txid, ...slackBot }: WorkspaceSlackBot): WireRecord {
  return slackBot;
}

/** The workspace a Slack bot call is about. */
const SLACK_WORKSPACE_INPUT = workspaceInput("whose Slack bot it is");

/** A repository named for Slack starts, as GitHub spells it, or null to clear it. */
const slackRepositoryInput = (words: string) =>
  Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      `${words}, as owner/name, one the workspace's GitHub reaches; null clears it.`,
    ),
  );

const ReadSlackBotInputSchema = Schema.Struct({ workspace: SLACK_WORKSPACE_INPUT });

const READ_SLACK_BOT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_SLACK_BOT,
  description:
    "Read the workspace's own Slack bot as its Settings show it: whether this deployment holds " +
    "the bot (configured), the Slack team it is connected to (absent while it is not), whether " +
    "it writes the member the threads that wait on them (notifications), the repository an " +
    "agent started from Slack works in where its message names none (defaultRepository), and, " +
    "to an owner or admin, the team's channels, each with its id, name, whether it is private, " +
    "whether the bot is in it, and its own default repository where one is named. " +
    `${WORKSPACE_WORDS} ${MEMBER_MCP_TOOL.UPDATE_SLACK_BOT} sets them.`,
  input: ReadSlackBotInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      readSlackBot(userId, workspaceId).pipe(
        Effect.map(slackBotRecord),
        Effect.catch((refusal) => Effect.succeed(agentToolRejected(settingsRefusalWords(refusal)))),
      ),
    ),
});

/** A change of the bot names the workspace and, each optional, the member's switch, the workspace's repository, and one channel. */
const UpdateSlackBotInputSchema = Schema.Struct({
  workspace: SLACK_WORKSPACE_INPUT,
  notifications: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "Whether the bot writes the member, in Slack, the threads that wait on them; the member's " +
        "own switch, which holds in every workspace.",
    ),
  ),
  defaultRepository: slackRepositoryInput(
    "The repository an agent started from Slack works in where its message names none",
  ),
  channel: Schema.optionalKey(
    describeWire(
      Schema.Struct({
        channelId: describeWire(
          workspaceSlackBotChannelRequestSchema.fields.channelId,
          `The channel, by the id ${MEMBER_MCP_TOOL.READ_SLACK_BOT} lists it by.`,
        ),
        member: Schema.optionalKey(
          describeWire(
            Schema.Boolean,
            "true to put the bot in the channel, a public one alone; false to take it out, " +
              "which forgets the channel's repository.",
          ),
        ),
        repository: slackRepositoryInput(
          "The repository an agent started from this channel works in where its message names none",
        ),
      }),
      "One channel of the team to change.",
    ),
  ),
});

const UPDATE_SLACK_BOT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_SLACK_BOT,
  description:
    "Set the workspace's own Slack bot as its Settings do, each change optional and all made " +
    "together or none: the member's own notifications from it (any member), the workspace's " +
    "default repository for Slack starts, and one channel, putting the bot in a public channel " +
    "or taking it out and naming or clearing its default repository (an owner or admin alone, " +
    "and only once the bot is connected). Connecting and disconnecting the bot is not done " +
    `here. ${WORKSPACE_WORDS} Answers \`accepted\` with the bot as it then stands, as ` +
    `${MEMBER_MCP_TOOL.READ_SLACK_BOT} reads it, or \`rejected\` and why, with nothing ` +
    "changed unless it says the change is not confirmed.",
  input: UpdateSlackBotInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, ...update }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      updateSlackBot(userId, workspaceId, update).pipe(
        Effect.map((slackBot) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          slackBot: slackBotRecord(slackBot),
        })),
        Effect.catch((failure) =>
          Effect.succeed(
            agentToolRejected(
              failure instanceof SlackBotUpdateUnconfirmed
                ? SETTINGS_REFUSAL.UNCONFIRMED
                : settingsRefusalWords(failure),
            ),
          ),
        ),
      ),
    ),
});

const DISCONNECT_SLACK_BOT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DISCONNECT_SLACK_BOT,
  description:
    "Disconnect the workspace's own Slack bot, as its Disconnect in Settings does: the bot " +
    "starts no agent from Slack and writes no member of the workspace from then on, and every " +
    "member's Slack id it kept is forgotten, with its default repositories, though the bot " +
    "stays installed in the Slack team until its admins remove it there. Connecting it again " +
    "is done in the app. Only an owner or an admin of the workspace may; disconnecting one not " +
    "connected changes nothing. Disconnect it only when the member asks for it. " +
    `${WORKSPACE_WORDS} Answers \`accepted\` with the bot as it ` +
    `then stands, as ${MEMBER_MCP_TOOL.READ_SLACK_BOT} reads it, or \`rejected\` and why.`,
  input: ReadSlackBotInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace }) =>
    asMemberInWorkspace(workspace, (userId, workspaceId) =>
      disconnectSlackBot(userId, workspaceId).pipe(
        Effect.map((slackBot) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          slackBot: slackBotRecord(slackBot),
        })),
        Effect.catch((refusal) => Effect.succeed(agentToolRejected(settingsRefusalWords(refusal)))),
      ),
    ),
});

/** The pins as an agent reads them: the wire's answer bar the transaction a desktop waits for. */
function pinsRecord({ pins }: { readonly pins: readonly RepositoryPin[] }): WireRecord {
  return { pins: pins.map(({ repository, pinnedAt }) => ({ repository, pinnedAt })) };
}

const LIST_REPOSITORY_PINS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_REPOSITORY_PINS,
  description:
    "List the repositories the member pinned in their sidebar, which groups their tasks by " +
    "repository, newest pinned first: each as owner/name with when it was pinned, in " +
    "milliseconds since the epoch. The pins are the member's own, in every workspace.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;

      return yield* readRepositoryPins(member.userId).pipe(
        Effect.map(pinsRecord),
        Effect.catch((refusal) => Effect.succeed(agentToolRejected(settingsRefusalWords(refusal)))),
      );
    }),
});

/** A pin names the repository and whether it is pinned, as the sidebar's own request does. */
const PinRepositoryInputSchema = Schema.Struct({
  repository: describeWire(
    repositoryPinRequestSchema.fields.repository,
    "The repository, as owner/name.",
  ),
  pinned: describeWire(
    repositoryPinRequestSchema.fields.pinned,
    "true to pin it, false to unpin it.",
  ),
});

const PIN_REPOSITORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.PIN_REPOSITORY,
  description:
    "Pin a repository in the member's sidebar, or unpin it, as their sidebar's Pin does: a " +
    "pin names the repository alone and asks GitHub nothing, and pinning one already pinned, " +
    `or unpinning one that is not, changes nothing. At most ${REPOSITORY_PIN_BOUNDS.MAX_PINS} ` +
    "stand at once. Answers `accepted` with the pins as they then stand, as " +
    `${MEMBER_MCP_TOOL.LIST_REPOSITORY_PINS} lists them, or \`rejected\` and why.`,
  input: PinRepositoryInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ repository, pinned }) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;

      return yield* pinRepository(member.userId, repository, pinned).pipe(
        Effect.map((pins) => ({ status: ACTION_RESULT_STATUS.ACCEPTED, ...pinsRecord(pins) })),
        Effect.catch((refusal) => Effect.succeed(agentToolRejected(settingsRefusalWords(refusal)))),
      );
    }),
});

/*
 * The workspace's environment variables, which its members' cloud agents are
 * handed. Each runs the one operation behind Settings › Cloud environment and its
 * procedures (`../workspace-environment/workspace-environment.ts`) as the
 * member, in the workspace a slug names, so it holds the
 * member to what Settings does: any member reads the names, and only an
 * owner or admin sets or deletes one. A value goes in through
 * `set_environment_variable`, sealed under the deployment's ring the moment
 * it is read, and never comes out: every answer is the names alone.
 */

/** Why an environment call took nothing, in words for one acting for the member. */
const ENVIRONMENT_REFUSAL = {
  NOT_FOUND: "Not run: the member belongs to no such workspace.",
  NOT_PERMITTED: (verb: string) =>
    `Not ${verb}: only the workspace's owners and admins set and delete its environment variables.`,
  UNANSWERED:
    "Not run: the workspace's environment variables could not be reached just now. The call " +
    "may be made again.",
  NO_KEY_RING:
    "Not set: this deployment holds no key to seal a value under, so no environment variable " +
    "can be set here until its operator configures one. Calling again will not help.",
} as const;

/** An environment call's refusal in the member's words, the operation's verb naming what was not done. */
function environmentRefusalWords(refusal: HostedRefusal, verb: string): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return ENVIRONMENT_REFUSAL.NOT_FOUND;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return ENVIRONMENT_REFUSAL.NOT_PERMITTED(verb);
    default:
      return ENVIRONMENT_REFUSAL.UNANSWERED;
  }
}

/** An environment call run as the member in the workspace its slug names, answered as the names then stand, or refused in the member's words. */
const environmentAsMember = <R>(
  slug: string,
  verb: string,
  run: (
    userId: string,
    workspaceId: string,
  ) => Effect.Effect<WorkspaceEnvironmentAnswer, HostedRefusal, R>,
) =>
  listAsMember(slug, ({ caller }) => {
    const workspaceId = callerWorkspaceId(caller);

    return run(callerUserId(caller), workspaceId).pipe(
      // Note that a config's value is left out of every answer, a write's too, so none reaches the model through a tool.
      Effect.map(
        (answer): WireRecord => ({
          workspaceId,
          variables: answer.variables.map(({ value: _value, ...variable }) => variable),
        }),
      ),
      Effect.catch((refusal) =>
        Effect.succeed(agentToolRejected(environmentRefusalWords(refusal, verb))),
      ),
    );
  });

/** The workspace an environment call is about. */
const ENVIRONMENT_WORKSPACE_INPUT = workspaceInput("whose environment variables to act on");

/** A variable's name, as a shell spells one. */
const ENVIRONMENT_NAME_INPUT = describeWire(
  workspaceVariableNameSchema,
  "The variable's name: a letter or underscore, then letters, digits, and underscores, such as " +
    "DATABASE_URL.",
);

const ListEnvironmentVariablesInputSchema = Schema.Struct({
  workspace: ENVIRONMENT_WORKSPACE_INPUT,
});

const LIST_ENVIRONMENT_VARIABLES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_ENVIRONMENT_VARIABLES,
  description:
    "List the environment variables of a workspace the member belongs to, which every cloud " +
    "agent its members start is handed, as Settings › Cloud environment lists them: each by its name " +
    "with when it was last set, in epoch milliseconds, in name order. A value is never shown, " +
    `here or anywhere, once it is set. ${WORKSPACE_WORDS}`,
  input: ListEnvironmentVariablesInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    environmentAsMember(workspace, "run", (userId, workspaceId) =>
      // Note that no ring is handed, so a config's value never reaches the model through a tool.
      listWorkspaceEnvironment(undefined, userId, workspaceId),
    ),
});

const SetEnvironmentVariableInputSchema = Schema.Struct({
  workspace: ENVIRONMENT_WORKSPACE_INPUT,
  name: ENVIRONMENT_NAME_INPUT,
  value: describeWire(
    workspaceVariablePutRequestSchema.fields.value,
    "The value, as the agents' environment will hold it, at most " +
      `${WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS} characters.`,
  ),
});

const SET_ENVIRONMENT_VARIABLE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SET_ENVIRONMENT_VARIABLE,
  description:
    "Set one environment variable of a workspace the member owns or administers, as Settings › " +
    "Cloud environment's Add or Replace value would: every cloud agent its members start from then " +
    "on is handed it, and one of the same name has its value replaced. The value is sealed " +
    "the moment it arrives and is never shown again, to you, the member, or anyone, so set " +
    "only a value the member gave you for this. Answers with the workspace's variable names as " +
    `they then stand, never a value, or \`rejected\` and why. ${WORKSPACE_WORDS}`,
  input: SetEnvironmentVariableInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, name, value }) =>
    // Note that a deployment holding no ring never comes to hold one on a retry, so it is refused in words of its own.
    Effect.flatMap(Effect.result(hostedKeyRing), (ring) =>
      Result.isFailure(ring)
        ? Effect.succeed(agentToolRejected(ENVIRONMENT_REFUSAL.NO_KEY_RING))
        : environmentAsMember(workspace, "set", (userId, workspaceId) =>
            putWorkspaceVariable(ring.success, userId, { workspaceId, name }, Redacted.make(value)),
          ),
    ),
});

const DeleteEnvironmentVariableInputSchema = Schema.Struct({
  workspace: ENVIRONMENT_WORKSPACE_INPUT,
  name: ENVIRONMENT_NAME_INPUT,
});

const DELETE_ENVIRONMENT_VARIABLE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_ENVIRONMENT_VARIABLE,
  description:
    "Delete one environment variable of a workspace the member owns or administers, by its " +
    `name as ${MEMBER_MCP_TOOL.LIST_ENVIRONMENT_VARIABLES} answered it, as Settings › ` +
    "Cloud environment's Delete would: its value is gone for good, and no cloud agent started from " +
    "then on is handed it. Delete one only when the member asks for it. Answers with the " +
    "workspace's variable names as they then stand, a variable already gone among them, or " +
    `\`rejected\` and why. ${WORKSPACE_WORDS}`,
  input: DeleteEnvironmentVariableInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, name }) =>
    environmentAsMember(workspace, "deleted", (userId, workspaceId) =>
      deleteWorkspaceVariable(undefined, userId, { workspaceId, name }),
    ),
});

/*
 * A workspace created. The member's new workspace is made through the one
 * operation the hosted create runs (`../accounts/workspace-create.ts`), the
 * member its owner, as Create workspace in the window makes it.
 */

/** Why a create made nothing, in words for one acting for the member. */
const CREATE_WORKSPACE_REFUSAL = {
  UNMADE:
    "Not confirmed: the workspace could not be made, or was made and could not be read back; " +
    `check ${MEMBER_MCP_TOOL.LIST_WORKSPACES} before trying again.`,
} as const;

/** A create names the workspace, held as the window holds a name. */
const CreateWorkspaceInputSchema = Schema.Struct({
  name: describeWire(
    workspaceCreateRequestSchema.fields.name,
    `The new workspace's name, at most ${WORKSPACE_BOUNDS.MAX_NAME_CHARS} characters, its ends trimmed.`,
  ),
});

const CREATE_WORKSPACE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_WORKSPACE,
  description:
    "Create a new workspace, with the member you act for as its owner, as Create workspace in " +
    "the app makes one. Its slug, the first step of its links, is spelled from its name. Create " +
    "one only when the member asks for a new workspace. Answers `accepted` with the workspace's " +
    "id, slug, name, and the member's role in it, which every other tool names it by; or " +
    "`rejected` and why.",
  input: CreateWorkspaceInputSchema,
  annotations: ADDITIVE,
  run: ({ name }) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const seams = yield* WorkspacePlugin;

      return yield* createdWorkspace(seams, member.userId, name).pipe(
        Effect.map((workspace) => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          workspace: {
            id: workspace.id,
            slug: workspace.slug,
            name: workspace.name,
            role: workspace.role,
          },
        })),
        // Note that the refusal is logged by its slug alone, because the plugin's own words may quote the name.
        Effect.catch((refusal) =>
          Effect.as(
            Effect.logWarning(`Workspace not created: ${refusal.error}`),
            agentToolRejected(CREATE_WORKSPACE_REFUSAL.UNMADE),
          ),
        ),
      );
    }),
});

/** Every tool the server offers, listed in the order an agent reads them. */
/**
 * The workspace experiments on in one of the member's workspaces at least,
 * whose tools the member is listed (`MemberMcpTool.experiment`): this server
 * spans the member's workspaces, so a tool of one stands while any of them
 * has it on, and each call into a workspace with it off is refused at the
 * tool's door.
 */
export const memberExperimentsOn = (
  userId: string,
): Effect.Effect<ReadonlySet<WorkspaceExperiment>, StoreFailure, DatabaseServices> =>
  Effect.map(
    listWorkspaces(userId),
    (workspaces) =>
      new Set(
        workspaces.flatMap((workspace) =>
          (workspace.experiments ?? []).flatMap(({ experiment, on }) =>
            on && isExperiment(experiment) && isWorkspaceExperiment(experiment) ? [experiment] : [],
          ),
        ),
      ),
  );

export const MEMBER_MCP_TOOLS: readonly MemberMcpTool[] = [
  LIST_WORKSPACES_TOOL,
  LIST_WORKSPACE_MEMBERS_TOOL,
  SET_WORKSPACE_SLUG_TOOL,
  RENAME_WORKSPACE_TOOL,
  REMOVE_WORKSPACE_MEMBER_TOOL,
  CHANGE_WORKSPACE_MEMBER_ROLE_TOOL,
  LIST_WORKSPACE_INVITATIONS_TOOL,
  INVITE_TO_WORKSPACE_TOOL,
  CANCEL_WORKSPACE_INVITATION_TOOL,
  SET_WORKSPACE_PHOTO_TOOL,
  MEMBER_LIST_TASKS_TOOL,
  MEMBER_READ_TASK_TOOL,
  MEMBER_LIST_AGENTS_TOOL,
  MEMBER_READ_AGENT_TOOL,
  READ_AGENT_CHANGES_TOOL,
  READ_AGENT_TRANSCRIPT_TOOL,
  MEMBER_READ_PAGE_TOOL,
  READ_TASK_FILE_TOOL,
  LIST_TASK_FOLDER_TOOL,
  MEMBER_LIST_MODELS_TOOL,
  MEMBER_LIST_MACHINES_TOOL,
  UPDATE_PREFERENCES_TOOL,
  MEMBER_CREATE_TASK_TOOL,
  MEMBER_UPDATE_TASK_TOOL,
  MEMBER_CHANGE_TASK_RELATION_TOOL,
  MEMBER_DELETE_TASK_TOOL,
  MEMBER_EDIT_DESCRIPTION_TOOL,
  LIST_DESCRIPTION_REVISIONS_TOOL,
  READ_DESCRIPTION_REVISION_TOOL,
  RESTORE_DESCRIPTION_REVISION_TOOL,
  MEMBER_CREATE_SECTION_TOOL,
  MEMBER_DELETE_SECTION_TOOL,
  MEMBER_START_AGENT_TOOL,
  MEMBER_MESSAGE_AGENT_TOOL,
  CHANGE_AGENT_QUEUE_TOOL,
  MEMBER_STOP_AGENT_TOOL,
  MEMBER_UPDATE_AGENT_TOOL,
  MEMBER_ARCHIVE_AGENT_TOOL,
  MEMBER_UNARCHIVE_AGENT_TOOL,
  REWIND_AGENT_TOOL,
  DELETE_AGENT_TOOL,
  WAKE_AGENT_TOOL,
  LIST_AGENT_PORTS_TOOL,
  SHARE_AGENT_PORT_TOOL,
  LIST_REPOSITORIES_TOOL,
  SET_TOKEN_REPOSITORY_TOOL,
  READ_REPOSITORY_FILE_TOOL,
  LIST_REPOSITORY_FOLDER_TOOL,
  LIST_REPOSITORY_SKILLS_TOOL,
  READ_GITHUB_ISSUE_TOOL,
  READ_GITHUB_CONNECTION_TOOL,
  LIST_AGENT_BROWSER_TABS_TOOL,
  OPEN_AGENT_BROWSER_TAB_TOOL,
  TAKE_OVER_AGENT_BROWSER_TAB_TOOL,
  HAND_BACK_AGENT_BROWSER_TAB_TOOL,
  READ_INBOX_TOOL,
  ANSWER_ASK_TOOL,
  ACKNOWLEDGE_THREAD_TOOL,
  REPLY_TO_THREAD_TOOL,
  CLOSE_THREAD_TOOL,
  MARK_THREAD_READ_TOOL,
  MARK_INBOX_READ_TOOL,
  REMIND_THREAD_TOOL,
  START_THREAD_TOOL,
  AGENT_PULL_REQUEST_ACTION_TOOL,
  READ_PULL_REQUEST_TOOL,
  MARK_PULL_REQUEST_FILES_VIEWED_TOOL,
  READ_PULL_REQUEST_CHAPTERS_TOOL,
  GENERATE_PULL_REQUEST_CHAPTERS_TOOL,
  MEMBER_READ_COMMENTS_TOOL,
  MEMBER_COMMENT_ON_DESCRIPTION_TOOL,
  MEMBER_REPLY_TO_COMMENT_TOOL,
  MEMBER_UPDATE_COMMENT_TOOL,
  MEMBER_SEARCH_MEMORY_TOOL,
  MEMBER_SAVE_MEMORY_TOOL,
  MEMBER_LIST_MEMORIES_TOOL,
  MEMBER_FORGET_MEMORY_TOOL,
  MEMBER_LIST_AUTOMATIONS_TOOL,
  MEMBER_CREATE_AUTOMATION_TOOL,
  MEMBER_UPDATE_AUTOMATION_TOOL,
  MEMBER_RUN_AUTOMATION_TOOL,
  MEMBER_DELETE_AUTOMATION_TOOL,
  LIST_INTEGRATIONS_TOOL,
  CONNECT_INTEGRATION_TOOL,
  LIST_INTEGRATION_TOOLS_TOOL,
  RENAME_INTEGRATION_TOOL,
  DISCONNECT_INTEGRATION_TOOL,
  LIST_MCP_CLIENTS_TOOL,
  REVOKE_MCP_CLIENT_TOOL,
  LIST_SENTRY_INSTALLATIONS_TOOL,
  DISCONNECT_SENTRY_TOOL,
  READ_SANDBOX_SETUP_TOOL,
  EDIT_SANDBOX_SETUP_TOOL,
  EDIT_RUN_ACTION_TOOL,
  RUN_ACTION_TOOL,
  STOP_RUN_ACTION_TOOL,
  LIST_INSTALLED_SKILLS_TOOL,
  READ_INSTALLED_SKILL_TOOL,
  PREVIEW_SKILL_INSTALL_TOOL,
  INSTALL_SKILL_TOOL,
  REMOVE_INSTALLED_SKILL_TOOL,
  READ_SLACK_BOT_TOOL,
  UPDATE_SLACK_BOT_TOOL,
  DISCONNECT_SLACK_BOT_TOOL,
  LIST_REPOSITORY_PINS_TOOL,
  PIN_REPOSITORY_TOOL,
  LIST_ENVIRONMENT_VARIABLES_TOOL,
  SET_ENVIRONMENT_VARIABLE_TOOL,
  DELETE_ENVIRONMENT_VARIABLE_TOOL,
  CREATE_WORKSPACE_TOOL,
];
