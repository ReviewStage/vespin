import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@repo/database/integration-vocabulary";
import {
  AUTOMATION_ACCESS,
  listAutomationRuns,
  listAutomations,
  readAutomation,
} from "@repo/database/models/automation-store";
import { type Device, devicesSeenSince } from "@repo/database/models/device-store";
import { workspaceIntegrationInstallations } from "@repo/database/models/integration-installation-store";
import { workspaceSlackInstallation } from "@repo/database/models/slack-installation-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  disabledServersSchema,
} from "@repo/features/agent-wire";
import { readSchedule, SCHEDULE_REFUSAL } from "@repo/features/automation-schedule";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationTarget,
  automationActionSchema,
  automationCreateRequestSchema,
  automationScopeSchema,
  GITHUB_TRIGGER_EVENT,
  githubTriggerSchema,
  scheduleTriggerSchema,
  sentryTriggerSchema,
} from "@repo/features/automation-wire";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { cleanMachineName } from "@repo/features/machine-name";
import { type ModelChoice, modelChoiceSchema } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import type { Sandbox } from "@repo/sandbox";
import { isRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Clock, Effect, Option, Predicate, Result, Schema, Struct } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  changeAutomationAs,
  createAutomationAs,
  removeAutomationAs,
  runAutomationNowAs,
  runSummaries,
  summaryOf,
} from "../automations/automation-writes.js";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { SERVER_AUTOMATION_SOURCE } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { SentryApp } from "../triggers/sentry/sentry-app-config.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  AUTOMATION_RUNS_ON,
  agentToolRejected,
  callerAgent,
  callerUserId,
  callerWorkspace,
  choiceRefusal,
  orStoreRefusal,
} from "./agent-tools.js";
import { calledId } from "./called-id.js";
import { acceptedAgentChoice } from "./coder-host/start.js";
import { workspaceAgent } from "./workspace-agents.js";

/**
 * automation-tools.ts -- the tools a coding agent keeps its workspace's automations by: list them, make one, change one, and delete one.
 *
 * Each call acts as the member the agent acts for (its starter), on the
 * automations of the agent's own workspace, under the same rules the
 * automations page writes by (`../automations/automation-writes.ts`): the
 * same checks of a schedule, a model, and the repositories the workspace's
 * installation reaches, and the same access, so a personal automation is
 * its creator's to change and a workspace's its creator's, owners', and
 * admins'. A run starts as the automation's creator, so an automation an
 * agent makes runs as the member who started that agent. A Manager's calls
 * act instead as the member who asked for its turn under way (`turnAsker`):
 * what it makes stands on their Automations page, is checked against their
 * devices, and runs as them, and it lists, changes, deletes, and runs
 * automations as they may; a run sent to the Manager still opens a turn its
 * owner pays for. A
 * webhook trigger
 * is never made or set here: its secret is shown once, in the window that
 * minted it (`AGENTS.md`), and no agent's answer may carry it. A Sentry
 * trigger is refused where this deployment configures no Sentry integration
 * or the workspace installed none, since nothing would ever fire it, and a
 * delivery to Slack where the workspace connected no Slack bot, since
 * nothing would ever be sent. An automation
 * is made under an id drawn from the call's key (`called-id.ts`),
 * so a call run again names the one it made. Every answer is data the
 * model reads, never a credential.
 */

/** How many runs one automation's read answers, the newest first. */
const RUNS_READ = 10;

/** The most characters of a prompt the list shows of each automation; a read by its id shows it whole. */
const LISTED_PROMPT_CHARS = 300;

/** The cloud as `create_automation`'s runsOn names it, which a device's refusal offers instead. */
const IN_THE_CLOUD_WORDS = JSON.stringify({ machine: AGENT_MACHINE.VERCEL });

