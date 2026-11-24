// zz-task-list-steady.test.ts -- EXPERIMENT, never committed: the host task list's first draws and its cost per moved live agent, for STAG-3917's fold against main.
//
// DRAW_MODE=kept: the kept list's first draw (the phone's launch, the desktop's start). DRAW_MODE=answer: a whole first answer (a desktop or web first draw), then STEPS moves of one live agent each, a turn starting or ending, as the follow answers past a sync id.

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { AGENT_ARCHIVER, AGENT_BRIEF } from "@repo/features/agent-wire";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { entityPool } from "@repo/sync";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { KEPT_LIST } from "./kept-lists.js";
import { DRAW_TICK } from "./live-collection.js";
import { type LiveTaskList, taskListCollections } from "./task-list-collections.js";
import type { AgentRow, PlanRow } from "./task-list-rows.js";

const SCALE = { PLANS: 3240, AGENTS: Number(process.env.AGENTS ?? 4831), INBOX: 205 } as const;
const NOW = 1_795_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WORKSPACE_TEAM = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const WORKSPACE_OWN = "6fa459ea-ee8a-4ca4-894e-db77e160355e";
const ME = { userId: "probeUser0000000000000000000000a", name: "Ada Lovelace" } as const;
const PEOPLE = [
  ME,
  { userId: "probeUser0000000000000000000000b", name: "Grace Hopper" },
  { userId: "probeUser0000000000000000000000c", name: "Alan Turing" },
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

const WORDS =
  "I read through `src/billing/invoice.ts` and the **rounding** rules the description settles. Two of the cases disagree with what the tests expect, so I'd like a decision before I change either: should a partial cent round half up, as the invoice does today, or to even, as the ledger does? Either way I'll add a test for each case and note it in the description.";

/** A UUID that names `kind`'s `index`th row, the same on every run. */
function uuid(kind: number, index: number): string {
  const hex = (kind * 1_000_000 + index).toString(16).padStart(12, "0");

  return `5eed${kind.toString(16).padStart(4, "0")}-0000-4000-8000-${hex}`;
}

const at = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

function planAt(index: number): PlanRow {
  const created = NOW - index * 3 * HOUR;
  const owner = at(PEOPLE, index);
  const assignee = at(PEOPLE, index + 1);
  const open = index < 220;

  return {
    id: uuid(1, index),
    archivedAt: null,
    workspaceId: index % 9 === 0 ? WORKSPACE_OWN : WORKSPACE_TEAM,
    name: `${at(VERBS, index)} the ${at(NOUNS, index)} (${index})`,
    repository: "probe-org/probe-app",
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
    status: open
      ? index % 2 === 0
        ? TASK_STATUS.IN_PROGRESS
        : TASK_STATUS.TODO
      : TASK_STATUS.DONE,
    priority: at([TASK_PRIORITY.NONE, TASK_PRIORITY.HIGH, TASK_PRIORITY.MEDIUM], index),
    number: SCALE.PLANS - index,
    creatorActor: "developer",
    creatorAgentId: index % 3 === 0 ? uuid(2, index + 7) : null,
    parentTaskId: index % 5 === 0 && index + 3 < SCALE.PLANS ? uuid(1, index + 3) : null,
    subTaskCount: index % 5 === 3 ? 1 : 0,
    finishedSubTaskCount: 0,
    blocked: false,
    blockedBy: index % 11 === 0 ? [uuid(1, index + 1)] : [],
    blocks: index % 11 === 1 ? [uuid(1, index - 1)] : [],
    madeByRun: false,
    followerIds: [owner.userId, assignee.userId],
    followerMachines: [true, false],
  };
}

function pullRequest(index: number, number: number) {
  return {
    number,
    title: `${at(VERBS, index)} the ${at(NOUNS, index)} so it holds under load`,
    url: `https://github.com/probe-org/probe-app/pull/${number}`,
    state: index % 7 === 0 ? ("open" as const) : ("merged" as const),
    checks: "passing" as const,
    additions: 120 + (index % 300),
    deletions: 30 + (index % 90),
    changedFiles: 3 + (index % 12),
    headSha: `${uuid(9, index).replaceAll("-", "")}abcd1234`.slice(0, 40),
    author: "probe-author",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
    authorBot: false,
  };
}

function agentAt(index: number): AgentRow {
  const plan = index % SCALE.PLANS;
  const created = NOW - plan * 3 * HOUR + (index >= SCALE.PLANS ? 20 * MINUTE : 0);
  const starter = at(PEOPLE, index);
  const archived = plan >= 220;
  const running = index < 12;
  const prs =
    index % 3 === 0
      ? []
      : [
          pullRequest(index, 9000 + index),
          ...(index % 4 === 0 ? [pullRequest(index + 1, 19000 + index)] : []),
        ];

  return {
    id: uuid(2, index),
    taskId: index % 40 === 39 ? null : uuid(1, plan),
    workspaceId: plan % 9 === 0 ? WORKSPACE_OWN : WORKSPACE_TEAM,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: null,
    title: `${at(VERBS, index + 2)} the ${at(NOUNS, index + 3)} for the release`,
    kind: index % 97 === 0 ? "manager" : "coder",
    brief: AGENT_BRIEF.DESCRIPTION,
    repository: "probe-org/probe-app",
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
          by: AGENT_ARCHIVER.AGENT,
          userId: starter.userId,
          agentId: uuid(2, index + 13),
          agentName: "Manager",
          reason: "Its pull request merged and its task is done, so nothing is left for it to do.",
          withTask: true,
        }
      : null,
    archiverName: archived ? starter.name : null,
    disabledServers: ["https://mcp.example.com/a", "https://mcp.example.com/b"],
    published: prs[0] ?? null,
    pullRequests: prs,
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
    turnStatus: running ? "running" : "completed",
    cancelRequested: false,
    turnFailure: null,
    queuedAt: created + MINUTE,
    startedAt: created + 2 * MINUTE,
    settledAt: running ? null : created + 40 * MINUTE,
    waitsUntil: null,
    cancelRequestedAt: null,
    leaseUntil: null,
    turnSessionEnded: running ? false : true,
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


const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
const round = (n: number) => Math.round(n * 100) / 100;

it.effect("the task list's first draws and its cost per moved live agent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const plans = Array.from({ length: SCALE.PLANS }, (_, i) => planAt(i));
      const agents = Array.from({ length: SCALE.AGENTS }, (_, i) => agentAt(i)).sort((one, other) => other.createdAt - one.createdAt);
      const mode = process.env.DRAW_MODE ?? "kept";
      const kept = new Map<string, readonly unknown[]>(mode === "kept" ? [[KEPT_LIST.TASK_LIST_PLANS.name, plans], [KEPT_LIST.TASK_LIST_AGENTS.name, agents]] : []);
      const pool = yield* entityPool({
        mintKey: () => "key",
        replayRefused: Effect.void,
        store: { rows: { answered: () => Effect.void, loaded: (name) => Effect.succeed({ rows: kept.get(name.read) ?? [], cursor: { at: "1" } }) } },
      });
      let last: LiveTaskList | undefined;
      let draws = 0;
      const t0 = performance.now();
      const collections = yield* taskListCollections({
        pool,
        draw: (read: LiveTaskList) => {
          last = read;
          draws += 1;
          // Note that a window reads the lists a draw hands it, so each is built here as one would be.
          void read.list.tasks.length;
          void read.taskAgents.length;
          void read.taskPullRequests.length;
          void read.agentPullRequests.length;
        },
        txWait: () => undefined,
        readAgain: () => Effect.succeed(undefined),
      });
      const line: Record<string, unknown> = { mode, build: process.env.BUILD ?? "?", agents: SCALE.AGENTS };

      if (mode === "kept") {
        let tasksAt = Number.NaN;
        yield* Effect.forkScoped(Effect.tap(collections.keptDrawn, () => Effect.sync(() => { tasksAt = performance.now(); })));
        yield* Effect.repeat(Effect.yieldNow, { until: () => last?.taskAgents.length === SCALE.AGENTS, times: 1_000_000 });
        const doneAt = performance.now();
        line.keptDraw = round(doneAt - t0);
        line.keptTasks = round(tasksAt - t0);
        line.keptAgents = round(doneAt - tasksAt);
      } else {
        const a0 = performance.now();
        yield* collections.answer({ tasks: plans, agents }, undefined, 0);
        line.firstAnswer = round(performance.now() - a0);
        assert.equal(last?.taskAgents.length, SCALE.AGENTS);
        // One live agent moves each step, in turn among the live, its turn starting and then ending, as a teammate's line runs it again.
        const live = agents.filter((agent) => agent.archivedAt === null);
        const steps = Number(process.env.STEPS ?? 300);
        const costs: number[] = [];
        let sync = 1;

        for (let step = 0; step < steps; step += 1) {
          const agent = live[step % live.length] as AgentRow;
          const starting = Math.floor(step / live.length) % 2 === 0;
          const moved = { ...agent, turnId: `turn-step-${step}`, turnStatus: starting ? "running" : "completed", settledAt: starting ? null : NOW + step, lastSettledAt: starting ? agent.lastSettledAt : NOW + step } as AgentRow;
          const before = draws;
          const s0 = performance.now();
          yield* collections.answer({ tasks: [], agents: [moved] }, { past: String(sync), next: String(sync + 1), gone: [] }, 0);
          yield* TestClock.adjust(DRAW_TICK);
          costs.push(performance.now() - s0);
          sync += 1;
          assert.ok(draws > before, "a step drew");
        }

        const steady = costs.slice(20);
        line.stepMedian = round(median(steady));
        line.stepP95 = round(p95(steady));
        line.stepMean = round(steady.reduce((sum, cost) => sum + cost, 0) / steady.length);
      }

      console.log(JSON.stringify(line));
      appendFileSync(process.env.OUT ?? "/tmp/steady.jsonl", `${JSON.stringify(line)}\n`);
    }),
  ),
  // Note that a thousand moves run past vitest's five seconds.
  120_000,
);
