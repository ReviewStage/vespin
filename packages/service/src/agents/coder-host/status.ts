import { CONNECTION_LOST_DETAIL } from "@repo/agent-runner/protocol";
import {
  type Agent,
  type AgentLatestTurn,
  type AgentLine,
  type AgentStartedFromIt,
  agentBriefOf,
  agentLineOf,
} from "@repo/database/models/agent-store";
import type { Device } from "@repo/database/models/device-store";
import type { StoredArchive, StoredAutomationOrigin } from "@repo/database/schemas/agent";
import { AGENT_PERMISSION_MODE } from "@repo/features/agent-approval-wire";
import type { BootPhase } from "@repo/features/agent-boot";
import { originSubjectsOf } from "@repo/features/agent-origin-live";
import {
  agentStatusAt,
  type StatusTurn,
  statusClockEdge as sharedStatusClockEdge,
  turnStoppable,
} from "@repo/features/agent-status";
import {
  AGENT_BRIEF,
  AGENT_FAILURE,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentArchivedBy,
  type AgentFailure,
  type AgentOrigin,
  type AgentPage,
  type AgentStatus,
  type AgentSummary,
  type AgentTurn,
  agentOwnerOf,
  CONTEXT_WINDOW,
  type NativeAgentRuntime,
  turnStatusOfWord,
} from "@repo/features/agent-wire";
import { AUTOMATION_FIRING } from "@repo/features/automation-wire";
import {
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_STEPS,
  DEVICE_LAUNCH_UNSTARTED,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
} from "@repo/features/device-agent-wire";
import { sandboxVcpus } from "@repo/features/sandbox-size";
import { TURN_FAILURE, TURN_STATUS, type TurnFailure } from "../../core.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { CODER_REFUSAL } from "./bounds.js";
import { permissionModeOf } from "./permission-mode.js";

/**
 * status.ts -- where a coding agent stands, read from its newest turn.
 *
 * An agent's status is its conversation's newest turn row, the one record
 * of a turn, as the shared rule reads it (`@repo/features/agent-status`):
 * `running` while that turn is queued for a runner or runs, and how it ended
 * after, a turn still running with a Stop stamped reading canceled already.
 * A line of the developer's awaits the turn its send queued or joined, so it
 * reads through that turn, and a turn past its deadline is failed on its row
 * by the minute sweep (`reconcile.ts`). An agent with no turn row reads as
 * starting until `STARTING_GRACE_MILLIS` past its Start and as failed after,
 * and one started blank as completed. A failed turn is also read for why, as
 * one of the wire's fixed words: the sweep's own word for a turn it settled,
 * else the host's refusal sentences where the turn's detail carries one,
 * GitHub's or the sandbox's, else a provider's refusal of a prompt longer
 * than the model's window, else the model call, which is what every other
 * failure of a coding turn is. Nothing of the detail itself leaves here.
 */

/** When the agent was started and when it is being read, which is what an agent with no turn is judged by, and whether it was started blank. */
export interface AgentStanding {
  readonly createdAt: Date;
  /** Epoch milliseconds now. */
  readonly now: number;
  /** Whether the agent was started blank, handed neither the description nor a prompt, so no first turn is on its way; unsaid reads as not. */
  readonly blank?: boolean | undefined;
  /** Where the agent's first launch stands while its boot record does (`@repo/features/agent-boot`); unsaid reads as none. */
  readonly boot?: BootPhase | undefined;
}

/** Whether an agent was started blank, as a full read or a list line says it. */
export function startedBlank(agent: Agent | Pick<AgentLine, "brief">): boolean {
  const brief = "brief" in agent ? agent.brief : agentBriefOf(agent);
  return brief === AGENT_BRIEF.BLANK;
}

/** What of the newest turn the shared rule reads (`@repo/features/agent-status`). */
function statusTurnOf(turn: AgentLatestTurn | undefined): StatusTurn | undefined {
  return turn === undefined
    ? undefined
    : { status: turn.status, cancelRequested: turn.cancelRequestedAt !== null };
}

