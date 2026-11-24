/**
 * host-seed.ts -- a busy account's task list as the host's live queries read it: 3,240 plans and as many agents as the caller asks, every word invented.
 *
 * The seed behind `host-bench.ts`, shaped as an account at its largest: 220
 * open plans, the rest Done, and every agent of a Done plan archived, so
 * about 93% of the agents are archived and the live queries hold the other
 * 7%. Agent `i` is on plan `i % 3240`; every 40th is on none, two in three
 * hold a pull request (every 4th a second), and the first 12 are at work.
 * The clock is pinned so one process's rows equal another's. Constants are
 * handed in from the build under test, since a bench times a worktree's own
 * sources and never this tree's.
 */

import type { AgentRow, PlanRow } from "../../packages/host/src/task-list-rows.js";

/** The constants of the build under test that the seed's rows name. */
export interface SeedConstants {
  readonly agentArchiver: { readonly AGENT: string };
  readonly agentBrief: { readonly DESCRIPTION: string };
  readonly taskPriority: { readonly NONE: string; readonly HIGH: string; readonly MEDIUM: string };
  readonly taskStatus: {
    readonly DONE: string;
    readonly IN_PROGRESS: string;
    readonly TODO: string;
  };
}

/** The account's size. */
export const SEED = {
  PLANS: 3240,
  /** The plans, from the newest, that are open; the agents of every other plan are archived. */
  OPEN_PLANS: 220,
  /** The agents at work at the start, the newest. */
  WORKING: 12,
} as const;

/** The seed's pinned clock, so rows compare across processes. */
export const NOW = 1_795_000_000_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WORKSPACE_TEAM = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const WORKSPACE_OWN = "6fa459ea-ee8a-4ca4-894e-db77e160355e";

const PEOPLE = [
  { userId: "benchUser0000000000000000000000a", name: "Ada Lovelace" },
  { userId: "benchUser0000000000000000000000b", name: "Grace Hopper" },
  { userId: "benchUser0000000000000000000000c", name: "Alan Turing" },
] as const;

const NOUNS = [
  "invite flow",
  "billing rounding",
  "search index",
  "sidebar order",
  "push tokens",
  "sync cursor",
  "release notes",
  "picture viewer",
  "agent composer",
  "workspace switcher",
  "task relations",
  "description editor",
] as const;

const VERBS = ["Fix", "Speed up", "Redesign", "Harden", "Test", "Document", "Remove"] as const;

/** A UUID that names `kind`'s `index`th row, the same on every run. */
function uuid(kind: number, index: number): string {
  const hex = (kind * 1_000_000 + index).toString(16).padStart(12, "0");

  return `5eed${kind.toString(16).padStart(4, "0")}-0000-4000-8000-${hex}`;
}

// SAFETY: the index is taken modulo the list's length, and every list picked from is filled.
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

function pullRequestAt(index: number, number: number) {
  return {
    number,
    title: `${pick(VERBS, index)} the ${pick(NOUNS, index)} so it holds under load`,
    url: `https://github.com/bench-org/bench-app/pull/${number}`,
    state: index % 7 === 0 ? ("open" as const) : ("merged" as const),
    checks: "passing" as const,
    additions: 120 + (index % 300),
    deletions: 30 + (index % 90),
    changedFiles: 3 + (index % 12),
    headSha: `${uuid(9, index).replaceAll("-", "")}abcd1234`.slice(0, 40),
    author: "bench-author",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
    authorBot: false,
  };
}

/** The plan at `index`, the newest first, each three hours older than the last. */
function planAt(constants: SeedConstants, index: number): PlanRow {
  const created = NOW - index * 3 * HOUR;
  const owner = pick(PEOPLE, index);
  const assignee = pick(PEOPLE, index + 1);
  const open = index < SEED.OPEN_PLANS;
  const { taskStatus, taskPriority } = constants;

  // SAFETY: the row names every field the plans statement delivers, as the build under test types them.
  return {
    id: uuid(1, index),
    archivedAt: null,
    workspaceId: index % 9 === 0 ? WORKSPACE_OWN : WORKSPACE_TEAM,
    name: `${pick(VERBS, index)} the ${pick(NOUNS, index)} (${index})`,
    repository: "bench-org/bench-app",
    ownerId: owner.userId,
    ownerName: owner.name,
    assigneeId: assignee.userId,
    assigneeName: assignee.name,
    pinnedAt: null,
    pinPosition: null,
    readThrough: created + HOUR,
    completedAt: open ? null : created + 2 * HOUR,
    createdAt: created,
    updatedAt: created + 2 * HOUR,
    status: open ? (index % 2 === 0 ? taskStatus.IN_PROGRESS : taskStatus.TODO) : taskStatus.DONE,
    priority: pick([taskPriority.NONE, taskPriority.HIGH, taskPriority.MEDIUM], index),
    number: SEED.PLANS - index,
    creatorActor: "developer",
    creatorAgentId: index % 3 === 0 ? uuid(2, index + 7) : null,
    parentTaskId: index % 5 === 0 && index + 3 < SEED.PLANS ? uuid(1, index + 3) : null,
    subTaskCount: index % 5 === 3 ? 1 : 0,
    finishedSubTaskCount: 0,
    blocked: false,
    blockedBy: index % 11 === 0 ? [uuid(1, index + 1)] : [],
    blocks: index % 11 === 1 ? [uuid(1, index - 1)] : [],
    madeByRun: false,
    followerIds: [owner.userId, assignee.userId],
    followerMachines: [true, false],
  } as PlanRow;
}

