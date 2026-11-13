import {
  agentFailureWords,
  hostLostWords,
  LIMIT_REACHED_WORDS,
  launchStoppedWords,
  mendedByNewAgent,
} from "@repo/features/agent-failure-words";
import { AGENT_PART, agentParts, endTurnOf, endTurnSummary } from "@repo/features/agent-parts";
import {
  ACTION,
  credentialMissingWords,
  deviceAwayWords,
  HOST_REMOVED,
  keyUnreadableWords,
  localAgentRefusalWords,
  MESSAGE_NOT_SENT,
  messageFailureWords,
  NOT_HEARD_BACK,
  type RefusedCall,
  type RefusingDevice,
  SHARED_FAILURE_NOTE,
  startFailureWords,
} from "@repo/features/agent-refusal-words";
import { newerTurn, turnAgentStatus, turnOpen } from "@repo/features/agent-status";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import {
  AGENT_ARCHIVER,
  AGENT_FAILURE,
  AGENT_PAYER,
  AGENT_RUNTIME,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentArchivedBy,
  type AgentAttachment,
  type AgentFailure,
  type AgentPayer,
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  type AgentRuntime,
  type AgentSender,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
  type AgentTurn,
  type AgentUsage,
  CONTEXT_WINDOW,
  LOCAL_AGENT_REFUSAL,
  type NativeAgentRuntime,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type { DeviceLaunchStep, DeviceLaunchUnstarted } from "@repo/features/device-agent-wire";
import {
  FAILURE_REASON,
  type Failure,
  type FailureReason,
  remedyLabel,
} from "@repo/features/failure-remedy";
import { agentGlyphState, GLYPH_STATE, type GlyphState } from "@repo/features/glyph-state";
import { contextWindowsOf, effortLabel, SPEED_WORD, windowOf } from "@repo/features/model-effort";
import {
  agentName,
  CATALOG_ID_SEPARATOR,
  modelLabel,
  providerOf,
} from "@repo/features/model-label";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_PROVIDER,
  MODEL_SPEED,
  type ModelChoice,
  type ModelProvider,
  type ModelSpeed,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import { formatCompact, formatUsd } from "@repo/features/number-format";
import { plainWords } from "@repo/features/plain-words";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { PULL_REQUEST_STATE_LABEL, QUEUED_LABEL } from "@repo/features/pull-request-model";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@repo/features/repository-reach-wire";
import { agentStillWriting, inPullRequestOrder } from "@repo/features/task-agents-model";
import type { DescriptionEditor, TaskPullRequestLine } from "@repo/features/task-wire";
import { dayAndTimeText, dueText } from "@repo/features/time-format";
import { TOOL_STATE, type ToolState } from "@repo/features/tool-call-block";
import { githubLineOf } from "@repo/features/transcript-lines";
import { isAgentTurn, isVoiceLine } from "@repo/features/voice-call-lines";
import { andList, countWords, readFailedWords, TERM } from "@repo/features/words";
import type { FormerMember, WorkspaceMember } from "@repo/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  APP_ACTOR,
  githubLoginActor,
  personActor,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { MESSAGE_ROLE, TURN_STATUS } from "@repo/wire";
import { USAGE_LIMIT_AGENT, type UsageLimitNotice } from "@repo/wire/ui-messages";
import { Predicate } from "effect";

/**
 * agent-model.ts -- what the agent tabs, a Start, and an agent's transcript draw, decided from what the service answered.
 *
 * Pure decisions over the wire's shapes: how an agent is named on its tab,
 * what its tab's glyph says of where it stands, what line ends a transcript whose turn failed
 * or was stopped, whether its transcript is still followed, how a stored message's parts
 * are read for drawing, which of its rows wait above the composer rather
 * than in the transcript, what its working line says it is doing, when a
 * line the developer sent has been read back, what a Start or a message
 * that did not land says, and what its
 * pull request's row says and opens, and how what an agent or a turn cost is told.
 * Nothing here asks anything.
 */

/** The words that separate the parts of a line. */
const LINE_SEPARATOR = " · ";

/** Each payer as its line names it, after whose it is; a key's line goes on to what the agent has cost. */
const PAYER_WORDS = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: "Claude plan",
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: "Codex plan",
  [AGENT_PAYER.APP]: `${PRODUCT_NAME}'s API key`,
  [AGENT_PAYER.MAC_SIGN_IN]: "Mac's sign-in",
} as const satisfies Record<Exclude<AgentPayer, typeof AGENT_PAYER.API_KEY>, string>;

/** The kind of plan each plan payer runs on. */
const PLAN_PAYER_KIND = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
} as const satisfies Partial<Record<AgentPayer, ProviderKeyKind>>;

type PlanPayer = keyof typeof PLAN_PAYER_KIND;

function planPayer(payer: AgentPayer | undefined): payer is PlanPayer {
  return payer !== undefined && payer in PLAN_PAYER_KIND;
}

/**
 * The reader's own plan that pays for the agent, for the model menu's last
 * line: the subscription the page named, or, for one a new agent would
 * start on (`next`), the first of the payer's kind in the reader's order
 * with room left, as a turn picks it. Nothing for a plan the reader does not
 * hold or a teammate's agent (`teammate`), whose starter's plan pays and
 * whose page may name none yet, since the reader's own next plan is never
 * the one that pays there.
 */
export function payerPlanOf(
  payer: AgentPayer | undefined,
  subscriptions: readonly SubscriptionKeySummary[] | undefined,
  subscriptionId: string | undefined,
  next: boolean,
  teammate = false,
): SubscriptionKeySummary | undefined {
  if (teammate || !planPayer(payer) || subscriptions === undefined) return undefined;
  const kind = PLAN_PAYER_KIND[payer];

  return subscriptionId !== undefined
    ? subscriptions.find((one) => one.id === subscriptionId && one.kind === kind)
    : next
      ? subscriptions
          .filter((one) => one.kind === kind)
          .toSorted((a, b) => a.position - b.position)
          .find(
            (one) =>
              one.status === PROVIDER_KEY_STATUS.VERIFIED ||
              one.status === PROVIDER_KEY_STATUS.UNVERIFIED,
          )
      : undefined;
}

/** The reader's own plan that pays (`payerPlanOf`) by its name: the one the reader gave it, else the ChatGPT account it signed in as; nothing for one with neither. */
export function payerPlanName(
  payer: AgentPayer | undefined,
  subscriptions: readonly SubscriptionKeySummary[] | undefined,
  subscriptionId: string | undefined,
  next: boolean,
  teammate = false,
): string | undefined {
  return planNameOf(payerPlanOf(payer, subscriptions, subscriptionId, next, teammate));
}

/** A plan by its name: the one the reader gave it, else the ChatGPT account it signed in as. */
export function planNameOf(plan: SubscriptionKeySummary | undefined): string | undefined {
  return plan?.label ?? plan?.email;
}

/** The member's own API key, named by the provider it is for. */
export const API_KEY_WORDS = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

/** A key whose provider the choice does not say. */
const ANY_API_KEY = "API key";

/** The payers billed by the token, whose line says what the agent has cost so far. */
const PRICED_PAYERS: ReadonlySet<AgentPayer> = new Set([AGENT_PAYER.API_KEY, AGENT_PAYER.APP]);

/** How a payer's line marks it: its plan's harness, a key, or the Mac it signed in on. */
export const PAYER_MARK = {
  PLAN: "plan",
  KEY: "key",
  MAC: "mac",
} as const;

export type PayerMark = (typeof PAYER_MARK)[keyof typeof PAYER_MARK];

/** Who pays for an agent, as its line draws it: the mark, whether a member owns it, and the words after whose. */
export interface PayerParts {
  readonly mark: PayerMark;
  /** Whether it is a member's own, so the line says whose: "Your", or the teammate who started the agent. */
  readonly owned: boolean;
  /** "Claude plan", the plan by its name, "Codex plan (ana@work.com)", or a key and what the run has cost on it: "Anthropic API key · $0.42 so far". */
  readonly words: string;
  /** Whether the words name the plan, whose name may be its account's email, so a screen recording masks them. */
  readonly masked: boolean;
}

/**
 * Who pays for the agent, in parts for its line: "Claude plan", "ChatGPT
 * plan", or a key by its provider and what the run has cost on it,
 * "Anthropic API key · $0.42 so far", the key alone where the service could
 * not price every step; nothing where no payer is named. Every payer but the
 * app's own key is a member's, the agent's starter's, so its line says whose
 * before the words. Note that a plan's line names no tokens, since the
 * composer's context ring already says how full the window is and a
 * subscription has no bill per token, and that the price is the whole run's,
 * the agent's own turns and its workers', at the catalog's list prices.
 */
export function agentPayerParts(
  payer: AgentPayer | undefined,
  provider: ModelProvider | undefined,
  costUsd: number | undefined,
  /** The plan that pays, by its name, where the reader's own keys name it (`payerPlanName`). */
  planName?: string | undefined,
): PayerParts | undefined {
  if (payer === undefined) return undefined;

  const plan =
    payer === AGENT_PAYER.API_KEY
      ? provider === undefined
        ? ANY_API_KEY
        : API_KEY_WORDS[provider]
      : PAYER_WORDS[payer];

  const named = planPayer(payer) && planName !== undefined ? `${plan} (${planName})` : plan;

  const words =
    PRICED_PAYERS.has(payer) && costUsd !== undefined
      ? `${named}${LINE_SEPARATOR}${formatUsd(costUsd)} so far`
      : named;

  const mark = planPayer(payer)
    ? PAYER_MARK.PLAN
    : payer === AGENT_PAYER.MAC_SIGN_IN
      ? PAYER_MARK.MAC
      : PAYER_MARK.KEY;

  return { mark, owned: payer !== AGENT_PAYER.APP, words, masked: named !== plan };
}