/** The agent's standing as the shared rule reads it, in epoch milliseconds. */
function statusStandingOf(standing: AgentStanding) {
  return {
    createdAt: standing.createdAt.getTime(),
    now: standing.now,
    blank: standing.blank === true,
    boot: standing.boot,
  };
}

/**
 * Where an agent stands, from its newest turn; starting with no turn inside
 * the grace, failed with none past it. An agent started blank with no turn
 * yet has done all it was asked, which is nothing, so it reads as completed,
 * however long ago it started: no first turn is on its way.
 */
export function agentStatusOf(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): AgentStatus {
  return agentStatusAt(statusTurnOf(turn), statusStandingOf(standing));
}

/**
 * The next instant past which the clock alone moves the agent's status, in
 * epoch milliseconds: with no turn yet, the starting grace running out, from
 * starting to failed. None where nothing but a row changing can move it.
 */
export function statusClockEdge(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): number | undefined {
  return sharedStatusClockEdge(statusTurnOf(turn), statusStandingOf(standing));
}

/**
 * What a provider says, in the error a failed turn's detail keeps,
 * when the prompt is longer than the model's window: Anthropic's
 * "prompt is too long: 1368155 tokens > 1000000 maximum", and OpenAI's
 * error code and words for the same.
 */
const CONTEXT_OVERFLOW_WORDS: readonly string[] = [
  "prompt is too long",
  "context_length_exceeded",
  "maximum context length",
];

/**
 * What the turn of a run its host lost records after the host's name, the
 * run having been taken from a host that stopped beating
 * (`reconcile.ts`): the same words in every such turn, the name
 * before them being the host's own.
 */
const HOST_AWAY_DETAIL = " went away during this turn. Send a message to carry on once it's back.";

/** What the turn of a run the host named lost records. */
export function hostAwayDetail(hostName: string): string {
  return `${hostName}${HOST_AWAY_DETAIL}`;
}

/**
 * What the turn a launch waited on records when its host settled the
 * launch unstarted after reporting a step (`DEVICE_LAUNCH_STEP`): these
 * words, then the step as the wire spells it, and nothing the host printed.
 */
const LAUNCH_STOPPED_DETAIL = "the agent's host settled its launch unstarted at the step ";

/**
 * What follows the step in that detail where the host said why the launch
 * never started (`DEVICE_LAUNCH_UNSTARTED`): these words, then the reason as
 * the wire spells it.
 */
const LAUNCH_UNSTARTED_DETAIL = ", because of ";

/**
 * The host's refusal sentences, a provider's words for a prompt past the
 * window, the words of a run its host lost or a launch it settled
 * unstarted, and the runner's words for a provider's host it waited for in
 * vain (`@repo/agent-runner/protocol`'s `CONNECTION_LOST_DETAIL`), a failed
 * turn's detail may carry, by the word the wire says for each. Note that those last two read as `other` rather than words of their
 * own, because a window reads `failureReason` as one of the words it knows
 * and an older build would refuse the whole page over a new one: `other`
 * reads there as a run that ended without saying why, rather than as the
 * model's failure, and a newer window names the host from the page's
 * `hostLost`, or the step from its `launch`.
 */
