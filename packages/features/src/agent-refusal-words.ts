/**
 * agent-refusal-words.ts -- what a refused Start, message, or Stop says, by why the service refused it, worded once for every client that sends one: the panel's agent tabs and New task, and the iOS app's composer, New agent, and New task.
 *
 * The words are plain text; what mends a refusal (a press into Settings, a
 * task moved to the workspace whose GitHub reaches it) is each client's own,
 * built over these where it offers one.
 */

import { LIMIT_REACHED_WORDS } from "./agent-failure-words.js";
import { harnessNameOf } from "./agent-runtime-models.js";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "./agent-view.js";
import {
  EXTRA_REPOSITORY_REFUSAL,
  type ExtraRepositoryRefusal,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  type RefusedDevice,
} from "./agent-wire.js";
import { DEVICE_PLATFORM, type DevicePlatform } from "./device-agent-wire.js";
import { devicePlatformOf } from "./device-platform.js";
import type { ModelProvider } from "./models-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import type { RepositoryUnreached } from "./repository-reach-wire.js";

/** What a Start refused for want of a repository says. */
const START_NEEDS_REPOSITORY = "Choose a repository";

/** What a call refused for a repository out of the workspace's reach says, wherever it is refused. */
export const REPOSITORY_UNREACHED_NOTE = `${PRODUCT_NAME} cannot reach this task's repository on GitHub.`;

/** What a message no answer came back for says, which may have reached the agent all the same. */
export const NOT_HEARD_BACK = "No answer came back.";