/** Why a call changed nothing, in words the model can act on. */
export const AUTOMATION_TOOL_REFUSAL = {
  UNREADABLE_CREATE:
    `Not made: give a name of at most ${AUTOMATION_BOUNDS.MAX_NAME_CHARS} characters, a prompt ` +
    `of at most ${AUTOMATION_BOUNDS.MAX_PROMPT_CHARS}, and a trigger: a schedule as ` +
    '{"kind":"schedule","cron":"<five-field cron>","timezone":"<IANA zone>"} or once as ' +
    '{"kind":"schedule","at":"<YYYY-MM-DDTHH:mm>","timezone":"<IANA zone>"}, a GitHub event ' +
    'as {"kind":"github","event":"<event>","senders":["people"]} with the flags its event takes, ' +
    "or a Sentry event as " +
    '{"kind":"integration","provider":"sentry","event":"alert-triggered"}; repositories as ' +
    `owner/name, [] for none; a model with one of its efforts, as ${AGENT_TOOL.LIST_MODELS} answers them; ` +
    "scope as personal or workspace; archiveSuccessful and slackDelivery as true or false; " +
    `and runsOn as ${IN_THE_CLOUD_WORDS} or a device of the developer's by its name or its id.`,
  MISSING_CREATE:
    "Not made: every automation names its repositories, model, effort, scope, archiveSuccessful, " +
    "slackDelivery, and runsOn; none is taken from where you work or from the developer's " +
    "defaults. repositories is an array of owner/name the workspace's GitHub installation " +
    "reaches, the one you work in among them where the run should work there, or [] for none; " +
    `model is a catalog id and effort one of its efforts, as ${AGENT_TOOL.LIST_MODELS} answers them; ` +
    "scope is personal or workspace; archiveSuccessful and slackDelivery are true or false; " +
    `runsOn is ${IN_THE_CLOUD_WORDS} for the cloud, or one of the developer's own devices as ` +
    `${AGENT_TOOL.LIST_MACHINES} lists it, with the runsOn to pass. Missing:`,
  GITHUB_FLAGS_MISSING:
    "Not run: a GitHub trigger names whose events fire it and whether a draft, a fork's pull " +
    "request, or a prerelease does, on the events each applies to; none has a default. senders " +
    "is an array of people, app-agents, and other-bots; drafts, forks, and prereleases are true " +
    "or false. Missing:",
  GITHUB_FLAG_EXTRA: "Not run: a GitHub trigger takes",
  UNREADABLE_UPDATE:
    `Not run: name the automation by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered, and at ` +
    "least one change, a model with its effort, both or neither, and runsOn, where given, as " +
    `${IN_THE_CLOUD_WORDS} or a device of its creator's by its name or its id.`,
  UNREADABLE_ID: `Not run: name the automation by the id ${AGENT_TOOL.LIST_AUTOMATIONS} answered.`,
  NO_AUTOMATION:
    "Not run: no automation of your workspace that the developer you work for may read has that " +
    `id; ${AGENT_TOOL.LIST_AUTOMATIONS} names them.`,
  NOT_PERMITTED:
    "Not run: the developer you work for may read that automation but not change or delete it. " +
    "A personal automation is its creator's alone, and a workspace's its creator's, owners', and " +
    "admins'; only its toggle is open to more of the workspace.",
  NO_REPOSITORY:
    "Not run: a GitHub trigger fires on events of the automation's repositories, so name at " +
    "least one, as owner/name.",
  NOT_REACHABLE:
    "Not run: the GitHub installation connected to the workspace does not reach one of those " +
    "repositories; name ones it reaches.",
  GITHUB_UNANSWERED:
    "Not run: GitHub did not answer whether the workspace reaches those repositories. The call " +
    "may be made again.",
  CRON: "Not run: the schedule's cron is not five-field cron, such as 0 9 * * 1 for nine on Mondays.",
  TIMEZONE:
    "Not run: the schedule's time zone is not one the IANA database names, such as Europe/London.",
  TOO_FREQUENT: "Not run: a schedule may fire at most once every fifteen minutes.",
  AT: "Not run: a one-time schedule's at is not a date and time as YYYY-MM-DDTHH:mm, such as 2026-11-27T09:00.",
  PAST: "Not run: a one-time schedule's at is in the past; give a time in the future.",
  SENTRY_UNCONFIGURED:
    `Not run: this deployment of ${PRODUCT_NAME} has no Sentry integration configured, so no automation ` +
    "here may fire on Sentry's events; use a schedule or a GitHub event instead.",
  SENTRY_NOT_INSTALLED:
    `Not run: the workspace has not installed ${PRODUCT_NAME}'s Sentry integration, so no Sentry event ` +
    "would fire it. A workspace owner or admin installs it in Workspace settings › " +
    "Integrations › Sentry; make it once that is done.",
  SLACK_NOT_CONNECTED:
    `Not run: the workspace has not connected ${PRODUCT_NAME}'s Slack bot, so no run's result ` +
    "could be sent on Slack. A workspace owner or admin connects it in Workspace settings; " +
    "pass slackDelivery false until that is done.",
  NO_AGENT:
    "Not run: no agent of your workspace has that agentId to hand each run to; " +
    `${AGENT_TOOL.LIST_AGENTS} names them, or leave agentId out for a new agent each run.`,
  WORKSPACE_SCOPE:
    "Not run: this is the developer's personal workspace, where every automation is theirs " +
    "alone; name scope personal.",
  INVALID:
    `Not run: ${PRODUCT_NAME} does not take the automation as asked. Check the trigger, the repositories, ` +
    "the scope, and the agentId.",
  UNKNOWN_SERVERS:
    "Not run: name each MCP server in disabledServers by its server name, such as `linear` for " +
    "`mcp__linear__…`; these name none:",
  NOT_RUNNABLE:
    "Not run: the developer you work for may read that automation but not run it. A personal " +
    "automation is its creator's to run, and a workspace's every member's.",
  UNAVAILABLE:
    "Not run: the automations could not be written just now. The call may be made again.",
} as const;

const AUTOMATION_ID = describeWire(
  wireUuidSchema,
  `The automation's id, as ${AGENT_TOOL.LIST_AUTOMATIONS} or ${AGENT_TOOL.CREATE_AUTOMATION} answered it.`,
);

const PROMPT = describeWire(
  automationActionSchema.fields.prompt,
  "Each run's first message; make it stand alone, since no one watches a run.",
);

/** The flags a GitHub trigger names beside its event, each on the events it applies to. */
const GITHUB_TRIGGER_FLAG = {
  SENDERS: "senders",
  DRAFTS: "drafts",
  FORKS: "forks",
  PRERELEASES: "prereleases",
} as const;

type GitHubTriggerFlag = (typeof GITHUB_TRIGGER_FLAG)[keyof typeof GITHUB_TRIGGER_FLAG];

const {
  kind: githubKind,
  labels,
  branches,
  defaultBranch,
  moments,
  tags,
} = githubTriggerSchema.fields;

/** The filters every GitHub trigger may name, each keeping nothing out where it is left out. */
const GITHUB_FILTERS = { kind: githubKind, labels, branches, defaultBranch, moments, tags };

const SENDERS = { [GITHUB_TRIGGER_FLAG.SENDERS]: githubTriggerSchema.fields.senders.schema };
const DRAFTS = { [GITHUB_TRIGGER_FLAG.DRAFTS]: Schema.Boolean };
const FORKS = { [GITHUB_TRIGGER_FLAG.FORKS]: Schema.Boolean };
const PRERELEASES = { [GITHUB_TRIGGER_FLAG.PRERELEASES]: Schema.Boolean };

/**
 * A GitHub trigger as the tools take it: one variant per set of events
 * that take the same flags, each flag required where its event has it, so
 * no call leaves whose events fire it, or whether a draft, a fork's pull
 * request, or a prerelease does, to a default. Note that a check has no
 * sender and a merged pull request is never a draft, so neither takes
 * those. The stored trigger (`githubTriggerSchema`) and the automations
 * page keep their own reading.
 */