export const FAILURE_WORDS: readonly (readonly [AgentFailure, readonly string[]])[] = [
  [
    AGENT_FAILURE.GITHUB,
    [
      CODER_REFUSAL.NOT_REACHABLE,
      CODER_REFUSAL.GITHUB_UNAVAILABLE,
      REPOSITORY_REFUSAL.NOT_REACHABLE,
      REPOSITORY_REFUSAL.GITHUB_UNAVAILABLE,
    ],
  ],
  [AGENT_FAILURE.CONTEXT_OVERFLOW, CONTEXT_OVERFLOW_WORDS],
  [AGENT_FAILURE.FAST_ON_OWN_KEY, [CODER_REFUSAL.FAST_ON_OWN_KEY]],
  [AGENT_FAILURE.FAST_NOT_ENABLED, [CODER_REFUSAL.FAST_NOT_ENABLED]],
  [
    AGENT_FAILURE.PROVIDER_KEY,
    [
      CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE,
      CODER_REFUSAL.ACCOUNT_KEY_REFUSED,
      CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA,
    ],
  ],
  [
    AGENT_FAILURE.SANDBOX,
    [
      REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
      REPOSITORY_REFUSAL.NO_FIREWALL,
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ],
  ],
  [AGENT_FAILURE.OTHER, [HOST_AWAY_DETAIL, LAUNCH_STOPPED_DETAIL]],
  [AGENT_FAILURE.CONNECTION_LOST, Object.values(CONNECTION_LOST_DETAIL)],
];

/**
 * The failures the service settles a turn with itself, each read as the
 * wire's word for it whatever the turn's detail says: the sweep's
 * (`reconcile.ts`), a runner a newer launch replaced, and a session that
 * ended for good. A turn past its cap reads as one that ran out of time,
 * as an abandoned one does. Every failure word neither here nor the
 * model's reads as `other`.
 */
export const SETTLED_FAILURES: readonly (readonly [TurnFailure, AgentFailure])[] = [
  [TURN_FAILURE.ABANDONED, AGENT_FAILURE.ABANDONED],
  [TURN_FAILURE.DEADLINE, AGENT_FAILURE.ABANDONED],
  [TURN_FAILURE.SESSION_ENDED, AGENT_FAILURE.SESSION_ENDED],
  [TURN_FAILURE.RUNNER_LOST, AGENT_FAILURE.RUNNER_LOST],
  [TURN_FAILURE.NO_PROGRESS, AGENT_FAILURE.NO_PROGRESS],
  [TURN_FAILURE.LINE_UNTAKEN, AGENT_FAILURE.LINE_UNTAKEN],
  [TURN_FAILURE.PLAN_LIMIT, AGENT_FAILURE.PLAN_LIMIT],
  [TURN_FAILURE.REFUSAL, AGENT_FAILURE.REFUSAL],
];

/** The host that lost a failed turn's run, by the name its turn records; nothing for any other turn. */
export function hostLostOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): { readonly host: string } | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure !== TURN_FAILURE.MODEL) return undefined;
  const detail = turn.failureDetail ?? "";
  if (!detail.endsWith(HOST_AWAY_DETAIL)) return undefined;
  const host = detail.slice(0, -HOST_AWAY_DETAIL.length);
  return host.length > 0 ? { host } : undefined;
}

/**
 * What the turn of a launch its host settled unstarted records, by the step
 * the line last held and the reason its host said, where it said one;
 * nothing where it held no step this build knows and said no reason, which
 * leaves a runner gone's words. Note that a reason with no step is recorded
 * at the first step, because the host reports each step apart from its
 * settle, so the step may land after it, and every reason is one the host
 * finds while it prepares.
 */
export function launchStoppedDetail(
  step: string | null,
  unstarted?: DeviceLaunchUnstarted,
): string | undefined {
  const known =
    DEVICE_LAUNCH_STEPS.find((each) => each === step) ??
    (unstarted === undefined ? undefined : DEVICE_LAUNCH_STEP.PREPARING);
  if (known === undefined) return undefined;
  const why = unstarted === undefined ? "" : `${LAUNCH_UNSTARTED_DETAIL}${unstarted}`;
  return `${LAUNCH_STOPPED_DETAIL}${known}${why}`;
}