/** What the refusals a Start and a message meet alike say, worded once. */
export const SHARED_FAILURE_NOTE = {
  [AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: REPOSITORY_UNREACHED_NOTE,
  [AGENT_CALL_FAILURE.GITHUB_UNANSWERED]: "GitHub didn't answer.",
  [AGENT_CALL_FAILURE.MESSAGE_TOO_LONG]: "That message is too long.",
  [AGENT_CALL_FAILURE.AGENT_NOT_READY]: "The agent is still starting. Try again in a moment.",
  [AGENT_CALL_FAILURE.NOT_PERMITTED]: "Only the member who started this agent can do this.",
  [AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE]: "This agent cannot be reached from here yet.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]:
    "The plan paying for this agent is signed out. Its starter signs in again in Settings.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE]:
    "The plan's provider didn't answer. Try again in a moment.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED]: LIMIT_REACHED_WORDS,
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "The plan paying for this agent isn't eligible to run it.",
} as const;

/** What a Start from an agent whose session has ended says. */
const START_RETIRED = "This agent has ended. Start a new one.";

/** What a message to an agent whose session has ended says where only the words are drawn, as an Inbox answer's are. */
const MESSAGE_RETIRED = "This agent has ended. Continue in a new one.";

/** What a message to an agent whose host its starter removed says, and a Start that would run there, wherever it is drawn: only a new agent in the cloud or the host added again goes on from here. */
export const HOST_REMOVED =
  "This machine was removed. Start a new agent in the cloud or add it again.";

/** What a message that did not reach the agent says of itself, which a surface without Retry follows with Try again. */
export const MESSAGE_NOT_SENT = "The message could not be sent.";

/** What the toast says when the service did not stop an agent. */
export const STOP_FAILED = "The agent could not be stopped. Try again.";

/** What the toast says when the agent a Stop answered still reads at work: it found no turn open to cancel, and no runner gone quiet to settle. */
export const STOP_NOTHING_YET = "There's nothing to stop yet. Try again once the agent is working.";

/** A refused start or message as the view hears it: why, why the repository is out of reach where it is and the service said, when a plan's reached limit resets where it is that and the provider said, and the provider whose credential is missing where it is that. */
export interface RefusedCall {
  readonly failure: AgentCallFailure;
  readonly unreached?: RepositoryUnreached | undefined;
  readonly resetsAt?: number | undefined;
  readonly provider?: ModelProvider | undefined;
  readonly localAgentRefusal?: LocalAgentRefusal | undefined;
  readonly refusedDevice?: RefusedDevice | undefined;
  readonly extraRepositoryRefusal?: ExtraRepositoryRefusal | undefined;
  readonly refusedRepository?: string | undefined;
}

/** The device a Start would run its agent on, as a refusal names it: its name, its platform where the service said, and its owner where it is another member's and the service said. */
export interface RefusingDevice {
  readonly name: string;
  readonly platform?: DevicePlatform | undefined;
  readonly owner?: string | undefined;
}

/** What a device refusing a Start is called where its name is not known. */
const UNNAMED_DEVICE = "Your device";

/** The way out every device refusal ends on, since the cloud takes any agent: the same start with Runs on on Cloud. */
const RUN_IN_CLOUD = "or start it in the cloud";

/** How a device that went quiet is brought back, by its platform: a Mac woken and logged in on, since its host runs in its user's login session, or a Linux server's own `vespin-host` checked. */
const DEVICE_WAKE = {
  [DEVICE_PLATFORM.DARWIN]: "Wake it and log in on it",
  [DEVICE_PLATFORM.LINUX]: "Check that it's on, connected, and running vespin-host",
} as const satisfies Record<DevicePlatform, string>;

/** How a device whose setup failed tries it again, by its platform: Bring your own machine turned off and on in Settings › Machines on a Mac, whose desktop app keeps its host running, or a Linux server's own `vespin-host` restarted. */
const SETUP_RETRY = {
  [DEVICE_PLATFORM.DARWIN]:
    "Open Settings › Machines on that Mac and turn Bring your own machine off and on",
  [DEVICE_PLATFORM.LINUX]: "Run systemctl --user restart vespin-host on that server",
} as const satisfies Record<DevicePlatform, string>;

/**
 * Why the device a Start would run its agent on would not take it, as New
 * task and an agent's Start alike say it, naming the device where the
 * panel knows it and ending on the way out, the cloud. A refusal the
 * service named no reason for says the device would not take it.
 */
export function localAgentRefusalWords(
  refusal: LocalAgentRefusal | undefined,
  device: RefusingDevice | undefined,
): string {
  const name = device?.name ?? UNNAMED_DEVICE;
  switch (refusal) {
    case LOCAL_AGENT_REFUSAL.MAC_AWAY:
      return `${name} is offline, so this agent can't start there. ${DEVICE_WAKE[devicePlatformOf(device ?? {})]}, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.CODEX:
      return `${name} can't run Codex agents yet. Wait for its Codex download to finish, choose a Claude model, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.NO_HARNESS:
      return `${name} can't run this model's agents. Choose a Claude or Codex model, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.PREPARING:
      return `${name} is still getting ready for local agents. Try again in a few minutes.`;
    case LOCAL_AGENT_REFUSAL.SETUP_FAILED:
      return `${name} couldn't set up local agents. ${SETUP_RETRY[devicePlatformOf(device ?? {})]} to try again, ${RUN_IN_CLOUD}.`;
    // Note that no way out is offered, because the cloud is the owner's to set and a teammate can change nothing here.
    case LOCAL_AGENT_REFUSAL.NOT_OWNER:
      return `This task runs on ${device?.name ?? "another member's device"}. Only ${device?.owner ?? "its owner"} can start agents on it.`;
    case LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN:
      return `${name} runs an older vespin-host, which can't work in a repository reached on your own GitHub token. Update its host, ${RUN_IN_CLOUD}.`;
    // Note that the way out is the machine's own update or Full access, since the cloud is not where this agent's mode was the question.
    case LOCAL_AGENT_REFUSAL.PERMISSION_MODES:
      return `${name} runs an older version of ${PRODUCT_NAME}, which would run this agent without asking. Update ${PRODUCT_NAME} on this machine to use Ask for approval, or switch this agent to Full access.`;
    case undefined:
      return `${name} couldn't take this agent. Try again, ${RUN_IN_CLOUD}.`;
  }
}

/** Why a repository beside an agent's own is refused, as New task and Add repository… both say it. */
const EXTRA_REPOSITORY_WHY = {
  token: (named: string) =>
    `${named} is reached on your own GitHub token. An agent's repositories must all be reached through the GitHub App.`,
  otherInstallation: (named: string) =>
    `${named} is on another GitHub account than the agent's repository. An agent's repositories must share one.`,
} as const;

/** What Add repository… says where the service answered no reason it names. */
const NOT_ADDED = "The repository couldn't be added. Try again.";

/**
 * Why a repository added to a running agent was refused, as Add
 * repository… says it under its chooser, naming the repository where the
 * service named one; a refusal it named no reason for says it was not
 * added. The words a Start's extras are refused with stand for what both
 * are refused for (`EXTRA_REPOSITORY_WHY`).
 */
export function addRepositoryFailureWords(refused: RefusedCall): string {
  const named = refused.refusedRepository ?? "That repository";
  if (refused.failure === AGENT_CALL_FAILURE.NOT_PERMITTED) {
    return "Only the member who started this agent can add a repository to it.";
  }
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return "The workspace's GitHub App doesn't reach that repository.";
  }
  if (refused.failure !== AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED) return NOT_ADDED;
  switch (refused.extraRepositoryRefusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return "This agent works in no repository of its own. Start an agent in that repository instead.";
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return "Only an agent in the cloud works in several repositories.";
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return EXTRA_REPOSITORY_WHY.token(named);
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return EXTRA_REPOSITORY_WHY.otherInstallation(named);
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
      return `${named} is already among this agent's repositories.`;
    case EXTRA_REPOSITORY_REFUSAL.FULL:
      return "This agent already works in as many repositories as it can.";
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
    case undefined:
      return NOT_ADDED;
  }
}