const toolGithubTriggerSchema = Schema.Union([
  Schema.Struct({
    ...GITHUB_FILTERS,
    event: Schema.Literals([
      GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
      GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
      GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
    ]),
    ...SENDERS,
    ...DRAFTS,
    ...FORKS,
  }),
  Schema.Struct({
    ...GITHUB_FILTERS,
    event: Schema.Literals([GITHUB_TRIGGER_EVENT.PULL_REQUEST_MERGED]),
    ...SENDERS,
    ...FORKS,
  }),
  Schema.Struct({
    ...GITHUB_FILTERS,
    event: Schema.Literals([
      GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
      GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
      GITHUB_TRIGGER_EVENT.PUSH,
    ]),
    ...SENDERS,
  }),
  Schema.Struct({
    ...GITHUB_FILTERS,
    event: Schema.Literals([GITHUB_TRIGGER_EVENT.RELEASE_PUBLISHED]),
    ...SENDERS,
    ...PRERELEASES,
  }),
  Schema.Struct({
    ...GITHUB_FILTERS,
    event: Schema.Literals([GITHUB_TRIGGER_EVENT.CHECK_FAILED]),
  }),
]);

const GITHUB_FLAGS: readonly GitHubTriggerFlag[] = Object.values(GITHUB_TRIGGER_FLAG);

/** The flags a GitHub trigger on each event must name, read off the variants above. */
const GITHUB_EVENT_FLAGS: ReadonlyMap<string, readonly GitHubTriggerFlag[]> = new Map(
  toolGithubTriggerSchema.members.flatMap((variant) =>
    variant.fields.event.literals.map((event) => [
      event,
      GITHUB_FLAGS.filter((flag) => flag in variant.fields),
    ]),
  ),
);

/** The events that take a flag, in the catalog's order, as a refusal names them. */
function eventsTaking(flag: GitHubTriggerFlag): string {
  return Object.values(GITHUB_TRIGGER_EVENT)
    .filter((event) => GITHUB_EVENT_FLAGS.get(event)?.includes(flag) === true)
    .join(", ");
}

const TRIGGER = describeWire(
  Schema.Union([
    ...scheduleTriggerSchema.members,
    ...toolGithubTriggerSchema.members,
    sentryTriggerSchema,
  ]),
  "cron: five fields in an IANA timezone, at most every fifteen minutes; or at, a date and " +
    "time on that zone's clock, to run once, after which it is paused. GitHub: senders names " +
    "whose events fire it, of people, app-agents (our agents), and other-bots (for " +
    "pull-request-merged, whose pull request it is), on every event but check-failed; drafts " +
    "on pull-request-opened, -labeled, and -updated, forks on every pull-request event, and " +
    "prereleases on release-published say whether a draft, a fork's pull request, or a " +
    "prerelease fires it. moments (pull-request-updated only) left out is every moment; tags " +
    "match a release's tag exactly. " +
    "Sentry: prefer alert-triggered, fired by an alert rule whose action is " +
    `"Send a notification via ${PRODUCT_NAME}"; issue-created fires on every new issue. A ` +
    "filter matches any of its values, and every filter given must. Webhooks are made only on " +
    "the automations page.",
);

const REPOSITORIES = describeWire(
  automationCreateRequestSchema.fields.repositories.schema,
  "owner/name, reached by the workspace's GitHub installation; runs start in the first. [] " +
    "for none, which a GitHub trigger cannot take.",
);

const MODEL = describeWire(
  modelChoiceSchema.fields.model,
  `Catalog id from ${AGENT_TOOL.LIST_MODELS}, given with effort.`,
);

const SERVERS = describeWire(
  disabledServersSchema,
  "MCP servers each run's agent is not handed, by server name (`linear` for `mcp__linear__…`); " +
    "the whole list.",
);

const RUNS_ON = describeWire(
  AUTOMATION_RUNS_ON,
  `Where each run's agent starts: ${IN_THE_CLOUD_WORDS} for the cloud, or ` +
    `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, device: "<name>" })} for one of the ` +
    "automation's creator's own devices (a Mac or a host) by its name, or " +
    `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, deviceId: "<id>" })} by its id; ` +
    `${AGENT_TOOL.LIST_MACHINES} lists each place with the runsOn to pass. A run that fires while ` +
    "its device is offline fails. It places each agent a run starts: a run handed to the one " +
    "agent named runs where that agent already runs.",
);

const SCOPE = describeWire(
  automationScopeSchema,
  "personal is its creator's alone; workspace is every member's.",
);

const ARCHIVE_SUCCESSFUL = describeWire(
  Schema.Boolean,
  "Where each run starts a new agent, mark the run's task Done, archiving its agents, once every agent of the run succeeds and leaves no pull request or thread open.",
);

const SLACK_DELIVERY = describeWire(
  Schema.Boolean,
  `Send each run's result to the developer on Slack from ${PRODUCT_NAME}'s bot, so the run's ` +
    "agent needs no Slack of its own; the workspace must have the bot connected.",
);

const AGENT_ID = describeWire(
  Schema.NullOr(wireUuidSchema),
  `Hand every run to this agent, by its ${AGENT_TOOL.LIST_AGENTS} id, so runs share its ` +
    "memory; null for a new agent each run, the default.",
);

const LIST_AUTOMATIONS_INPUT = Schema.Struct({
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One automation to read whole, its prompt in full and its newest runs, by the id this " +
        "tool answered; leave it out to list them all.",
    ),
  ),
  agentId: Schema.optionalKey(
    describeWire(wireUuidSchema, "Only the automations whose runs land on this agent, by its id."),
  ),
});

/** An automation as both tools take it: create needs all but disabledServers and agentId, and update takes any of them. */
const AUTOMATION_FIELDS = {
  name: automationCreateRequestSchema.fields.name,
  prompt: PROMPT,
  trigger: TRIGGER,
  repositories: REPOSITORIES,
  model: MODEL,
  effort: modelChoiceSchema.fields.effort,
  disabledServers: SERVERS,
  agentId: AGENT_ID,
  scope: SCOPE,
  archiveSuccessful: ARCHIVE_SUCCESSFUL,
  slackDelivery: SLACK_DELIVERY,
};