/**
 * The teammate who started an agent, by name, whose key pays for it and whose
 * Mac its commands run on; none for the reader's own agent, one whose starter
 * the service names nobody for, or one read with no account id. Note that an
 * agent read with no id names nobody, because whose it is cannot be told,
 * and taking the reader's own for a teammate's would hide the Settings that
 * mend the reader's own key.
 */
export function teammateStarter(
  startedBy: DescriptionEditor | undefined,
  readerId: string | undefined,
): string | undefined {
  return teammateRef(startedBy, readerId)?.name;
}

/** The teammate who started an agent, as the wire names them, for a card to draw; none where `teammateStarter` names nobody. */
export function teammateRef(
  startedBy: DescriptionEditor | undefined,
  readerId: string | undefined,
): DescriptionEditor | undefined {
  if (startedBy === undefined || readerId === undefined || startedBy.userId === readerId) {
    return undefined;
  }

  return startedBy;
}

/**
 * Whose Mac an agent's Mac commands ran on, as their row names it: its
 * starter, the reader's own among them; none where the service names
 * nobody or the reader's id is not known, when the row says the reader's
 * own as it always has, for the reason `teammateStarter` gives.
 */
export function macOwnerOf(
  startedBy: DescriptionEditor | undefined,
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (startedBy === undefined || readerId === undefined) return undefined;

  return personActor(startedBy, members, readerId, former);
}

/** Where an actor's work stands, as a tab's glyph state says it. */
const ACTOR_STATE_OF_GLYPH = {
  [GLYPH_STATE.WORKING]: ACTOR_STATE.WORKING,
  [GLYPH_STATE.FAILED]: ACTOR_STATE.FAILED,
  [GLYPH_STATE.REST]: ACTOR_STATE.REST,
} as const satisfies Record<GlyphState, ActorState>;

/** Who archived an agent, and why, as its card and its archived banner say it. */
export interface ArchivedByReading {
  /** "Archived by Dean", "Archived by ${PRODUCT_NAME} for you", "Archived by Bill by seat for Dean", "Archived with its task by Dean". */
  readonly words: string;
  readonly reason: string | undefined;
}

/** What names an agent that archived another whose title the service kept empty. */
const UNNAMED_ARCHIVER = "another agent";

/**
 * Who archived an agent, as the reader reads it: the member who did, or
 * the app or the archiving agent and the member they acted for, "you" for the
 * reader's own account, the member left out once their account is gone;
 * and the reason they gave. An agent archived along with its task says so.
 */
export function archivedByReading(
  by: AgentArchivedBy,
  readerId: string | undefined,
): ArchivedByReading {
  const member =
    by.member === undefined ? undefined : by.member.userId === readerId ? "you" : by.member.name;

  const forMember = member === undefined ? "" : ` for ${member}`;

  const archiver =
    by.by === AGENT_ARCHIVER.MEMBER
      ? member
      : by.by === AGENT_ARCHIVER.APP
        ? `${PRODUCT_NAME}${forMember}`
        : `${by.agent?.name || UNNAMED_ARCHIVER}${forMember}`;

  const archived = by.withTask === true ? "Archived with its task" : "Archived";

  return {
    words: archiver === undefined ? archived : `${archived} by ${archiver}`,
    reason: by.reason,
  };
}

/**
 * A subagent or a brain's worker as its card's tile draws it: the harness
 * its model runs in, or the muted robot where the model is not known, giving
 * way to the working mark while it works, as an agent's tile does.
 */
export function subagentActor(model: string | undefined, state: GlyphState, name: string): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: model === undefined ? undefined : providerOf(model),
    state: ACTOR_STATE_OF_GLYPH[state],
  };
}

/** Where an agent's work stands, as its tile wears it, read off its status. */
export function agentActorState(status: AgentStatus): ActorState {
  return ACTOR_STATE_OF_GLYPH[agentGlyphState(status)];
}

/**
 * An agent as its tile draws it: its harness, read off its model, wearing where it stands
 * (at rest where that is not known), under the name it goes by.
 */
export function agentActor(
  agent: {
    readonly model: string;
    readonly status?: AgentStatus | undefined;
  },
  name: string,
): Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }> {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: providerOf(agent.model),
    state:
      agent.status === undefined
        ? ACTOR_STATE.REST
        : ACTOR_STATE_OF_GLYPH[agentGlyphState(agent.status)],
  };
}

/**
 * What sent one of the developer's messages to an agent, as the actor named
 * over it: a teammate read against the workspace's `members` for their
 * face, a former member, the app, an automation, another coding agent of the
 * workspace by its name on its harness's mark, read off the model the
 * service answers it runs on, and the mark of no known harness where it
 * answers none, or the GitHub login GitHub
 * told the agent of, a person's circle by their avatar or an App's bot's
 * square by whether the login is a bot's (`githubLoginActor`); none for the reader's own,
 * a message whose sender was not kept, or a member's read with no account
 * id, for the reason `teammateStarter` gives. A service older than the
 * sender's kind names the app, an automation, and a former member alike by a
 * name with no account, which the window cannot tell apart, so such a
 * sender stands by its name on the outline of someone it cannot place.
 */
export function lineSender(
  sentBy: AgentSender | undefined,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (sentBy === undefined) return undefined;

  if (sentBy.userId !== undefined && (readerId === undefined || sentBy.userId === readerId)) {
    return undefined;
  }

  if (sentBy.agent === true) {
    return {
      kind: ACTOR_KIND.AGENT,
      name: sentBy.name,
      ...(sentBy.agentId === undefined ? undefined : { agentId: sentBy.agentId }),
      provider: sentBy.model === undefined ? undefined : providerOf(sentBy.model),
      state: ACTOR_STATE.REST,
    };
  }

  switch (sentBy.kind) {
    case AGENT_SENDER.APP:
      return APP_ACTOR;
    case AGENT_SENDER.AUTOMATION:
      return {
        kind: ACTOR_KIND.AUTOMATION,
        ...(sentBy.automationId === undefined ? undefined : { automationId: sentBy.automationId }),
        name: sentBy.name,
        state: ACTOR_STATE.REST,
      };
    case AGENT_SENDER.GITHUB:
      return githubLoginActor(sentBy.name);
    case AGENT_SENDER.FORMER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.FORMER };
    case AGENT_SENDER.MEMBER:
    case undefined:
      return sentBy.userId === undefined
        ? { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED, name: sentBy.name }
        : personActor({ userId: sentBy.userId, name: sentBy.name }, members, readerId, former);
  }
}

/**
 * Who sent a transcript line, as `lineSender` names them, a GitHub login
 * wearing the avatar its line carries where GitHub named one (`by_avatar`),
 * since an App's bot's picture lives at an address its login does not name.
 */
export function messageSender(
  message: AgentTranscriptMessage,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  const sender = lineSender(message.sentBy, readerId, members, former);
  const avatarUrl = githubLineOf(message)?.by_avatar;

  return sender?.kind === ACTOR_KIND.GITHUB && avatarUrl !== undefined
    ? { ...sender, avatarUrl }
    : sender;
}