/** The step and the reason a failed turn's detail records for a launch its host settled unstarted (`launchStoppedDetail`); nothing for any other turn. */
function launchStoppedParts(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): { readonly step: string; readonly unstarted: string | undefined } | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure !== TURN_FAILURE.MODEL) return undefined;
  const detail = turn.failureDetail ?? "";
  if (!detail.startsWith(LAUNCH_STOPPED_DETAIL)) return undefined;
  const [step = "", unstarted] = detail
    .slice(LAUNCH_STOPPED_DETAIL.length)
    .split(LAUNCH_UNSTARTED_DETAIL);
  return { step, unstarted };
}

/** The step a launch its host settled unstarted stopped at, as its failed turn records it; nothing for any other turn. */
export function launchStoppedOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): DeviceLaunchStep | undefined {
  const parts = launchStoppedParts(turn);
  return DEVICE_LAUNCH_STEPS.find((each) => each === parts?.step);
}

/** Why a launch its host settled unstarted never started, as its failed turn records the reason its host said; nothing for any other turn, and for one whose host said none this build knows. */
export function launchUnstartedOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): DeviceLaunchUnstarted | undefined {
  const parts = launchStoppedParts(turn);
  return Object.values(DEVICE_LAUNCH_UNSTARTED).find((each) => each === parts?.unstarted);
}

/** Why an agent read as failed failed, as the wire's word: its newest turn's failure, or a session that never started where no turn stands; nothing for a turn that did not fail. */
export function agentFailureOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): AgentFailure | undefined {
  if (turn === undefined) return AGENT_FAILURE.NOT_STARTED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  const settled = SETTLED_FAILURES.find(([failure]) => failure === turn.failure);
  if (settled !== undefined) return settled[1];
  if (turn.failure !== TURN_FAILURE.MODEL) return AGENT_FAILURE.OTHER;
  const detail = turn.failureDetail ?? "";
  const named = FAILURE_WORDS.find(([, words]) => words.some((word) => detail.includes(word)));
  return named?.[0] ?? AGENT_FAILURE.MODEL;
}

/** The newest turn as a summary carries it (`AgentSummary`'s `turn`); none before the first. */
function agentTurnOf(turn: AgentLatestTurn | undefined): AgentTurn | undefined {
  if (turn === undefined) return undefined;
  const failure = agentFailureOf(turn);
  return {
    id: turn.id,
    queuedAt: turn.queuedAt.getTime(),
    status: turnStatusOfWord(turn.status),
    ...(turn.cancelRequestedAt === null ? undefined : { stopAsked: true }),
    ...(failure === undefined ? undefined : { failure }),
    ...(turn.waitsUntil == null ? undefined : { waitsUntil: turn.waitsUntil.getTime() }),
  };
}

/** What an agent's status is read from: its newest turn. */
export interface AgentTurnStanding {
  readonly turn: AgentLatestTurn | undefined;
  /** The provider's own harness its conversation runs on; none on the retired runtime, and where the read named none. */
  readonly runtime?: NativeAgentRuntime | undefined;
  /** Whether its sandbox stands open (`openSandboxesOfReached`); none where the read named none. */
  readonly sandboxOpen?: boolean | undefined;
  /** Where its first launch stands while its boot record does (`agentBootsOf`); none where it has none or the read named none. */
  readonly boot?: BootPhase | undefined;
}

/** When the run the status is read from began: the newest turn's start, or its queueing before a runner takes it, and the agent's own before any turn. */
export function agentRunStartedAt(
  turn: AgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  return (turn === undefined ? standing.createdAt : (turn.startedAt ?? turn.queuedAt)).getTime();
}

/**
 * When the agent last did something settled, in epoch milliseconds: the
 * later of when it was started and when its newest turn to end ended
 * (`lastSettledTurnsOfReached`). Note that a turn's start is no activity,
 * because a turn starts on whatever wakes the agent, a check finishing or a
 * wakeup it set as often as a line of the developer's, and the row would
 * read "now" with nothing new on it; what the turn did shows once it ends.
 * So a list ordered by it holds still while the agent works, and moves once,
 * when the turn ends. Note too that a subagent's turns run inside its
 * parent's, and that an item the agent posts to the Inbox or a pull request
 * it opens is posted inside a turn, so the parent's turn already brackets
 * them, and none is read apart.
 */