const CREATE_AUTOMATION_INPUT = Schema.Struct({
  ...Struct.mapOmit(
    AUTOMATION_FIELDS,
    [
      "name",
      "prompt",
      "trigger",
      "repositories",
      "model",
      "effort",
      "scope",
      "archiveSuccessful",
      "slackDelivery",
    ],
    Schema.optionalKey,
  ),
  runsOn: RUNS_ON,
});

const UPDATE_AUTOMATION_INPUT = Schema.Struct({
  automationId: AUTOMATION_ID,
  enabled: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "false pauses it, true resumes it; missed firings are not run late.",
    ),
  ),
  ...Struct.map(AUTOMATION_FIELDS, Schema.optionalKey),
  runsOn: Schema.optionalKey(RUNS_ON),
});

const DELETE_AUTOMATION_INPUT = Schema.Struct({ automationId: AUTOMATION_ID });

const RUN_AUTOMATION_INPUT = Schema.Struct({ automationId: AUTOMATION_ID });

/** What create_automation takes from the caller alone, never from where it works or its starter's defaults. */
const CREATE_REQUIRED = [
  "repositories",
  "model",
  "effort",
  "scope",
  "archiveSuccessful",
  "slackDelivery",
  "runsOn",
] as const;

const readListAsked = Schema.decodeUnknownResult(LIST_AUTOMATIONS_INPUT);
const readCreateAsked = Schema.decodeUnknownResult(CREATE_AUTOMATION_INPUT);
const readUpdateAsked = Schema.decodeUnknownResult(UPDATE_AUTOMATION_INPUT);
const readDeleteAsked = Schema.decodeUnknownResult(DELETE_AUTOMATION_INPUT);
const readRunAsked = Schema.decodeUnknownResult(RUN_AUTOMATION_INPUT);

/** The tools as every coding agent is offered them: each its name, its words, and its input schema. */
export const LIST_AUTOMATIONS_TOOL = {
  name: AGENT_TOOL.LIST_AUTOMATIONS,
  description:
    "List the automations of your workspace that the developer you work for may read, newest " +
    "first: each with its id, name, whether it is on, its trigger, the start of its prompt, the " +
    "model and effort its runs take, its repositories, where its runs land, its scope, " +
    "when it is next due, its newest run, and whether the developer made it. Name an " +
    "automationId to read that one whole, its prompt in full and its newest runs, each with why " +
    "it was skipped or failed and the agent it started, or an agentId to list only those whose " +
    "runs land on that agent. An automation fires on a schedule, a " +
    "GitHub event, a webhook, or a Sentry event, and starts an agent on its prompt, as " +
    "its creator.",
  inputSchema: LIST_AUTOMATIONS_INPUT,
} as const;

export const CREATE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.CREATE_AUTOMATION,
  description:
    "Make an automation in your workspace for the developer you work for, as the automations " +
    `page would: each time its trigger fires, ${PRODUCT_NAME} starts an agent on its prompt, in its ` +
    "repositories or in none, on its creator's keys and connections, on a task of its own with no one watching, or " +
    "hands the run to the one agent named. It is on as it is made, and runs as the developer. " +
    "Name its repositories, model, effort, scope, archiveSuccessful, slackDelivery, and the " +
    "machine its runs start on (runsOn): none is taken from where you work or the developer's " +
    `defaults; ${AGENT_TOOL.LIST_MODELS} answers the models and efforts, and ` +
    `${AGENT_TOOL.LIST_MACHINES} the machines. ` +
    `One fired by Sentry needs ${PRODUCT_NAME}'s Sentry integration installed on the workspace first. ` +
    "Make one when the developer asks for it, or one whose runs land on your own agentId for a " +
    "recurring check you own; never otherwise on your own. Read " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} first so you make none they already have.`,
  inputSchema: CREATE_AUTOMATION_INPUT,
} as const;

export const UPDATE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.UPDATE_AUTOMATION,
  description:
    "Change an automation of your workspace, by its id as " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} answered it, as its editor on the automations page would: ` +
    "what you leave out stands, and a trigger given replaces the one standing whole, a switch " +
    `to Sentry needing ${PRODUCT_NAME}'s Sentry integration installed on the workspace. Change one only ` +
    "where the developer asked for it.",
  inputSchema: UPDATE_AUTOMATION_INPUT,
} as const;

export const DELETE_AUTOMATION_TOOL = {
  name: AGENT_TOOL.DELETE_AUTOMATION,
  description:
    "Delete an automation of your workspace with its history of runs, by its id as " +
    `${AGENT_TOOL.LIST_AUTOMATIONS} answered it, as its Delete on the automations page would; ` +
    "the agents its runs started stay. Delete one only when the developer asks for it, and " +
    `pause one with ${AGENT_TOOL.UPDATE_AUTOMATION} where they only want it to stop.`,
  inputSchema: DELETE_AUTOMATION_INPUT,
} as const;

export const RUN_AUTOMATION_TOOL = {
  name: AGENT_TOOL.RUN_AUTOMATION,
  description:
    `Run an automation of your workspace now, by its id as ${AGENT_TOOL.LIST_AUTOMATIONS} ` +
    "answered it, as its Run now on the automations page would: one run, whatever its trigger, " +
    "starting its agent on its prompt as a " +
    "scheduled run would, or handing it to the one agent it names. Run one when the developer " +
    "asks for it, such as to try an automation just made, never otherwise on your own.",
  inputSchema: RUN_AUTOMATION_INPUT,
} as const;

/** What the automation tools reach: the store, the catalog a model is checked against, GitHub through the workspace's installation, and our Sentry integration. */
type AutomationToolServices =
  | Sandbox
  | DatabaseServices
  | ModelCatalog
  | GitHubApp
  | HttpClient.HttpClient
  | SentryApp;