/** The parts of the line a transcript ends on: its words, and whether it tells of a failure, which is drawn as one. */
export interface EndLineParts {
  readonly words: string;
  readonly failed: boolean;
  /** Why a failed turn failed, as the service's word, which the failure it reports names; none for a stop, or a failure that said no reason. */
  readonly failure?: AgentFailure | undefined;
  /** Why a host's launch never started, where its host said, which may draw a card of its own in the line's place (`github-sign-in-card.tsx`). */
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/** Where a launch its host settled unstarted stopped, and why where its host said, as the page said, and the harness the agent runs, as its summary says. */
export interface LaunchStopped {
  readonly step: DeviceLaunchStep;
  readonly runtime?: NativeAgentRuntime | undefined;
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/**
 * The quiet line a transcript ends on once its turn failed or was stopped,
 * in parts, so its words and its failed mark can be drawn apart; nothing
 * for an agent still writing or one that completed. A teammate's agent
 * names its starter's key, since it runs on theirs and not the reader's.
 * An agent whose tab offers Continue, or that another already continued
 * (`continuable`), is not told to start a new one. One whose host stopped
 * beating while its turn ran (`hostLost`) names the host and that a message
 * carries it on once the host is back, in place of its failure's words. One
 * whose host settled its launch unstarted (`launchStopped`) names the step
 * the launch stopped at and that a message tries again.
 * Note that it names no price, because a price in the window means the
 * whole run's, which the model menu's last line says (`agent-payer.tsx`).
 */
export function endLineParts(
  status: AgentStatus,
  failure: AgentFailure | undefined,
  starter?: string,
  continuable = false,
  hostLost?: { readonly host: string },
  launchStopped?: LaunchStopped,
): EndLineParts | undefined {
  switch (status) {
    case AGENT_STATUS.CANCELED:
      return { words: "Stopped", failed: false };
    case AGENT_STATUS.FAILED: {
      if (hostLost !== undefined)
        return { words: hostLostWords(hostLost.host), failed: true, failure };

      if (launchStopped !== undefined) {
        const words = launchStoppedWords(
          launchStopped.step,
          launchStopped.runtime,
          launchStopped.unstarted,
        );

        const { unstarted } = launchStopped;

        return { words, failed: true, failure, ...(unstarted !== undefined && { unstarted }) };
      }

      const words =
        failure === undefined ? undefined : agentFailureWords(failure, starter, continuable);

      return {
        words: `Failed: ${words ?? "the run ended without saying why"}`,
        failed: true,
        failure,
      };
    }

    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
    case AGENT_STATUS.COMPLETED:
      return undefined;
  }
}

/** The harness a usage limit's notice names, by the provider of the agent's model: Codex for OpenAI's, Claude for any other. */
export function usageLimitAgentOf(provider: ModelProvider | undefined): UsageLimitNotice["agent"] {
  return provider === MODEL_PROVIDER.OPENAI ? USAGE_LIMIT_AGENT.CODEX : USAGE_LIMIT_AGENT.CLAUDE;
}

/** Whether a refusal a note keeps is the plan's usage limit's (`AGENT_PLAN_LIMIT_REACHED`). */
export function refusedAtLimit(cause: unknown): boolean {
  return (
    Predicate.hasProperty(cause, "failure") &&
    cause.failure === AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED
  );
}

/** What mends a failed turn from its end line: the API keys' page for a key refused; nothing else there is the developer's to mend. */
export function endLineReason(failure: AgentFailure | undefined, starter?: string): FailureReason {
  // A teammate's key is theirs to mend, so the reader is offered no Settings of their own.
  return failure === AGENT_FAILURE.PROVIDER_KEY && starter === undefined
    ? FAILURE_REASON.API_KEY
    : FAILURE_REASON.OTHER;
}

/**
 * Whether the agent's tab offers Stop: only while a turn of its runs that a
 * Stop can cancel (`turnUnderWay`). Note that we offer none while the agent
 * starts or its line awaits a runner to take it, as while its machine is set
 * up, because the service has no turn to cancel there yet and a press would
 * only be answered that nothing was stopped.
 */
export function offersStop(agent: Pick<AgentSummary, "status" | "stoppable">): boolean {
  return turnUnderWay(agent);
}

/** Whether a turn of the agent's runs that a message steers, rather than one it opens: it runs, and its service has not said its turn is stopped or not open yet (`stoppable`). */
export function turnUnderWay(agent: Pick<AgentSummary, "status" | "stoppable">): boolean {
  return agent.status === AGENT_STATUS.RUNNING && agent.stoppable !== false;
}

/** Why a Start cannot run where no task is open, which no draft is drawn without. */
export const START_NEEDS_TASK = "Open a task to start an agent";

/** What a message no answer came back for says while the app does not reach the service, in place of `NOT_HEARD_BACK`: in the composer, whose Retry stands again once the app does (`RetryOffered`), and alone where only the words are drawn, as an Inbox answer's are. */
export const UNHEARD_OFFLINE = {
  BESIDE_RETRY: "You're offline.",
  ALONE: "You're offline. Try again once you're back online.",
} as const;

/** What the agent's own box says once a message closed it on an ended agent, beside the press that continues it in a new one (`ContinueAgent`), which says the rest. */
const BOX_RETIRED = "This agent has ended.";

/** What the press that starts a new agent on another's whole transcript says. */
export const CONTINUE_LABEL = "Continue in new agent";

/** What that press says once another agent continued the agent, in the same place on the failed end line. */
export const CONTINUE_AGAIN_LABEL = "Continue again";

/** What the press that sends a failed agent a line again says, on the failed end line where a message carries it on (`endLineOffersTryAgain`). */
export const TRY_AGAIN_LABEL = "Try again";

/** What Try again says while the service sends again. */
export const TRYING_AGAIN_LABEL = "Sending again";

/** What the line naming the agents that continued another says before their chips. */
export const CONTINUED_IN = "Continued in";

/**
 * The agents of the task that continue `agentId`: each started from it on
 * its whole transcript, naming no message, archived ones among them, in the
 * order started. Note that a fork names the message it was cut at, so it
 * continues nothing.
 */
function continuationsOf(
  agentId: string,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly AgentSummary[] {
  return [...(agents ?? []), ...(archived ?? [])]
    .filter((each) => each.from?.agentId === agentId && each.from.messageId === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The ids of the agents that continue `agent`, oldest first: those the
 * service names on its summary (`continuedBy`), so a page that lists the
 * agent alone still names them, then any the task's agents name that the
 * summary does not yet (`continuationsOf`), as one just started. Note that
 * a service older than `continuedBy` leaves the key out, which reads the
 * list alone, and that a fork is never a continuation.
 */
export function continuedByIds(
  agent: AgentSummary,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly string[] {
  const named = (agent.continuedBy ?? [])
    .filter((each) => !each.forked && each.messageId === undefined)
    .map((each) => each.agentId);

  const listed = continuationsOf(agent.id, agents, archived).map((each) => each.id);

  return [...new Set([...named, ...listed])];
}

/** The titles the summary gives the agents that continue it, by id, for a page whose list does not hold them; none for one with no title yet. */
export function continuedByTitles(agent: AgentSummary): ReadonlyMap<string, string> {
  const titled = (agent.continuedBy ?? []).flatMap((each) =>
    each.title === null ? [] : [[each.agentId, each.title] as const],
  );

  return new Map(titled);
}

/** Whether a turn's end line is where an agent may be continued: it failed, and not on a refused API key, which a new agent would meet the same. */
function endLineContinues(status: AgentStatus, endReason: FailureReason): boolean {
  return status === AGENT_STATUS.FAILED && endReason !== FAILURE_REASON.API_KEY;
}

/**
 * Whether the end line's row ends on Continue, after its words: where the
 * line continues the agent (`endLineContinues`), as Continue in new agent,
 * and once another agent continued it as Continue again, in the same place,
 * since the continued note that takes the box offers none. Before then, it
 * offers the press only where a new agent is the one way on: a failure only
 * one mends (`mendedByNewAgent`). Every other failure leaves the box open
 * and the agent taking messages, so a message carries it on, as a coding
 * CLI's error leaves its session for the next prompt. A box closed on an
 * ended agent offers the press itself, carrying its words, so the line
 * offers none and one Continue stands on screen.
 */
export function endLineOffersContinue(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;

  if (input.continued) return true;

  return !input.boxClosed && mendedByNewAgent(input.failure);
}

/**
 * The failures a message sent again would only meet again, since what mends
 * them is a choice the line's words name: a teammate's key, which only they
 * replace, Fast, which a model chosen with it off mends, or the model's
 * refusal, which a continue on another model mends (`endLineOffersOtherModel`).
 */
const MENDED_BY_CHOICE: ReadonlySet<AgentFailure> = new Set([
  AGENT_FAILURE.PROVIDER_KEY,
  AGENT_FAILURE.FAST_ON_OWN_KEY,
  AGENT_FAILURE.FAST_NOT_ENABLED,
  AGENT_FAILURE.REFUSAL,
]);

/**
 * Whether the failed end line's row ends on the offer to continue on another
 * model (`RefusalContinue`): where the model refused the turn, so a message
 * only meets the refusal again, and until another agent continued it, when
 * Continue again stands in its place (`endLineOffersContinue`).
 */
export function endLineOffersOtherModel(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;

  return !input.continued && !input.boxClosed && input.failure === AGENT_FAILURE.REFUSAL;
}

/**
 * Whether the failed end line's row ends on Try again, which sends the
 * agent again the lines its failed turn never took, as a launch that failed
 * before its runner read the prompt leaves it, or, where none was lost, a
 * line of the developer's own (`RETRY_LINE`), as the GitHub sign-in card's
 * Retry does: where a message carries the agent on, its box stands open to
 * send it, and nothing else ends the row. So never where Continue does
 * (`endLineOffersContinue`), on a key the reader mends in Settings, or on a
 * failure a choice mends (`MENDED_BY_CHOICE`).
 */
export function endLineOffersTryAgain(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;

  if (input.continued || input.boxClosed) return false;

  if (input.failure === undefined) return true;

  return !mendedByNewAgent(input.failure) && !MENDED_BY_CHOICE.has(input.failure);
}

/** What the toast says when a Start the developer left the task behind did not start; the task's own note says why. */
export const START_FAILED_AWAY = "The agent could not be started.";

/** What the toast says when the service took no Try again on a failed turn's end line, which then offers it again. */
export const RETRY_FAILED = "The message could not be sent again.";

/** What the toast says when the service did not rename an agent, whose old name is drawn again. */
export const RENAME_FAILED = "The agent could not be renamed. Try again.";

/** What the toast says when the service did not switch an agent's MCP servers, whose switches fall back. */
export const SERVERS_FAILED = "The agent's MCP servers could not be changed. Try again.";

/** What an agent's archive says once it landed, and what it says refused. */
const ARCHIVED_WORDS = {
  done: "Agent archived",
  refused: "The agent could not be archived. Try again.",
} as const;

/** What an agent's unarchive says once it landed, and what it says refused. */
const UNARCHIVED_WORDS = {
  done: "Agent unarchived",
  refused: "The agent could not be unarchived. Try again.",
} as const;

/** What the toast says once an agent's archive, or its undoing, landed or was refused, by which way it was asked. */
export function archiveWords(archived: boolean): {
  readonly done: string;
  readonly refused: string;
} {
  return archived ? ARCHIVED_WORDS : UNARCHIVED_WORDS;
}

/** What the toast says once `count` agents' archive, or its undoing, landed: one agent's words for one, else how many. */
export function archivedManyWords(count: number, archived: boolean): string {
  if (count === 1) return archiveWords(archived).done;

  return `${countWords(count, TERM.AGENT)} ${archived ? "archived" : "unarchived"}`;
}

/** A model nothing pays for, as a failure whose press connects its provider at its harness's row. */
export interface ConnectFailure {
  readonly reason: typeof FAILURE_REASON.CONNECT_AGENTS;
  readonly text: string;
  readonly provider: ModelProvider;
}

/** What would run a provider's models, as the connect note names it: the harness's plan or the provider's API key. */
const CONNECT_CREDENTIALS = {
  [MODEL_PROVIDER.ANTHROPIC]: "a Claude plan or an Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "a Codex plan or an OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

/**
 * The press a model menu's row holds for a model whose provider no
 * plan or API key of the account's pays for: "Connect Claude" at
 * the row's end (`remedyLabel`), landing on its harness's row in Settings ›
 * Agents (`useRepositoryRemedy`); none for a model something pays for.
 */
export function modelConnectFailure(model: CatalogModel): ConnectFailure | undefined {
  if (model.credentialMissing !== true) return undefined;

  return {
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: `${modelLabel(model.id, [model])} cannot run until you connect ${CONNECT_CREDENTIALS[model.provider]}.`,
    provider: model.provider,
  };
}

/** What a model's row says at its end where nothing pays for it: the press that connects its harness, which its pick is. */
export function modelConnectWords(model: CatalogModel): string | undefined {
  const connect = modelConnectFailure(model);

  return connect === undefined ? undefined : remedyLabel(connect);
}

/**
 * Why a choice cannot run, and the press that connects what would run it:
 * the note a model menu and Settings' Model row stand under the choice
 * where no plan or API key of the account's pays for its model, as
 * an account finds the Claude default it stored once its Claude credential
 * is gone; none for a choice something pays for, or one the catalog no
 * longer lists.
 */
export function unrunnableChoice(
  models: readonly CatalogModel[],
  choice: ModelChoice,
): ConnectFailure | undefined {
  const { base } = readModelChoice(models, choice.model);
  const model = models.find((each) => each.id === base);

  return model === undefined ? undefined : modelConnectFailure(model);
}

/** What a Start refused by the plan that would pay says, to its own member, beside the press that opens Settings. */
const START_PLAN_REFUSAL = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]: "Your plan is signed out. Connect it again.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key.",
} as const;

/** The same refusals where no press beside them opens Settings, so the words name it. */
const START_PLAN_REFUSAL_ALONE = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]:
    "Your plan is signed out. Connect it again in Settings to start an agent.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key in Settings to start one.",
} as const;

/** What an unreadable API key says beside the press that opens Settings. */
const KEY_UNREADABLE_NOTE = "Your saved API key can't be read. Save it again.";

/**
 * The note of a refusal Settings › Agents mends, whose press opens it: a
 * missing credential, an API key saved but unreadable, and, on a Start,
 * whose caller is the plan's own member, a plan signed out or ineligible.
 * None else; Retry alone answers every other.
 */
function settingsFailure(
  refused: RefusedCall,
  action: (typeof ACTION)[keyof typeof ACTION],
): Failure | undefined {
  switch (refused.failure) {
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingFailure(refused, action);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return { reason: FAILURE_REASON.CONNECT_AGENTS, text: KEY_UNREADABLE_NOTE };
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return action === ACTION.START
        ? { reason: FAILURE_REASON.CONNECT_AGENTS, text: START_PLAN_REFUSAL[refused.failure] }
        : undefined;
    default:
      return undefined;
  }
}

/** A missing credential's note, whose press opens Settings › Agents at the harness's row. */
function credentialMissingFailure(
  refused: RefusedCall,
  action: (typeof ACTION)[keyof typeof ACTION],
): Failure {
  return {
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: credentialMissingWords(refused.provider, action),
    provider: refused.provider,
  };
}

/**
 * The plan that pays for an agent on a provider's own harness, which only
 * its plan runs (`agent-runtime-choice.ts`); none for an agent on the
 * retired runtime, which a key paid for.
 */
/** Who pays for the agent: the page's payer, then the settled turns', then the plan its harness runs on where neither names one. */
export function paidByOf(
  payer: AgentPayer | undefined,
  usage: AgentUsage | undefined,
  runtime: AgentRuntime | undefined,
): AgentPayer | undefined {
  return payer ?? usage?.payer ?? planPayerOf(runtime);
}

export function planPayerOf(runtime: AgentRuntime | undefined): AgentPayer | undefined {
  if (runtime === AGENT_RUNTIME.CLAUDE_CODE) return AGENT_PAYER.CLAUDE_SUBSCRIPTION;

  if (runtime === AGENT_RUNTIME.CODEX) return AGENT_PAYER.CHATGPT_SUBSCRIPTION;

  return undefined;
}

/** What a message refused by the Claude plan that pays for its agent says. */
const CLAUDE_PLAN_REFUSAL = {
  SIGNED_OUT: "Signed out of Claude. Connect your Claude plan again in Settings.",
} as const;

/** The plan's reached limit said with when it resets, in place of waiting for a reset no one named. */
function limitResetsWords(resetsAt: number): string {
  return `${LIMIT_REACHED_WORDS} · Resets ${dayAndTimeText(resetsAt)}`;
}

/**
 * The words of a refusal by the plan that pays for the agent, by its plan
 * where the words say which, and with when a reached limit resets where
 * the provider said; none for any other refusal. The agent waits on its
 * plan, never turning to another payer.
 */
function planRefusalWords(refused: RefusedCall, payer: AgentPayer | undefined): string | undefined {
  if (refused.failure === AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED) {
    return refused.resetsAt === undefined ? undefined : limitResetsWords(refused.resetsAt);
  }

  if (
    refused.failure === AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT &&
    payer === AGENT_PAYER.CLAUDE_SUBSCRIPTION
  ) {
    return CLAUDE_PLAN_REFUSAL.SIGNED_OUT;
  }

  return undefined;
}

/** What a Start that did not start says beside the button, and what mends it, naming the task's device where it refused and the panel knows it. */
export function startFailureNote(
  refused: RefusedCall,
  taskId: string | null,
  device?: RefusingDevice,
): Failure {
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return unreachedFailure(refused.unreached, taskId);
  }

  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    return callFailure(
      localAgentRefusalWords(refused.localAgentRefusal, refused.refusedDevice ?? device),
    );
  }