export function agentActivityAt(
  lastSettledAt: Date | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  return Math.max(standing.createdAt.getTime(), lastSettledAt?.getTime() ?? 0);
}

/** Who archived an agent as its banner says it: the member, where their account stands, the agent acting for them, and why. */
function archivedByOf(archive: StoredArchive, names: ReadonlyMap<string, string>): AgentArchivedBy {
  const member = names.get(archive.userId);
  return {
    by: archive.by,
    ...(member === undefined ? undefined : { member: { userId: archive.userId, name: member } }),
    ...(archive.agentId === undefined
      ? undefined
      : { agent: { id: archive.agentId, name: archive.agentName ?? "" } }),
    ...(archive.reason === undefined ? undefined : { reason: archive.reason }),
    ...(archive.withTask === true ? { withTask: true } : undefined),
  };
}

/** No Mac read: a summary built from it names no Mac. */
const NO_MACS: ReadonlyMap<string, Device> = new Map();

/** The Mac a local agent runs on as its summary names it, by its name and when it last beat; none for an agent in a sandbox or whose Mac was not read. */
function macOf(
  agent: Pick<AgentLine, "machine" | "deviceId">,
  macs: ReadonlyMap<string, Device>,
): AgentSummary["mac"] {
  if (agent.machine !== AGENT_MACHINE.DEVICE || agent.deviceId == null) return undefined;
  const device = macs.get(agent.deviceId);
  return device === undefined
    ? undefined
    : { name: device.name, seenAt: device.lastSeenAt.getTime(), deviceId: device.id };
}

/** The Macs a read's local agents are pinned to, by id, which `devicesNamed` reads. */
export function summaryDevices(
  agents: readonly Pick<AgentLine, "machine" | "deviceId">[],
): readonly string[] {
  return agents.flatMap((agent) =>
    agent.machine === AGENT_MACHINE.DEVICE && agent.deviceId != null ? [agent.deviceId] : [],
  );
}

/** What every read of one agent says of it but its task, its status read at `now`, its owner, the task it stands on, the agents started from it where any was, and the Mac it runs on where `macs` holds it. */
function summaryFields(
  agent: AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[],
  macs: ReadonlyMap<string, Device>,
): Omit<AgentSummary, "id" | "planId"> {
  const starter = names.get(agent.userId);
  const mac = macOf(agent, macs);
  // Every agent stands on a task, which owns it, so the run's automation is never asked.
  const owner = agentOwnerOf({
    taskId: agent.taskId,
    runId: agent.automationRunId,
    runAutomationId: null,
  });
  const turn = agentTurnOf(standing.turn);
  const summary: Omit<AgentSummary, "id" | "planId"> = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: agent.contextWindow }
      : undefined),
    ...(standing.runtime === undefined ? undefined : { runtime: standing.runtime }),
    title: agent.title,
    // Note that only a local agent says where it runs, so a sandboxed agent's summary is as it was.
    ...(agent.machine === AGENT_MACHINE.DEVICE
      ? { machine: agent.machine }
      : { sandboxVcpus: sandboxVcpus(agent.repository) }),
    ...(mac === undefined ? undefined : { mac }),
    createdAt: agent.createdAt.getTime(),
    status: agentStatusOf(standing.turn, {
      createdAt: agent.createdAt,
      now,
      blank: startedBlank(agent),
      boot: standing.boot,
    }),
    turnId: standing.turn?.id ?? null,
    ...(turn === undefined ? undefined : { turn }),
    brief: agent.brief,
    ...(agent.archivedAt === null ? undefined : { archivedAt: agent.archivedAt.getTime() }),
    ...(agent.archivedAt === null || agent.archivedBy === null
      ? undefined
      : { archivedBy: archivedByOf(agent.archivedBy, names) }),
    ...(agent.disabledServers.length === 0
      ? undefined
      : { disabledServers: agent.disabledServers }),
    // Note that full access is said by saying nothing, as a service before modes did; the asks are the task list's to carry.
    ...(permissionModeOf(agent) === AGENT_PERMISSION_MODE.FULL_ACCESS
      ? undefined
      : { permissionMode: permissionModeOf(agent) }),
    ...(starter === undefined ? undefined : { startedBy: { userId: agent.userId, name: starter } }),
    ...(agent.startedByAgentId === null ? undefined : { startedByAgentId: agent.startedByAgentId }),
    ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    ...(agent.automationName === null ? undefined : { automationName: agent.automationName }),
    ...(agent.source == null ? undefined : { source: agent.source }),
    ...(owner === undefined ? undefined : { owner }),
    ...(agent.startedFrom === null ? undefined : { from: agent.startedFrom }),
    ...(continuedBy.length === 0
      ? undefined
      : {
          continuedBy: continuedBy.map((each) => ({
            agentId: each.agentId,
            title: each.title,
            forked: each.messageId !== undefined,
            ...(each.messageId === undefined ? undefined : { messageId: each.messageId }),
          })),
        }),
  };
  const stoppable =
    summary.status !== AGENT_STATUS.RUNNING || turnStoppable(statusTurnOf(standing.turn));
  return {
    ...summary,
    runStartedAt: agentRunStartedAt(standing.turn, agent),
    ...(stoppable ? undefined : { stoppable: false }),
    ...(standing.sandboxOpen === undefined ? undefined : { sandboxOpen: standing.sandboxOpen }),
  };
}