/** The agent at `index`, on plan `index % 3240`, archived where its plan is Done. */
function agentAt(constants: SeedConstants, index: number): AgentRow {
  const plan = index % SEED.PLANS;
  const created = NOW - plan * 3 * HOUR + (index >= SEED.PLANS ? 20 * MINUTE : 0);
  const starter = pick(PEOPLE, index);
  const archived = plan >= SEED.OPEN_PLANS;
  const working = index < SEED.WORKING;

  const pullRequests =
    index % 3 === 0
      ? []
      : [
          pullRequestAt(index, 9000 + index),
          ...(index % 4 === 0 ? [pullRequestAt(index + 1, 19000 + index)] : []),
        ];

  // SAFETY: the row names every field the agents statement delivers, as the build under test types them.
  return {
    id: uuid(2, index),
    taskId: index % 40 === 39 ? null : uuid(1, plan),
    workspaceId: plan % 9 === 0 ? WORKSPACE_OWN : WORKSPACE_TEAM,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: null,
    title: `${pick(VERBS, index + 2)} the ${pick(NOUNS, index + 3)} for the release`,
    kind: index % 97 === 0 ? "manager" : "coder",
    brief: constants.agentBrief.DESCRIPTION,
    repository: "bench-org/bench-app",
    sandboxVcpus: 4,
    starterId: starter.userId,
    starterName: starter.name,
    startedByAgentId: index % 4 === 0 ? uuid(2, index + 13) : null,
    automationId: null,
    automationName: null,
    runId: null,
    runAutomationId: null,
    archivedAt: archived ? created + DAY : null,
    archivedBy: archived
      ? {
          by: constants.agentArchiver.AGENT,
          userId: starter.userId,
          agentId: uuid(2, index + 13),
          agentName: "Manager",
          reason: "Its pull request merged and its task is done, so nothing is left for it to do.",
          withTask: true,
        }
      : null,
    archiverName: archived ? starter.name : null,
    disabledServers: ["https://mcp.example.com/a", "https://mcp.example.com/b"],
    published: pullRequests[0] ?? null,
    pullRequests,
    startedFrom: null,
    source: null,
    pinnedAt: null,
    pinPosition: null,
    readThrough: created + HOUR,
    markedUnread: false,
    saidAt: null,
    face: null,
    createdAt: created,
    turnId: uuid(3, index),
    turnStatus: working ? "running" : "completed",
    cancelRequested: false,
    turnFailure: null,
    queuedAt: created + MINUTE,
    startedAt: created + 2 * MINUTE,
    settledAt: working ? null : created + 40 * MINUTE,
    waitsUntil: null,
    cancelRequestedAt: null,
    leaseUntil: null,
    turnSessionEnded: !working,
    awaitingLineAt: null,
    lastSettledAt: created + 40 * MINUTE,
    runtime: "claude-code",
    machine: "vercel",
    deviceId: null,
    deviceName: null,
    sandboxOpen: false,
    permissionMode: "full_access",
    pendingApprovals: [],
    sandboxState: archived ? "stopped" : "running",
    sandboxStateAt: created + 41 * MINUTE,
  } as AgentRow;
}

/** The account's plans and `agentCount` agents, the agents newest first as the held read orders them, so a plan's agents share a chunk. */
export function seedRows(constants: SeedConstants, agentCount: number) {
  const plans = Array.from({ length: SEED.PLANS }, (_, index) => planAt(constants, index));

  const agents = Array.from({ length: agentCount }, (_, index) => agentAt(constants, index)).sort(
    (one, other) => other.createdAt - one.createdAt,
  );

  return { plans, agents };
}