  return (
    settingsFailure(refused, ACTION.START) ??
    callFailure(planRefusalWords(refused, undefined) ?? startFailureWords(refused.failure))
  );
}

/**
 * What a Continue in new agent that did not start says beside its own press,
 * which offers no remedy, so a refusal Settings › Agents mends names Settings.
 */
export function continueFailureNote(refused: RefusedCall, taskId: string | null): Failure {
  const note = startFailureNote(refused, taskId);

  switch (refused.failure) {
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return { ...note, text: keyUnreadableWords(ACTION.START) };
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return { ...note, text: START_PLAN_REFUSAL_ALONE[refused.failure] };
    default:
      return note;
  }
}

/** A refused call's words, which trying again mends. */
function callFailure(text: string): Failure {
  return { reason: FAILURE_REASON.OTHER, text };
}

/**
 * A repository out of reach, said by why with the repository named, and
 * the press that mends it: GitHub connected, or connected again, in
 * Settings; the repository given to our GitHub App; another repository
 * chosen; the task moved to the workspace whose GitHub reaches it; or the
 * member's own token replaced in Settings › Profile, or authorized on
 * GitHub for the organization's SAML SSO. A service that said nothing more
 * says the bare sentence, which Retry answers, and so does an agent with no
 * task wherever the remedy is pressed on the task: only giving the
 * repository to our GitHub App, and a token's remedies, are not.
 */
function unreachedFailure(
  unreached: RepositoryUnreached | undefined,
  taskId: string | null,
): Failure {
  if (unreached?.reason === REPOSITORY_UNREACHED.NOT_SELECTED) {
    return {
      reason: FAILURE_REASON.ADD_REPOSITORY,
      text: `${PRODUCT_NAME}'s GitHub App doesn't have access to ${unreached.repository}.`,
      repository: unreached.repository,
      settingsUrl: unreached.settingsUrl,
    };
  }

  // A token's remedy is the member's own, in Settings or on GitHub, so it needs no task.
  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_INVALID) {
    return { reason: FAILURE_REASON.GITHUB_TOKEN, text: "Your GitHub token was refused." };
  }

  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_SSO) {
    const [organization = unreached.repository] = unreached.repository.split("/");

    return {
      reason: FAILURE_REASON.AUTHORIZE_TOKEN,
      text: `Your GitHub token isn't authorized for ${organization}'s SAML SSO.`,
      organization,
      authorizeUrl: unreached.authorizeUrl,
    };
  }

  // The member's token is theirs to replace in Settings, so each of its cases carries that remedy and needs no task. NO_TOKEN is a saved token the deployment cannot open; a member with none saved never reaches it.
  if (unreached?.reason === REPOSITORY_UNREACHED.NO_TOKEN) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: "Your saved GitHub token could not be opened.",
    };
  }

  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_NO_ACCESS) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: `Your GitHub token cannot access ${unreached.repository}. Check the repository still exists under that name, or ask its owner to give your GitHub account access.`,
    };
  }

  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: `Your GitHub token cannot push to ${unreached.repository}. Ask its owner to give your GitHub account write access.`,
    };
  }

  if (unreached === undefined || taskId === null) {
    return callFailure(SHARED_FAILURE_NOTE[AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]);
  }

  const { repository } = unreached;

  switch (unreached.reason) {
    case REPOSITORY_UNREACHED.NOT_CONNECTED:
      return {
        reason: FAILURE_REASON.CONNECT_GITHUB,
        text: `This workspace isn't connected to GitHub, so ${PRODUCT_NAME} cannot reach ${repository}.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.CONNECTION_LAPSED:
      return {
        reason: FAILURE_REASON.RECONNECT_GITHUB,
        text: `This workspace's GitHub connection was removed or suspended, so ${PRODUCT_NAME} cannot reach ${repository}.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.OTHER_OWNER:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text:
          unreached.connectedTo === undefined
            ? `${repository} isn't under the GitHub account this workspace is connected to.`
            : `${repository} isn't under ${unreached.connectedTo}, the GitHub account this workspace is connected to.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.GONE:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text: `${repository} was renamed, transferred, or deleted on GitHub.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.OTHER_WORKSPACE:
      return {
        reason: FAILURE_REASON.MOVE_TASK,
        text: `${repository} is connected to ${unreached.workspace.name}, not this workspace.`,
        taskId: taskId,
        workspace: unreached.workspace,
      };
  }
}