/** One agent as the tabs draw it, read whole or as a list's line. */
export function agentSummary(
  agent: Agent | AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentSummary {
  const line = "brief" in agent ? agent : agentLineOf(agent);
  return {
    id: line.id,
    planId: line.taskId,
    ...summaryFields(line, standing, now, names, continuedBy, macs),
  };
}

/**
 * The run that started an agent as its page opens on it: the prompt alone,
 * what its firing was about (`originSubjectsOf`), a webhook's body, and the
 * member who asked for a run now, named by `names` where their account
 * stands.
 */
function originOf(origin: StoredAutomationOrigin, names: ReadonlyMap<string, string>): AgentOrigin {
  const { firing } = origin;
  const runner =
    firing.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
      ? firing.userId
      : undefined;
  const name = runner === undefined ? undefined : names.get(runner);
  return {
    prompt: origin.prompt,
    ...originSubjectsOf(firing),
    ...(origin.body === undefined ? undefined : { body: origin.body }),
    ...(runner === undefined || name === undefined
      ? undefined
      : { runBy: { userId: runner, name } }),
  };
}

/** The accounts an agent's summary names: its starter, and the member it was archived by or for. */
export function summaryAccounts(
  agent: Pick<AgentLine, "userId" | "archivedBy">,
): readonly string[] {
  return agent.archivedBy === null ? [agent.userId] : [agent.userId, agent.archivedBy.userId];
}

/** The accounts an agent's page names: its summary's, and whoever asked for the run that started it. */
export function pageAccounts(agent: Agent): readonly string[] {
  const firing = agent.automationOrigin?.firing;
  return firing?.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
    ? [...summaryAccounts(agent), firing.userId]
    : summaryAccounts(agent);
}

/** One agent as its own page reads it, its status read at `now`, with the agents started from it and the Mac it runs on. */
export function agentPage(
  agent: Agent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentPage {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agentLineOf(agent), standing, now, names, continuedBy, macs),
    automationId: agent.automationId,
    ...(agent.automationOrigin === null
      ? undefined
      : { origin: originOf(agent.automationOrigin, names) }),
    workspaceId: agent.organizationId,
    repository: agent.repository,
    ...(agent.branch === null ? undefined : { branch: agent.branch }),
  };
}