/** A refusal of the shared writes in the model's words. */
function refusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION;
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return AUTOMATION_TOOL_REFUSAL.NOT_PERMITTED;
    case HOSTED_API_ERROR.NO_REPOSITORY:
      return AUTOMATION_TOOL_REFUSAL.NO_REPOSITORY;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return AUTOMATION_TOOL_REFUSAL.NOT_REACHABLE;
    case HOSTED_API_ERROR.GITHUB_UNANSWERED:
      return AUTOMATION_TOOL_REFUSAL.GITHUB_UNANSWERED;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return AUTOMATION_TOOL_REFUSAL.INVALID;
    default:
      return AUTOMATION_TOOL_REFUSAL.UNAVAILABLE;
  }
}

/** The names a call's disabledServers holds that are no connection's, read off the input as sent, since the wire's own read drops them unsaid. */
function unknownServers(input: UnparsedWireValue): readonly string[] {
  const named = isRecord(input) ? input.disabledServers : undefined;

  if (!Array.isArray(named)) return [];

  return named.filter(
    (name): name is string =>
      Predicate.isString(name) && integrationConnectionOf(name) === undefined,
  );
}

/** A device of the creator's as a refusal lists it: its name and its id. */
function listedDevice(device: Device): string {
  return `${JSON.stringify(device.name)} (deviceId ${device.id})`;
}

/** A machine's name as a make matches it: as a machine's name is kept (`cleanMachineName`), any case, as start_agent reads it. */
function machineNameKey(name: string): string {
  return cleanMachineName(name).toLowerCase();
}

/**
 * The machine a make's or a change's runsOn names, as a start names it: the
 * cloud, or one of the automation's creator's own registered devices, by its
 * name or its id; a device that is not theirs, or a name matching none or
 * several of theirs, is refused, opening with `lead`, with their devices
 * listed. Note that only the creator's own devices are read, whoever calls,
 * because every run starts as its creator, and a device runs only its
 * owner's agents.
 */