/** What a teammate's agent says to a message its starter's own key refused: theirs to save in their Settings, which the reader's mend nothing of. */
function starterKeyWords(failure: AgentCallFailure, starter: string): string | undefined {
  if (failure === AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE) {
    return `${starter}'s saved API key can't be read. They save it again in Settings to unblock this agent.`;
  }

  if (failure === AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING) {
    return `${starter} has no plan or API key connected for this agent. They connect one in Settings to unblock it.`;
  }

  return undefined;
}

/**
 * What a message that did not reach the agent says under the composer, and
 * what mends it, on a task or, for an agent with none, where the remedy needs
 * no task. A teammate's agent (`starter`, `teammateStarter`) runs on its
 * starter's credentials, so a refusal of theirs names them and offers the
 * reader no Settings of their own.
 */
export function messageFailureNote(
  refused: RefusedCall,
  taskId: string | null,
  payer?: AgentPayer | undefined,
  starter?: string | undefined,
): Failure {
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return unreachedFailure(refused.unreached, taskId);
  }

  // Note that the box's note stands beside Continue in new agent, so it tells no one to continue.
  if (refused.failure === AGENT_CALL_FAILURE.AGENT_RETIRED) return callFailure(BOX_RETIRED);

  if (refused.failure === AGENT_CALL_FAILURE.DEVICE_REMOVED) return callFailure(HOST_REMOVED);

  // Note that a device that refuses a message for another reason says it in the words it refuses a Start in.
  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    const refusal = refused.localAgentRefusal ?? LOCAL_AGENT_REFUSAL.MAC_AWAY;

    return refusal === LOCAL_AGENT_REFUSAL.MAC_AWAY
      ? { reason: FAILURE_REASON.CONTINUE_IN_CLOUD, text: deviceAwayWords(refused.refusedDevice) }
      : callFailure(localAgentRefusalWords(refusal, refused.refusedDevice));
  }

  const theirs = starter === undefined ? undefined : starterKeyWords(refused.failure, starter);

  if (theirs !== undefined) return callFailure(theirs);

  return (
    settingsFailure(refused, ACTION.MESSAGE) ??
    callFailure(planRefusalWords(refused, payer) ?? messageNoteWords(refused.failure))
  );
}

/**
 * A composer's note as it reads while the app does not reach the service:
 * one for a message no answer came back for says the developer is offline,
 * its words still in the box, and its Retry stands again once the app
 * reaches the service; any other note, or any note while connected, as it is.
 */
export function noteWhileOffline<Note extends Failure & { readonly cause?: unknown }>(
  note: Note | undefined,
  connected: boolean,
): Note | undefined {
  if (connected || note === undefined) return note;
  const { cause } = note;

  const unheard =
    Predicate.hasProperty(cause, "failure") && cause.failure === AGENT_CALL_FAILURE.UNANSWERED;

  return unheard ? { ...note, text: UNHEARD_OFFLINE.BESIDE_RETRY } : note;
}

/** What a message that did not reach the agent says beside the composer's Retry, which says to try again for it. */
function messageNoteWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
      return MESSAGE_NOT_SENT;
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.UNANSWERED:
      return NOT_HEARD_BACK;
    default:
      return messageFailureWords(failure);
  }
}

/** Whether a refusal is for good, so the composer closes on it rather than offering Retry: the agent's session has ended, or the host it ran on was removed. */
export function closesComposer(failure: AgentCallFailure): boolean {
  return (
    failure === AGENT_CALL_FAILURE.AGENT_RETIRED || failure === AGENT_CALL_FAILURE.DEVICE_REMOVED
  );
}

/**
 * A model, and an agent, as a tab or a menu names it, shared with the main
 * process's notifications so neither is ever named two ways
 * (`@repo/features/model-label`).
 */
export { agentName, modelLabel, providerOf };

/** The first run of digits and points in a model's own name, which is its version: `claude-opus-5.5` is 5.5, `gpt-6-astra` is 6. */
const MODEL_VERSION = /\d+(?:\.\d+)*/u;

/** A word of a model's own name that is its version whole: `5.5` in `claude-opus-5.5`. */
const VERSION_WORD = /^\d+(?:\.\d+)*$/u;

/** What separates the words of a model's own name. */
const NAME_WORD_SEPARATOR = "-";

/** A model's own name, past its provider: `claude-opus-5.5` of `anthropic/claude-opus-5.5`. */
function ownName(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);

  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

/** The version's numbers, most significant first; none for a name that carries no version. */
function modelVersion(modelId: string): number[] {
  const found = MODEL_VERSION.exec(ownName(modelId))?.[0];

  return found === undefined ? [] : found.split(".").map(Number);
}