/**
 * Why the repositories a Start named beside its agent's own were refused, as
 * New task says it, naming the repository where the service named one. A
 * refusal the service named no reason for says they could not be used.
 */
export function extraRepositoryRefusalWords(
  refusal: ExtraRepositoryRefusal | undefined,
  repository: string | undefined,
): string {
  const named = repository ?? "One of the other repositories";
  switch (refusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return "Choose the agent's repository before adding others.";
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return "An agent in several repositories runs only in the cloud. Start it in the cloud, or remove the other repositories.";
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return EXTRA_REPOSITORY_WHY.token(named);
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return EXTRA_REPOSITORY_WHY.otherInstallation(named);
    // Note that a Start is refused none of these, which only a repository added to a running agent is.
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
    case EXTRA_REPOSITORY_REFUSAL.FULL:
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
    case undefined:
      return "These repositories can't be used together. Remove the others to start the agent.";
  }
}

/** What a missing credential keeps the developer from: starting an agent, or messaging one. */
export const ACTION = { START: "start an agent", MESSAGE: "message this agent" } as const;

/** The one sentence a missing credential says: the harness to connect, by the provider the service named, and what it unblocks. */
export function credentialMissingWords(
  provider: ModelProvider | undefined,
  action: (typeof ACTION)[keyof typeof ACTION],
): string {
  const harness = provider === undefined ? "Claude or Codex" : harnessNameOf(provider);
  return `Connect ${harness} in Settings to ${action}.`;
}

/** What an unreadable API key says where no press beside it opens Settings: that saving it again there unblocks the action. */
export function keyUnreadableWords(action: (typeof ACTION)[keyof typeof ACTION]): string {
  return `Your saved API key can't be read. Save it again in Settings to ${action}.`;
}

/** What a Start that did not start says, by why. */
export function startFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This task no longer exists.";
    // Note that only a dictated clip is refused for want of an OpenAI key, and only a ChatGPT sign-in braked or given no code, so a Start never hears them.
    case AGENT_CALL_FAILURE.UNANSWERED:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
    case AGENT_CALL_FAILURE.QUOTA_EXHAUSTED:
    case AGENT_CALL_FAILURE.UPSTREAM_ERROR:
    // Note that a Start never names a permission mode, so never meets its refusal.
    case AGENT_CALL_FAILURE.PERMISSION_MODE_REFUSED:
      return "The agent could not be started.";
    case AGENT_CALL_FAILURE.AGENT_RETIRED:
      return START_RETIRED;
    case AGENT_CALL_FAILURE.DEVICE_REMOVED:
      return HOST_REMOVED;
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
    case AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingWords(undefined, ACTION.START);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return keyUnreadableWords(ACTION.START);
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return localAgentRefusalWords(undefined, undefined);
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
      return extraRepositoryRefusalWords(undefined, undefined);
  }
}

/** What a message that did not reach the agent says, by why, where only the words are drawn, as an Inbox answer's are, so a refusal trying again mends says so. */
export function messageFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    // A message names no repository, no model, no clip, and no sign-in, so none of these refusals is its own.
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
    case AGENT_CALL_FAILURE.QUOTA_EXHAUSTED:
    case AGENT_CALL_FAILURE.UPSTREAM_ERROR:
      return `${MESSAGE_NOT_SENT} Try again.`;
    // A message is refused by a device only while it is away, in the words a Start on it is.
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return localAgentRefusalWords(LOCAL_AGENT_REFUSAL.MAC_AWAY, undefined);
    // No answer is not a refusal: the words may have reached the agent, and Retry carries the same key, so they reach it once.
    case AGENT_CALL_FAILURE.UNANSWERED:
    // Note that a message never names a permission mode, so never meets its refusal.
    case AGENT_CALL_FAILURE.PERMISSION_MODE_REFUSED:
      return `${NOT_HEARD_BACK} Try again.`;
    case AGENT_CALL_FAILURE.AGENT_RETIRED:
      return MESSAGE_RETIRED;
    case AGENT_CALL_FAILURE.DEVICE_REMOVED:
      return HOST_REMOVED;
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
      return `${SHARED_FAILURE_NOTE[failure]} Try again.`;
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
    case AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingWords(undefined, ACTION.MESSAGE);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return keyUnreadableWords(ACTION.MESSAGE);
  }
}