const runsOnOfAutomation = Effect.fnUntraced(function* (
  creatorId: string,
  runsOn: typeof AUTOMATION_RUNS_ON.Type,
  lead: string,
): Effect.fn.Return<Result.Result<AgentRunsOnRequest, string>, StoreFailure, DatabaseServices> {
  if (runsOn.machine === AGENT_MACHINE.VERCEL) return Result.succeed(runsOn);
  const devices = yield* devicesSeenSince(creatorId, new Date(0));

  if (devices.length === 0) {
    return Result.fail(
      `${lead}: its creator has no device registered to run agents on, and an automation's ` +
        `runs start on its creator's own machines. Run it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
    );
  }

  const matched =
    "device" in runsOn
      ? devices.filter((device) => machineNameKey(device.name) === machineNameKey(runsOn.device))
      : devices.filter((device) => device.id === runsOn.deviceId);

  const [only] = matched;

  if (matched.length === 1 && only !== undefined) {
    return Result.succeed({ machine: AGENT_MACHINE.DEVICE, deviceId: only.id });
  }

  const asked = "device" in runsOn ? `named ${JSON.stringify(runsOn.device)}` : "has that deviceId";

  const why =
    matched.length === 0
      ? `no device of its creator's ${"device" in runsOn ? "is " : ""}${asked}`
      : `${matched.length} devices of its creator's are ${asked}, so name the one you mean by its deviceId`;

  return Result.fail(
    `${lead}: ${why}, and an automation's runs start on its creator's own machines. Their ` +
      `devices: ${devices.map(listedDevice).join("; ")}. Name one by its name or its deviceId, ` +
      `or run it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  );
});

/** The fields a make must name that the input as sent leaves out, in the schema's order. */
function missingCreateFields(input: UnparsedWireValue): readonly string[] {
  const named = isRecord(input) ? input : {};

  return CREATE_REQUIRED.filter((field) => named[field] === undefined);
}

/** A GitHub trigger's refusal in the model's words, where the call names one on a known event that leaves out a flag its event takes or names one it does not; nothing otherwise, the schema's read standing for the rest. */
function githubFlagsRefused(input: UnparsedWireValue): WireRecord | undefined {
  const trigger = isRecord(input) ? input.trigger : undefined;

  if (!isRecord(trigger) || trigger.kind !== AUTOMATION_TRIGGER.GITHUB) return undefined;
  const event = trigger.event;
  const takes = Predicate.isString(event) ? GITHUB_EVENT_FLAGS.get(event) : undefined;

  if (takes === undefined) return undefined;
  const missing = takes.filter((flag) => trigger[flag] === undefined);

  if (missing.length > 0) {
    return agentToolRejected(
      `${AUTOMATION_TOOL_REFUSAL.GITHUB_FLAGS_MISSING} ${missing.join(", ")} (${String(event)} takes ${takes.join(", ")}).`,
    );
  }

  const extra = GITHUB_FLAGS.filter((flag) => !takes.includes(flag) && flag in trigger);

  if (extra.length === 0) return undefined;

  return agentToolRejected(
    `${AUTOMATION_TOOL_REFUSAL.GITHUB_FLAG_EXTRA} ${extra
      .map((flag) => `${flag} only on ${eventsTaking(flag)}`)
      .join("; ")}; leave ${extra.join(", ")} out of one on ${String(event)}.`,
  );
}

/** A refusal of the servers named that are no connection's, or nothing where every one is. */
function serversRefused(input: UnparsedWireValue): WireRecord | undefined {
  const unknown = unknownServers(input);

  return unknown.length === 0
    ? undefined
    : agentToolRejected(`${AUTOMATION_TOOL_REFUSAL.UNKNOWN_SERVERS} ${unknown.join(", ")}.`);
}

/** An instant as the model reads it. */
function isoOf(at: number | null): string | null {
  return at === null ? null : new Date(at).toISOString();
}

/** One run as an answer names it: what fired it, where it stands and why, and the agent it started. */
function runReading(run: AutomationRunSummary): WireRecord {
  return {
    id: run.id,
    firedBy: run.firing.kind,
    firedAt: isoOf(run.firedAt),
    status: run.status,
    reason: run.reason,
    agent:
      run.agent === null
        ? null
        : {
            id: run.agent.id,
            title: run.agent.title,
            status: run.agent.status,
            ...(run.agent.failureReason === undefined
              ? undefined
              : { failureReason: run.agent.failureReason }),
          },
  };
}

/** Where an automation's runs land, as an answer names it. */
function landingOf(summary: AutomationSummary): WireRecord | string {
  const target = summary.target;

  if (target === undefined || target.kind === AUTOMATION_TARGET.NEW_AGENT) {
    return AUTOMATION_TARGET.NEW_AGENT;
  }

  return { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: target.agentId };
}

/** One automation as an answer names it, its prompt whole or cut to the list's length. */
function automationReading(summary: AutomationSummary, whole: boolean): WireRecord {
  const { prompt } = summary.action;

  const shown =
    whole || prompt.length <= LISTED_PROMPT_CHARS
      ? prompt
      : `${prompt.slice(0, LISTED_PROMPT_CHARS)}…`;

  return {
    id: summary.id,
    name: summary.name,
    enabled: summary.enabled,
    trigger: { ...summary.trigger },
    prompt: shown,
    promptChars: prompt.length,
    model: summary.action.choice?.model ?? null,
    effort: summary.action.choice?.effort ?? null,
    disabledServers: [...(summary.action.disabledServers ?? [])],
    repositories: [...(summary.repositories ?? [])],
    runsOn: summary.runsOn ?? null,
    runsLandOn: landingOf(summary),
    scope: summary.scope ?? AUTOMATION_SCOPE.PERSONAL,
    archiveSuccessful: summary.archiveSuccessful ?? false,
    slackDelivery: summary.slackDelivery ?? false,
    nextRunAt: isoOf(summary.nextRunAt),
    lastRun: summary.lastRun === null ? null : runReading(summary.lastRun),
    madeByYourDeveloper: summary.mine ?? false,
  };
}

/** The schedule's refusal in the model's words, where the trigger is a schedule that does not read. */
const scheduleRefused = (
  trigger: { readonly kind: string } & Partial<{ cron: string; at: string; timezone: string }>,
) =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return undefined;
    const timezone = trigger.timezone ?? "";

    const read = readSchedule(
      trigger.at === undefined
        ? { cron: trigger.cron ?? "", timezone }
        : { at: trigger.at, timezone },
      new Date(now),
    );

    if (Result.isSuccess(read)) return undefined;

    switch (read.failure) {
      case SCHEDULE_REFUSAL.TIMEZONE:
        return AUTOMATION_TOOL_REFUSAL.TIMEZONE;
      case SCHEDULE_REFUSAL.TOO_FREQUENT:
        return AUTOMATION_TOOL_REFUSAL.TOO_FREQUENT;
      case SCHEDULE_REFUSAL.AT:
        return AUTOMATION_TOOL_REFUSAL.AT;
      case SCHEDULE_REFUSAL.PAST:
        return AUTOMATION_TOOL_REFUSAL.PAST;
      case SCHEDULE_REFUSAL.CRON:
        return AUTOMATION_TOOL_REFUSAL.CRON;
    }
  });

/** Sentry's refusal in the model's words, where the trigger is Sentry's and this deployment configures no Sentry integration or the workspace installed none. */
const sentryRefused = Effect.fn("agents/automationSentryRefused")(function* (
  workspaceId: string,
  trigger: { readonly kind: string },
) {
  if (trigger.kind !== AUTOMATION_TRIGGER.INTEGRATION) return undefined;
  const app = yield* SentryApp;
  const configured = yield* Effect.result(app.settings);

  if (Result.isFailure(configured)) return AUTOMATION_TOOL_REFUSAL.SENTRY_UNCONFIGURED;
  const installations = yield* workspaceIntegrationInstallations(workspaceId);

  const installed = installations.some(
    (row) =>
      row.provider === TRIGGER_PROVIDER.SENTRY &&
      row.status === INTEGRATION_INSTALLATION_STATUS.ACTIVE,
  );

  return installed ? undefined : AUTOMATION_TOOL_REFUSAL.SENTRY_NOT_INSTALLED;
});

/** Slack's refusal in the model's words, where the call turns delivery to Slack on and the workspace connected no Slack bot. */
const slackRefused = (workspaceId: string, slackDelivery: boolean | undefined) =>
  slackDelivery !== true
    ? Effect.succeed(undefined)
    : Effect.map(workspaceSlackInstallation(workspaceId), (installation) =>
        Option.isSome(installation) ? undefined : AUTOMATION_TOOL_REFUSAL.SLACK_NOT_CONNECTED,
      );

/** The model and effort named, both or neither; undefined for neither, and null where one came without the other. */
function namedChoice(asked: {
  readonly model?: string;
  readonly effort?: string;
}): ModelChoice | undefined | null {
  if (asked.model === undefined && asked.effort === undefined) return undefined;

  if (asked.model === undefined || asked.effort === undefined) return null;

  return { model: asked.model, effort: asked.effort };
}

/** The choice's refusal in the model's words, where the catalog offers the member no such model and effort. */
const choiceRefused = (
  userId: string,
  choice: ModelChoice | undefined,
  lead: string,
): Effect.Effect<string | undefined, never, DatabaseServices | ModelCatalog> =>
  choice === undefined
    ? Effect.succeed(undefined)
    : acceptedAgentChoice(userId, choice).pipe(
        Effect.as(undefined),
        Effect.catchTag("ModelChoiceRefused", (refused) =>
          Effect.succeed(choiceRefusal(choice, refused.offered, lead)),
        ),
        Effect.catch((refusal) => Effect.succeed(refusalWords(refusal))),
      );

/** Where runs land as the call names an agent, which must be one of the caller's workspace, the caller itself among them: none named leaves it as it stands. */
const landingNamed = (
  userId: string,
  workspaceId: string,
  agentId: string | null | undefined,
  callerId: string | undefined,
): Effect.Effect<
  Result.Result<AutomationTarget | undefined, string>,
  StoreFailure,
  DatabaseServices
> => {
  if (agentId === undefined) return Effect.succeed(Result.succeed(undefined));

  if (agentId === null)
    return Effect.succeed(Result.succeed({ kind: AUTOMATION_TARGET.NEW_AGENT }));

  return Effect.map(workspaceAgent(userId, workspaceId, agentId, callerId), (found) =>
    Option.isNone(found)
      ? Result.fail(AUTOMATION_TOOL_REFUSAL.NO_AGENT)
      : Result.succeed({ kind: AUTOMATION_TARGET.SAME_AGENT, agentId: found.value.id }),
  );
};

/**
 * The member every automation call acts as: a Manager's asker, read from the
 * rows of its turn under way (`turnAsker`), with its owner standing in only
 * where no member asked; else the caller's member.
 */
const automationMember = (
  caller: AgentCall["caller"],
): Effect.Effect<string, StoreFailure, DatabaseServices> => {
  const agent = callerAgent(caller);

  if (agent === undefined || agent.kind !== AGENT_KIND.MANAGER) {
    return Effect.succeed(callerUserId(caller));
  }

  return turnAsker({ userId: agent.userId, conversationId: agent.conversationId });
};

/** An automation of the caller's workspace that its member may read, or nothing: one of another workspace is none of the caller's. */
const workspaceAutomation = (userId: string, workspaceId: string, id: string) =>
  Effect.map(readAutomation(userId, id), (found) =>
    Option.filter(found, (automation) => automation.organizationId === workspaceId),
  );

/** One call of `list_automations`: the caller's workspace's automations its member may read, or one of them whole. */
export function runListAutomations(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readListAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }

  const { automationId, agentId } = asked.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = yield* automationMember(call.caller);

      const found =
        automationId === undefined
          ? undefined
          : yield* workspaceAutomation(userId, workspace.value, automationId);

      if (found !== undefined && Option.isNone(found)) {
        return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      }

      const read = yield* Effect.gen(function* () {
        if (found === undefined || automationId === undefined) {
          const listed = yield* hostedStoreOrUnavailable(
            listAutomations(userId, { organizationId: workspace.value }),
          );

          const landing =
            agentId === undefined
              ? listed
              : listed.filter(
                  (each) =>
                    each.targetKind === AUTOMATION_TARGET.SAME_AGENT &&
                    each.targetAgentId === agentId,
                );

          const summaries = yield* Effect.forEach(landing, (each) => summaryOf(userId, each));

          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            automations: summaries.map((summary) => automationReading(summary, false)),
          };
        }

        const summary = yield* summaryOf(userId, found.value);

        const runs = yield* hostedStoreOrUnavailable(
          listAutomationRuns(userId, automationId, RUNS_READ),
        );

        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          automation: automationReading(summary, true),
          runs: (yield* runSummaries(userId, runs)).map(runReading),
        };
      }).pipe(Effect.result);

      return Result.isSuccess(read) ? read.success : agentToolRejected(refusalWords(read.failure));
    }),
  );
}

/** One call of `create_automation`: an automation made for the caller's member, or a Manager's asker, in the caller's workspace, once under the call's key. */
export function runCreateAutomation(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const missing = missingCreateFields(input);

  if (missing.length > 0) {
    return Effect.succeed(
      agentToolRejected(`${AUTOMATION_TOOL_REFUSAL.MISSING_CREATE} ${missing.join(", ")}.`),
    );
  }

  const flags = githubFlagsRefused(input);

  if (flags !== undefined) return Effect.succeed(flags);
  const asked = readCreateAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_CREATE));
  }

  const made = asked.success;
  const choice: ModelChoice = { model: made.model, effort: made.effort };
  const servers = serversRefused(input);

  if (servers !== undefined) return Effect.succeed(servers);

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = yield* automationMember(call.caller);
      const id = calledId(userId, call.clientKey);
      // A call run again finds the automation it made first, as it was made.
      const already = yield* workspaceAutomation(userId, workspace.value, id);

      if (Option.isSome(already)) {
        const kept = yield* summaryOf(userId, already.value).pipe(Effect.result);

        return Result.isSuccess(kept)
          ? {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              automation: automationReading(kept.success, false),
            }
          : agentToolRejected(refusalWords(kept.failure));
      }

      const schedule = yield* scheduleRefused(made.trigger);

      if (schedule !== undefined) return agentToolRejected(schedule);
      const sentry = yield* sentryRefused(workspace.value, made.trigger);

      if (sentry !== undefined) return agentToolRejected(sentry);
      const slack = yield* slackRefused(workspace.value, made.slackDelivery);

      if (slack !== undefined) return agentToolRejected(slack);
      const model = yield* choiceRefused(userId, choice, "Not made");

      if (model !== undefined) return agentToolRejected(model);
      const runsOn = yield* runsOnOfAutomation(userId, made.runsOn, "Not made");

      if (Result.isFailure(runsOn)) return agentToolRejected(runsOn.failure);

      const landing = yield* landingNamed(
        userId,
        workspace.value,
        made.agentId,
        callerAgent(call.caller)?.id,
      );

      if (Result.isFailure(landing)) return agentToolRejected(landing.failure);

      const action: AutomationAction = {
        kind: AUTOMATION_ACTION.AGENT,
        prompt: made.prompt,
        choice,
        ...(made.disabledServers === undefined
          ? undefined
          : { disabledServers: made.disabledServers }),
      };

      const written = yield* createAutomationAs(
        userId,
        {
          id,
          workspaceId: workspace.value,
          repositories: made.repositories,
          name: made.name,
          trigger: made.trigger,
          action,
          scope: made.scope,
          ...(landing.success === undefined ? undefined : { target: landing.success }),
          archiveSuccessful: made.archiveSuccessful,
          slackDelivery: made.slackDelivery,
        },
        SERVER_AUTOMATION_SOURCE.AGENT,
        runsOn.success,
      ).pipe(Effect.result);

      if (Result.isFailure(written)) {
        const refusal = written.failure;

        // Note that a workspace scope is refused alike in the personal workspace, which the model can act on.
        if (
          refusal.error === HOSTED_API_ERROR.INVALID_REQUEST &&
          made.scope === AUTOMATION_SCOPE.WORKSPACE
        ) {
          return agentToolRejected(AUTOMATION_TOOL_REFUSAL.WORKSPACE_SCOPE);
        }

        return agentToolRejected(refusalWords(refusal));
      }

      // A make run again beside the one that wrote answers that automation, which must be this workspace's.
      if (written.success.automation.workspaceId !== workspace.value) {
        return agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNAVAILABLE);
      }

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: automationReading(written.success.automation, false),
      };
    }),
  );
}

/** One call of `update_automation`: an automation of the caller's workspace changed as its member may change it. */
export function runUpdateAutomation(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const flags = githubFlagsRefused(input);

  if (flags !== undefined) return Effect.succeed(flags);
  const asked = readUpdateAsked(input);
  const choice = Result.isSuccess(asked) ? namedChoice(asked.success) : null;

  if (Result.isFailure(asked) || choice === null) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_UPDATE));
  }

  const {
    automationId,
    model: _model,
    effort: _effort,
    agentId,
    prompt,
    disabledServers,
    runsOn,
    ...rest
  } = asked.success;

  const servers = serversRefused(input);

  if (servers !== undefined) return Effect.succeed(servers);

  const changesAction =
    prompt !== undefined || choice !== undefined || disabledServers !== undefined;

  if (
    !changesAction &&
    agentId === undefined &&
    runsOn === undefined &&
    Object.keys(rest).length === 0
  ) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_UPDATE));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = yield* automationMember(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);

      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      const standing = found.value;

      if (rest.trigger !== undefined) {
        const schedule = yield* scheduleRefused(rest.trigger);

        if (schedule !== undefined) return agentToolRejected(schedule);
        const sentry = yield* sentryRefused(workspace.value, rest.trigger);

        if (sentry !== undefined) return agentToolRejected(sentry);
      }

      const slack = yield* slackRefused(workspace.value, rest.slackDelivery);

      if (slack !== undefined) return agentToolRejected(slack);
      const model = yield* choiceRefused(userId, choice, "Not changed");

      if (model !== undefined) return agentToolRejected(model);

      // Note that a machine is read against the creator's devices, since every run starts as its creator,
      // and only once the caller may change it, because a refusal lists those devices.
      const changeable =
        runsOn === undefined
          ? true
          : Option.isSome(yield* readAutomation(userId, automationId, AUTOMATION_ACCESS.CHANGE));

      if (!changeable) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NOT_PERMITTED);

      const machine =
        runsOn === undefined
          ? undefined
          : yield* runsOnOfAutomation(standing.userId, runsOn, "Not changed");

      if (machine !== undefined && Result.isFailure(machine)) {
        return agentToolRejected(machine.failure);
      }

      const landing = yield* landingNamed(
        userId,
        workspace.value,
        agentId,
        callerAgent(call.caller)?.id,
      );

      if (Result.isFailure(landing)) return agentToolRejected(landing.failure);

      const action: AutomationAction | undefined = changesAction
        ? {
            ...standing.action,
            ...(prompt === undefined ? undefined : { prompt }),
            ...(choice === undefined ? undefined : { choice }),
            ...(disabledServers === undefined ? undefined : { disabledServers }),
          }
        : undefined;

      const written = yield* changeAutomationAs(
        userId,
        standing,
        {
          ...rest,
          ...(action === undefined ? undefined : { action }),
          ...(landing.success === undefined ? undefined : { target: landing.success }),
        },
        SERVER_AUTOMATION_SOURCE.AGENT,
        machine?.success,
      ).pipe(Effect.result);

      if (Result.isFailure(written)) {
        const refusal = written.failure;

        if (
          refusal.error === HOSTED_API_ERROR.INVALID_REQUEST &&
          rest.scope === AUTOMATION_SCOPE.WORKSPACE
        ) {
          return agentToolRejected(AUTOMATION_TOOL_REFUSAL.WORKSPACE_SCOPE);
        }

        return agentToolRejected(refusalWords(refusal));
      }

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: automationReading(written.success.automation, false),
      };
    }),
  );
}

/** One call of `delete_automation`: an automation of the caller's workspace deleted with its history, as its member may delete it. */
export function runDeleteAutomation(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readDeleteAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }

  const { automationId } = asked.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = yield* automationMember(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);

      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);

      const deleted = yield* removeAutomationAs(
        userId,
        found.value,
        SERVER_AUTOMATION_SOURCE.AGENT,
      ).pipe(
        Effect.as({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          automation: { id: found.value.id, name: found.value.name },
        }),
        Effect.result,
      );

      return Result.isSuccess(deleted)
        ? deleted.success
        : agentToolRejected(refusalWords(deleted.failure));
    }),
  );
}

/** One call of `run_automation`: an automation of the caller's workspace run now, once under the call's key, as its member may run it. */
export function runRunAutomation(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AutomationToolServices> {
  const asked = readRunAsked(input);

  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AUTOMATION_TOOL_REFUSAL.UNREADABLE_ID));
  }

  const { automationId } = asked.success;
  const { agentSessionsAs } = call;

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const userId = yield* automationMember(call.caller);
      const found = yield* workspaceAutomation(userId, workspace.value, automationId);

      if (Option.isNone(found)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION);
      const runnable = yield* readAutomation(userId, automationId, AUTOMATION_ACCESS.RUN);

      if (Option.isNone(runnable)) return agentToolRejected(AUTOMATION_TOOL_REFUSAL.NOT_RUNNABLE);

      // Note that the run reaches the agent's sessions as the deployment acting for the account it starts as, its creator, whoever fired it, as the sweep's runs do.
      const ran = yield* runAutomationNowAs(
        userId,
        runnable.value,
        calledId(userId, call.clientKey),
        (account) => Effect.succeed(agentSessionsAs(account)),
      ).pipe(Effect.result);

      if (Result.isFailure(ran)) return agentToolRejected(refusalWords(ran.failure));

      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        automation: { id: runnable.value.id, name: runnable.value.name },
        run: runReading(ran.success.run),
        alreadyRan: !ran.success.made,
      };
    }),
  );
}