/** Which of two versions is the newer: positive where `a` is, with a missing part counted as 0, so 5.1 is newer than 5. */
function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let part = 0; part < Math.max(a.length, b.length); part += 1) {
    const difference = (a[part] ?? 0) - (b[part] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
}

/** The providers in the order the menu groups them. */
const PROVIDER_ORDER: readonly string[] = Object.values(MODEL_PROVIDER);

/**
 * The model families the menus lead with, in the order they list them,
 * Anthropic's and then OpenAI's: the newest of each is listed before
 * anything is searched, and every other version only once something is. A
 * new version needs nothing here; a new family is one word.
 */
const LEAD_FAMILIES: readonly string[] = [
  "opus",
  "fable",
  "sonnet",
  "haiku",
  "astra",
  "sol",
  "luna",
  "terra",
];

/**
 * Where a model's family stands in `LEAD_FAMILIES`: the last word of its
 * own name, its version and any speed's suffix aside, so `claude-opus-5.5` is
 * Opus and `gpt-6-astra` Astra, while `gpt-6-astra-mini` is no lead family's
 * and stands after them all.
 */
function familyRank(modelId: string): number {
  const name = ownName(baseIdOf(modelId) ?? modelId);
  const words = name.split(NAME_WORD_SEPARATOR).filter((word) => !VERSION_WORD.test(word));
  const rank = LEAD_FAMILIES.indexOf(words.at(-1) ?? "");

  return rank === -1 ? LEAD_FAMILIES.length : rank;
}

/**
 * The models as the menus list them: grouped by provider, Anthropic's first,
 * within each by family in `LEAD_FAMILIES`' order and the rest after, and
 * within a family the newest version first, so a catalog that lists forty
 * models leads with the ones worth starting on. The catalog carries no
 * release date, so the version in the id stands for one; models of one
 * version keep the catalog's own order between them.
 */
function orderedModels(models: readonly CatalogModel[]): readonly CatalogModel[] {
  return models
    .map((model, index) => ({
      model,
      index,
      family: familyRank(model.id),
      version: modelVersion(model.id),
    }))
    .sort(
      (a, b) =>
        PROVIDER_ORDER.indexOf(a.model.provider) - PROVIDER_ORDER.indexOf(b.model.provider) ||
        a.family - b.family ||
        compareVersions(b.version, a.version) ||
        a.index - b.index,
    )
    .map((each) => each.model);
}

/** What the model menu and Settings say where the catalog could not be read. */
export const MODELS_READ_FAILED = readFailedWords("the models");

/** What the Fast row says where the service withholds the model's fast version because Anthropic never granted the organization of the key the account's agents run on fast mode. */
const FAST_NOT_ENABLED_NOTE = "Fast isn't enabled for this key's Anthropic organization";

/** Where an organization asks Anthropic for fast mode, which it grants organization by organization. */
export const FAST_ACCESS_URL = "https://claude.com/fast-mode";

/** What separates the words of a choice: "Opus 5.5 High Fast", the model's name and then its detail. */
const CHOICE_WORD_SEPARATOR = " ";

/** A model as the menus offer it: the base model, and its fast and Ultrafast versions where the catalog lists each beside it. */
export interface OfferedModel {
  readonly model: CatalogModel;
  readonly fast: CatalogModel | undefined;
  readonly ultrafast: CatalogModel | undefined;
}

/** The id a fast or Ultrafast version's id is a version of, or nothing for an id without a speed's suffix. */
function baseIdOf(id: string): string | undefined {
  return modelSpeedOf(id) === MODEL_SPEED.STANDARD ? undefined : standardModelIdOf(id);
}

/**
 * The catalog folded to its base models, each with its fast and Ultrafast
 * versions, in the menus' order. The signal is the id: a model whose id is
 * another offered model's with a speed's suffix is that model's version at
 * that speed, and is not listed on its own. Neither the name's "(Fast)" nor
 * the catalog's `fast` tag would do: the tag sits on the base and the fast
 * version alike, the wire carries no tags in any case, and a name is
 * display text. A suffixed id with no base beside it is a model of its own.
 */
export function offeredModels(models: readonly CatalogModel[]): readonly OfferedModel[] {
  const ids = new Set(models.map((model) => model.id));
  const versionsOf = new Map<string, Map<ModelSpeed, CatalogModel>>();

  for (const model of models) {
    const base = baseIdOf(model.id);

    if (base === undefined || !ids.has(base)) continue;
    const versions = versionsOf.get(base) ?? new Map<ModelSpeed, CatalogModel>();
    versions.set(modelSpeedOf(model.id), model);
    versionsOf.set(base, versions);
  }

  return orderedModels(models)
    .filter((model) => !isSpeedVersion(model.id, ids))
    .map((model) => ({
      model,
      fast: versionsOf.get(model.id)?.get(MODEL_SPEED.FAST),
      ultrafast: versionsOf.get(model.id)?.get(MODEL_SPEED.ULTRAFAST),
    }));
}

/**
 * The base models a menu lists before anything is searched: the newest of
 * each lead family the catalog offers, and the one chosen, which stays on
 * screen however old; every model where the catalog offers no lead family,
 * so the list is never empty for want of a search.
 */
export function unsearchedModels(
  models: readonly CatalogModel[],
  chosen: string | undefined,
): ReadonlySet<string> {
  const offered = offeredModels(models).map((each) => each.model.id);
  const leads = new Map<number, string>();

  for (const id of offered) {
    const family = familyRank(id);

    if (family < LEAD_FAMILIES.length && !leads.has(family)) leads.set(family, id);
  }

  if (leads.size === 0) return new Set(offered);

  return new Set([...leads.values(), ...(chosen === undefined ? [] : [chosen])]);
}

/** Why the Fast row rests for the base model chosen, or nothing where its fast version is offered: withheld because the key's organization was never granted fast mode, or none listed. */
export function fastRestingNote(
  baseId: string,
  offered: OfferedModel | undefined,
  models: readonly CatalogModel[],
): string | undefined {
  if (offered?.fast !== undefined) return undefined;

  if (offered?.model.fastNotEnabled === true) return FAST_NOT_ENABLED_NOTE;

  return `No fast version of ${modelLabel(baseId, models)}`;
}

/** Whether the id is the fast or Ultrafast version of a model the catalog offers. */
function isSpeedVersion(id: string, ids: ReadonlySet<string>): boolean {
  const base = baseIdOf(id);

  return base !== undefined && ids.has(base);
}

/** The model's version at the speed given, where the catalog lists one beside it: the base itself at standard speed. */
function versionAt(offered: OfferedModel, speed: ModelSpeed): CatalogModel | undefined {
  if (speed === MODEL_SPEED.FAST) return offered.fast;

  if (speed === MODEL_SPEED.ULTRAFAST) return offered.ultrafast;

  return offered.model;
}

/** The speeds a model offers, slowest first: standard, and fast and Ultrafast where the catalog lists each. */
export function speedsOf(offered: OfferedModel): readonly ModelSpeed[] {
  return Object.values(MODEL_SPEED).filter((speed) => versionAt(offered, speed) !== undefined);
}

/** A stored id as the menus draw it: the base model's id, and the speed it named. */
export interface ModelChoiceRead {
  readonly base: string;
  readonly speed: ModelSpeed;
}

export function readModelChoice(models: readonly CatalogModel[], modelId: string): ModelChoiceRead {
  const offered = offeredModels(models).find(
    (each) =>
      each.model.id === modelId || each.fast?.id === modelId || each.ultrafast?.id === modelId,
  );

  if (offered === undefined) return { base: modelId, speed: MODEL_SPEED.STANDARD };
  const speed = modelId === offered.model.id ? MODEL_SPEED.STANDARD : modelSpeedOf(modelId);

  return { base: offered.model.id, speed };
}

/** The catalog id a base and a speed name: the version at that speed where the model has one, else the base's, at standard speed. */
export function choiceModelId(offered: OfferedModel, speed: ModelSpeed): string {
  return (versionAt(offered, speed) ?? offered.model).id;
}

/**
 * What a choice says after its model's name: the effort, Fast or Ultrafast
 * where that version is on, and the standard window's size where it runs on that,
 * so the model's whole window, which every choice runs on unless it says,
 * says nothing.
 */
function choiceDetail(effort: string, speed: ModelSpeed, standardTokens?: number): string {
  const words = [effortLabel(effort)];

  if (speed !== MODEL_SPEED.STANDARD) words.push(SPEED_WORD[speed]);

  if (standardTokens !== undefined) words.push(windowLabel(standardTokens));

  return words.join(CHOICE_WORD_SEPARATOR);
}

/** The word the menu's pinned row and the settings row say for the context window. */
export const CONTEXT_WORD = "Context";

/** The steps a window's size is cut down to before it is said: a thousand below a million, a tenth of a million from it. */
const WINDOW_CUT = { THOUSAND: 1_000, TENTH_OF_A_MILLION: 100_000, MILLION: 1_000_000 } as const;

/** A window's size as a choice says it, cut to the thousand or the tenth of a million below, not rounded: 272K, 1M for 1,050,000. */
export function windowLabel(tokens: number): string {
  const step = tokens >= WINDOW_CUT.MILLION ? WINDOW_CUT.TENTH_OF_A_MILLION : WINDOW_CUT.THOUSAND;

  return formatCompact(Math.floor(tokens / step) * step);
}

/** A choice as a request carries it: the model, the effort, and the window only where it is the standard one. */
export function choiceRequest(choice: ModelChoice): ModelChoice {
  return choice.contextWindow === CONTEXT_WINDOW.STANDARD
    ? { model: choice.model, effort: choice.effort, contextWindow: CONTEXT_WINDOW.STANDARD }
    : { model: choice.model, effort: choice.effort };
}

/** A price multiple as a note says it: 2×, 1.5×, to the hundredth. */
function factorLabel(factor: number): string {
  return `${Number(factor.toFixed(2))}×`;
}

/**
 * What the long window costs, as the catalog prices it, said of the long
 * window by name since only a prompt on it can grow past the standard one:
 * the multiple of the standard price a prompt past the standard window is
 * billed at, input and output each where the catalog says, else that it
 * costs more.
 */
export function longWindowNote(windows: ContextWindows): string {
  const past = `On ${windowLabel(windows.longTokens)}, prompts over ${windowLabel(windows.standardTokens)} tokens cost`;
  const parts: string[] = [];

  if (windows.longInputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longInputPriceFactor)} for input`);

  if (windows.longOutputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longOutputPriceFactor)} for output`);

  return parts.length === 0 ? `${past} more.` : `${past} ${andList(parts)}.`;
}

/** A choice as the words it is drawn in: the base model's name, and the detail drawn dimmed after it. */
export interface ChoiceWords {
  readonly model: string;
  readonly detail: string;
}

export function choiceWords(choice: ModelChoice, models: readonly CatalogModel[]): ChoiceWords {
  const read = readModelChoice(models, choice.model);

  const standard =
    windowOf(models, choice) === CONTEXT_WINDOW.STANDARD
      ? contextWindowsOf(models, choice.model)?.standardTokens
      : undefined;

  return {
    model: modelLabel(read.base, models),
    detail: choiceDetail(choice.effort, read.speed, standard),
  };
}

/** A choice as one line, for a hint that holds no markup: "Opus 5.5 High Fast", "GPT-5.5 High 272K". */
export function choiceLabel(choice: ModelChoice, models: readonly CatalogModel[]): string {
  const words = choiceWords(choice, models);

  return `${words.model}${CHOICE_WORD_SEPARATOR}${words.detail}`;
}

/** Where a worker stands as a page of its transcript read it: its status, and when the run under way began where the service said. */
export type AgentRun = Pick<AgentSummary, "status" | "runStartedAt">;

/** What an agent is doing while it may still write, as its newest turn's record says it and its working line words it. */
export const WORKING_PHASE = {
  /** It is being taken back to an earlier line (`rewind-action.tsx`), and stopped first where it ran. */
  REWINDING: "rewinding",
  /**
   * No runner has opened its newest turn yet: its first is still to be
   * queued, the line that opens the next is on its way, or the turn is
   * queued while a runner or a host's launch gets to it. Note that the steps
   * of that wait are never worded, only traced on the service
   * (`web/claimRunnerLease`, `web/runnerLaunchPrepared`, a host's `lineStep`).
   */
  STARTING: "starting",
  /** Its newest turn runs. */
  WORKING: "working",
  /** A Stop was asked of its newest turn, which runs until its runner ends it. */
  STOPPING: "stopping",
  /** Its newest turn is held open until a usage limit resets, its starter's every subscription at one and no API key to pay, and runs again then (`AgentTurn`'s `waitsUntil`). */
  WAITING: "waiting",
} as const;

export type WorkingPhase = (typeof WORKING_PHASE)[keyof typeof WORKING_PHASE];

/** What the working line says in each phase. */
const WORKING_PHASE_WORDS = {
  [WORKING_PHASE.REWINDING]: "Rewinding…",
  [WORKING_PHASE.STARTING]: "Starting…",
  [WORKING_PHASE.WORKING]: "Working…",
  [WORKING_PHASE.STOPPING]: "Stopping…",
  [WORKING_PHASE.WAITING]: "Waiting for your usage limit to reset…",
} as const satisfies Record<WorkingPhase, string>;

/** What the working line says in a phase, a wait naming when the limit it waits on resets, as of `now`: "3:40 PM" today. */
export function workingLineWords(
  phase: WorkingPhase,
  waitsUntil?: number,
  now: number = Date.now(),
): string {
  if (phase !== WORKING_PHASE.WAITING || waitsUntil === undefined)
    return WORKING_PHASE_WORDS[phase];

  return `Waiting for your usage limit to reset at ${dueText(waitsUntil, now)}`;
}

/** What a tab reads its agent standing by (`tabTurnOf`). */
export interface TabTurn {
  /** The turn whose status the tab draws, where one has been queued. */
  readonly turnId: string | undefined;
  /** Whether the working line stands: the turn is open, a line sent has not been answered, or a rewind is out. */
  readonly working: boolean;
  /** What the working line says the agent is doing. */
  readonly phase: WorkingPhase;
  /** When the usage limit its open turn waits on resets; none where it waits on none. */
  readonly waitsUntil: number | undefined;
  /** Where the agent stands by that turn, which the end row is drawn from once it no longer works. */
  readonly status: AgentStatus;
  /** Why that turn failed, in the wire's word; none where it did not. */
  readonly failure: AgentFailure | undefined;
}

/** What of the composer a tab's standing is read from. */
export interface TabSends {
  /** The newest turn a send's answer named (`HeldComposer`'s `turn`). */
  readonly turn: AgentTurn | undefined;
  /** Whether a line sent has not been answered yet, which only its call's deadline bounds. */
  readonly unanswered: boolean;
  /** Whether a rewind is out, an edit's or a revert's, until its call answers. */
  readonly rewinding: boolean;
}

/**
 * Where an agent's tab reads it standing, from one record: its newest
 * turn's, the summary's, or the one a send's answer named where that is
 * newer, as the live list catches up with it (`newerTurn`), the summary's
 * where both name one turn. It works while that turn is open, which only
 * its row's deadlines end, and while a line sent or a rewind has not been
 * answered, which their calls' own deadlines end. How it ended, and why it
 * failed, are that turn's. With no turn it reads as its summary's status:
 * starting before its first, and, past the grace, failed as one that never
 * started. Note that nothing here reads the transcript, which says what the
 * turn wrote and never whether it runs.
 */
export function tabTurnOf(agent: Pick<AgentSummary, "status" | "turn">, sends: TabSends): TabTurn {
  const turn = newerTurn(agent.turn, sends.turn);
  const open = turn === undefined ? agentStillWriting(agent.status) : turnOpen(turn);

  const status =
    turn === undefined
      ? agent.status
      : turnAgentStatus({ status: turn.status, cancelRequested: turn.stopAsked === true });

  return {
    turnId: turn?.id,
    working: open || sends.unanswered || sends.rewinding,
    phase: workingPhaseOf(turn, open, sends.rewinding),
    waitsUntil: open ? turn?.waitsUntil : undefined,
    status,
    failure:
      turn === undefined
        ? status === AGENT_STATUS.FAILED
          ? AGENT_FAILURE.NOT_STARTED
          : undefined
        : turn.failure,
  };
}

/** What the working line says of the turn a tab reads: rewinding while a rewind is out, starting while no turn is open or it is still queued, waiting while it is held open for a limit's reset, then the open turn's state. */
function workingPhaseOf(
  turn: AgentTurn | undefined,
  open: boolean,
  rewinding: boolean,
): WorkingPhase {
  if (rewinding) return WORKING_PHASE.REWINDING;

  if (turn === undefined || !open) return WORKING_PHASE.STARTING;

  if (turn.stopAsked === true) return WORKING_PHASE.STOPPING;

  if (turn.waitsUntil !== undefined) return WORKING_PHASE.WAITING;

  return turn.status === TURN_STATUS.QUEUED ? WORKING_PHASE.STARTING : WORKING_PHASE.WORKING;
}

/** What the working line says of a worker, which has no turn record of its own: starting until its own session reads running. */
export function workerWorkingPhase(status: AgentStatus): WorkingPhase {
  return status === AGENT_STATUS.STARTING ? WORKING_PHASE.STARTING : WORKING_PHASE.WORKING;
}

/**
 * When the working line counts from, read off the lines themselves: the
 * press of the developer's line that opened the turn under way, or opens
 * the one on its way, and the turn's own start where no such line stands.
 * Note that the task list's run is not read, because a line sent does not
 * wake the list, which until then still holds the turn before it, ended
 * however long ago, and holds no start at all while the line awaits its
 * turn; none where the lines say nothing, as before a first turn.
 */
export function agentWorkingSince(lines: readonly AgentTranscriptMessage[]): number | undefined {
  // Note that the voice's lines on a call are no turn, so the journal is the agent's newest turn whatever the voice said after it.
  const at = lines.findLastIndex(isAgentTurn);
  const journal = lines[at];

  const opens = (line: AgentTranscriptMessage) =>
    line.role === MESSAGE_ROLE.USER && line.arrivedIn === undefined && line.sentAt !== undefined;

  // A closed journal, or none, is followed by the line that opens the next turn, where one was sent.
  if (journal === undefined || journal.finishedAt !== undefined) {
    return lines.slice(at + 1).find(opens)?.sentAt;
  }

  // An open journal was opened by the first line after the journal before it.
  const before = lines.slice(0, at).findLastIndex(isAgentTurn);

  return lines.slice(before + 1, at).find(opens)?.sentAt ?? journal.startedAt;
}

/**
 * How a worker's row marks where it stands, as its own session reads: still
 * running while it starts or works, at rest once it completed or was
 * stopped, whose own tab says which, and failed where it failed.
 */
export function workerToolState(status: AgentStatus): ToolState {
  switch (status) {
    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
      return TOOL_STATE.INPUT_AVAILABLE;
    case AGENT_STATUS.FAILED:
      return TOOL_STATE.OUTPUT_ERROR;
    case AGENT_STATUS.COMPLETED:
    case AGENT_STATUS.CANCELED:
      return TOOL_STATE.OUTPUT_AVAILABLE;
  }
}

/** Where a worker stands, read from its delegation's part: running until the call answers, then completed, or failed where the call ended in an error. */
export function workerStatusOf(state: ToolState): AgentStatus {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return AGENT_STATUS.COMPLETED;

  return state === TOOL_STATE.OUTPUT_ERROR ? AGENT_STATUS.FAILED : AGENT_STATUS.RUNNING;
}

/** How many words a reply's lead holds at most, where its first sentence runs on. */
const REPLY_LEAD_WORDS = 24;

/** A sentence's end: its stop, then a space or the end of the words. */
const SENTENCE_END = /[.!?](?=\s|$)/u;

/**
 * What a turn that finished replied, as a reader hears it: its newest
 * reply's last stretch of words, after the turn's last call, cut to its
 * first sentence, or to its first words where that runs on; the summary of
 * its `end_turn`, where it ended with one. Nothing where
 * there is no reply, or no words follow its last call, as a turn that ended
 * on a call.
 */
export function finishedReplyLead(
  messages: readonly AgentTranscriptMessage[],
): { readonly messageId: string; readonly lead: string } | undefined {
  const reply = messages.findLast(isAgentTurn);

  if (reply === undefined) return undefined;
  // Note that only words after the turn's last call are its reply, because words before it were the turn under way.
  const parts = agentParts(reply);
  const lastCall = parts.findLastIndex((part) => part.kind === AGENT_PART.TOOL);
  const last = parts.slice(lastCall + 1).findLast((part) => part.kind === AGENT_PART.TEXT);
  // Note that a turn ended with `end_turn` replied in its summary, whatever it wrote around the call.
  const said = endTurnSummary(parts) ?? (last?.kind === AGENT_PART.TEXT ? last.text : "");
  const words = plainWords(said);

  if (words === "") return undefined;
  const end = SENTENCE_END.exec(words);
  const sentence = end === null ? words : words.slice(0, end.index + 1);
  const cut = sentence.split(/\s+/u);

  const lead =
    cut.length <= REPLY_LEAD_WORDS ? sentence : `${cut.slice(0, REPLY_LEAD_WORDS).join(" ")}…`;

  return { messageId: reply.id, lead };
}

/**
 * The follow-ups of the newest turn, where it ended with an `end_turn` that
 * was taken: the turn's message, which ticks are kept against so a later
 * turn starts with none ticked, and what it offered; none where the newest
 * turn ended another way.
 */
export function lastTurnEnding(
  messages: readonly AgentTranscriptMessage[],
): { readonly messageId: string; readonly followUps: readonly string[] } | undefined {
  // Note that a line a turn took in under way may stand after its journal, and only a line no turn took waits on the next; the voice retelling the turn on a call waits on nothing.
  const last = messages.findLast(
    (message) => message.arrivedIn === undefined && !isVoiceLine(message),
  );

  if (last?.role !== MESSAGE_ROLE.ASSISTANT) return undefined;
  const ending = endTurnOf(agentParts(last));

  return ending === undefined ? undefined : { messageId: last.id, followUps: ending.followUps };
}

/** Where a line the developer sent stands, before the service's row for it lands. */
export const SENT_LINE_STATE = {
  /** On its way, or taken and its row not yet read. */
  PENDING: "pending",
  /** Refused for now: the box has words of its own, so the line keeps its words where it went, with Retry. */
  FAILED: "failed",
  /** Refused for good, its session ended: it stands where it went marked as not delivered, and no row will read it back. */
  UNDELIVERED: "undelivered",
} as const;

type SentLineState = (typeof SENT_LINE_STATE)[keyof typeof SENT_LINE_STATE];

/**
 * A line the developer sent that the transcript has not read back yet:
 * drawn as theirs the moment it goes, and let go once the service took it
 * and its own row for it landed.
 */
export interface SentLine {
  /**
   * The id the service writes the line's row under, its send key's
   * (`sentLineId`), which the line is drawn under until that row lands, so
   * the row is drawn in its place (`transcriptRowKey`).
   */
  readonly id: string;
  /** The key the line went under, which Retry sends it under again, so a send whose answer was lost reaches the agent once. */
  readonly clientKey: string;
  /** The words as they went: trimmed, as the service keeps them. */
  readonly text: string;
  /** The files that went with them, drawn on the line as the service's row will draw them. */
  readonly attachments: readonly AgentAttachment[];
  /** Whether a turn ran as the line went, so it steers that turn rather than opening one. */
  readonly steers: boolean;
  /** Epoch milliseconds the line was sent, drawn under it at once, as its row's own time will be. */
  readonly sentAt: number;
  readonly state: SentLineState;
  /** The developer's line it was written in place of, by its message id, which the agent is taken back to just before as it goes; none for a line sent after the rest. */
  readonly rewinds?: string | undefined;
  /** Whether the agent was already taken back to just before that line, which is gone, so the line's Retry only sends. */
  readonly rewound?: boolean | undefined;
  /** Whether the agent's files go back too as it is taken back before that line, to the snapshot its runner took before the line's turn. */
  readonly restoresFiles?: boolean | undefined;
  /** Whether the service answered that the agent took it; until it does, a row read back may still be withdrawn. */
  readonly taken?: boolean | undefined;
}

/** The ids the developer's rows of a transcript were written under, which a sent line's row is one of once it lands. */
function landedLines(messages: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.USER && message.clientId !== undefined
        ? [message.clientId]
        : [],
    ),
  );
}

/**
 * The sent lines the transcript has not read back yet. A line is read back
 * by the row written under its id, which its send key names, so two lines
 * of the same words are each read back by their own row alone; a line
 * refused for good has no row to be read back by.
 */
export function unreadSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);

  return sent.filter((line) => line.state === SENT_LINE_STATE.UNDELIVERED || !landed.has(line.id));
}

/** The sent lines whose row the transcript holds, written under the id their send key names. */
export function landedSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);

  return sent.filter((line) => landed.has(line.id));
}

/**
 * The sent lines the box still holds: all but those the service took whose
 * row has landed. Note that a line whose row was read back is held, undrawn,
 * until its answer comes, because the service writes the row before the agent
 * is handed the line and withdraws it where the agent did not take it, so a
 * refusal may follow the row; and a line refused is held until Retry sends
 * it again, since its row, still drawn as the refusal lands, is on its way out.
 */
export function heldSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);

  return sent.filter((line) => line.taken !== true || !landed.has(line.id));
}

/**
 * The key a transcript's row is drawn and measured under: the id a
 * developer's line was written under, which the line drew under before
 * its row landed, so the row lands in its place; every other row's own id.
 */
export function transcriptRowKey(message: AgentTranscriptMessage): string {
  return message.role === MESSAGE_ROLE.USER ? (message.clientId ?? message.id) : message.id;
}

/** A sent line as the tab draws it before the service's row lands: the developer's row. */
function sentLineMessage(line: SentLine): AgentTranscriptMessage {
  const files = line.attachments.map((file) => ({
    type: "file",
    mediaType: file.mediaType,
    filename: file.name,
    url: `data:${file.mediaType};base64,${file.data}`,
  }));

  return {
    id: line.id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: AGENT_PART.TEXT, text: line.text }, ...files],
    sentAt: line.sentAt,
  };
}

/** The transcript's rows, with the lines sent and not yet read back at its end, in the order they went. */
export function agentLines(
  messages: readonly AgentTranscriptMessage[],
  sent: readonly SentLine[],
): readonly AgentTranscriptMessage[] {
  return [...messages, ...sent.map(sentLineMessage)];
}

/** The characters a branch name may hold and still stand bare in a shell; anything else is quoted. */
const BARE_SHELL_WORD = /^[\w./-]+$/u;

/** A word as a POSIX shell takes it whole: bare where every character is plain, else in single quotes, with a quote inside closed, escaped, and reopened. */
function shellWord(word: string): string {
  return BARE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** The command that brings the agent's branch onto a developer's machine, as Copy checkout command puts it on the clipboard; the branch quoted where a shell would read into it. */
export function checkoutCommand(branch: string): string {
  const name = shellWord(branch);

  return `git fetch origin ${name} && git switch ${name}`;
}

/** What the agent's dock draws of a pull request: the parts its row reads, and its page. */
type DockedPullRequestParts = Pick<
  AgentPullRequest,
  "number" | "title" | "state" | "checks" | "additions" | "deletions" | "queued"
> & { readonly url: string };

/** A pull request the agent's dock draws, the branch it is from where known, and whether it is the one the agent stands on now, which its tab's read answered. */
export interface DockedPullRequest {
  readonly pullRequest: DockedPullRequestParts;
  readonly branch: string | null;
  readonly current: boolean;
}

/**
 * Every pull request the agent's dock draws: the one from the branch it
 * stands on, as its tab read it from GitHub, and every other one the task's
 * list names it as having opened (`lines`), each once by its page, those
 * still to be acted on first, then merged, then closed, the one it stands on
 * first within its rank; none before it opened one.
 */
export function dockedPullRequests(
  published: AgentPullRequestAnswer | undefined,
  lines: readonly TaskPullRequestLine[],
  agentId: string,
): readonly DockedPullRequest[] {
  const current = published?.pullRequest ?? null;

  const own: DockedPullRequest[] =
    current === null || published === undefined
      ? []
      : [{ pullRequest: current, branch: published.branch, current: true }];

  const others = lines.flatMap((line): DockedPullRequest[] => {
    const { url } = line;

    if (line.agentId !== agentId || url === undefined || url === current?.url) return [];

    return [{ pullRequest: { ...line, url }, branch: null, current: false }];
  });

  return inPullRequestOrder([...own, ...others], (each) => each.pullRequest);
}

/** The number as the chip and the row spell it. */
export function pullRequestNumberLabel(pullRequest: Pick<AgentPullRequest, "number">): string {
  return `#${pullRequest.number}`;
}

/** The word the row says where the pull request stands, only where that changes what the developer would do: a draft, merged, closed, or open in GitHub's merge queue, queued; nothing for one open otherwise. */
export function pullRequestStateWord(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string | undefined {
  const { state } = pullRequest;

  if (state !== PULL_REQUEST_STATE.OPEN) return PULL_REQUEST_STATE_LABEL[state];

  return pullRequest.queued === true ? QUEUED_LABEL : undefined;
}

/** Where a pull request stands in one word, as its card heads it: Queued for an open one the merge queue holds, else its state's label. */
export function pullRequestStateLabel(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string {
  return pullRequestStateWord(pullRequest) ?? PULL_REQUEST_STATE_LABEL[pullRequest.state];
}

/** The chip's own words for a reader who cannot see it: the number and where it stands. */
export function pullRequestPillLabel(
  pullRequest: Pick<AgentPullRequest, "number" | "state">,
): string {
  return `Pull request ${pullRequestNumberLabel(pullRequest)}, ${PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase()}`;
}
