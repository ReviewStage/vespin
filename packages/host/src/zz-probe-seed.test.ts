// zz-probe-seed.test.ts -- PROBE ONLY, never merged: writes a synthetic local database at a busy account's scale for the iOS cold launch probe (STAG-3917).
//
// Run: PROBE_SEED_DIR=/tmp/seed pnpm exec vitest run packages/host/src/zz-probe-seed.test.ts
// It writes $PROBE_SEED_DIR/accounts/probe-account/local.sqlite: 3,240 plans, 4,831 agents, 205 Inbox
// items and 2 workspaces, every word invented, at the row sizes a busy account keeps (plan ~0.9 KB,
// agent ~2.3 KB, Inbox item ~4.8 KB), through the host's own writer, so its schema hash is the build's.

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { AGENT_ARCHIVER, AGENT_BRIEF } from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
  inboxItemSchema,
} from "@repo/features/inbox-wire";
import { TASK_LIST_READ, taskSummaryOf } from "@repo/features/task-list-live";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { workspaceSchema } from "@repo/features/workspace-wire";
import { Effect, Layer, Schema } from "effect";
import { KEPT_LIST } from "./kept-lists.js";
import { openLocalDatabase } from "./local-database.js";
import { localRows } from "./local-rows.js";
import { nodeSqliteDriverLayer } from "./node/index.js";
import type { AgentRow, PlanRow } from "./task-list-rows.js";

// Note that the Inbox is the developer's first whole read's size, 639 threads at about 4 MB, all of it invented.
const SCALE = { PLANS: 3240, AGENTS: 4831, INBOX: 639 } as const;
const NOW = Date.now();
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
    sandboxState: archived ? "off" : "running",
    sandboxStateAt: created + 41 * MINUTE,
  } as AgentRow;
}

function said(
  n: number,
  ago: number,
  author: "agent" | "member",
  ask?: InboxMessage["ask"],
): InboxMessage {
  return {
    id: uuid(5, n),
    author: author === "agent" ? INBOX_MESSAGE_AUTHOR.AGENT : INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(author === "member" ? { member: ME } : undefined),
    text:
      author === "agent"
        ? `${WORDS}\n\n${WORDS}`
        : "Round to even, as the ledger does. Say why in the PR.",
    ...(ask === undefined ? undefined : { ask }),
    createdAt: NOW - ago,
  } as InboxMessage;
}

/** The `n`th Inbox item, on the `n`th open plan's first agent, `n` × 40 minutes back. */
function inboxAt(n: number): { readonly item: InboxItem; readonly taskId: string } {
  const plan = n % 220;
  const ago = (n + 1) * 40 * MINUTE;
  const thread = [
    said(n * 10, ago, "agent"),
    said(n * 10 + 1, ago - 10 * MINUTE, "member"),
    said(n * 10 + 2, ago - 20 * MINUTE, "agent"),
    said(n * 10 + 3, ago - 25 * MINUTE, "member"),
    said(n * 10 + 5, ago - 27 * MINUTE, "agent"),
    said(n * 10 + 6, ago - 28 * MINUTE, "agent"),
    said(n * 10 + 7, ago - 29 * MINUTE, "agent"),
    said(n * 10 + 4, ago - 30 * MINUTE, "agent", {
      type: INBOX_ASK.ANSWER,
      status: INBOX_ASK_STATUS.OPEN,
    }),
  ];

  const item = {
    id: uuid(4, n),
    agentId: uuid(2, plan),
    key: `probe-${n}`,
    revision: thread.length,
    version: INBOX_WIRE_VERSION,
    title: `Thread ${n + 1}: decide how a partial cent rounds in the ${at(NOUNS, n)}`,
    needsReply: true,
    status: n % 3 === 0 ? INBOX_STATUS.ANSWERED : INBOX_STATUS.OPEN,
    startedBy: ME,
    waitsOn: ME,
    thread,
    postedAt: NOW - ago,
    updatedAt: NOW - ago + 30 * MINUTE,
  } as InboxItem;

  return { item, taskId: uuid(1, plan) };
}

const WORKSPACES = [
  {
    id: WORKSPACE_TEAM,
    name: "Analytical Engines",
    slug: "engines",
    role: "member",
    github: null,
    memberCount: 4,
  },
  {
    id: WORKSPACE_OWN,
    name: "Ada's workspace",
    slug: "ada",
    role: "owner",
    github: null,
    memberCount: 1,
  },
];

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

it.effect("writes the probe's synthetic local database", () =>
  Effect.gen(function* () {
    const root = process.env.PROBE_SEED_DIR ?? "/tmp/probe-seed";
    const plans = Array.from({ length: SCALE.PLANS }, (_, index) => planAt(index));
    const agents = Array.from({ length: SCALE.AGENTS }, (_, index) => agentAt(index)).sort(
      (one, other) => other.createdAt - one.createdAt,
    );
    const inbox = Array.from({ length: SCALE.INBOX }, (_, n) => inboxAt(n));

    // Note that every row is checked against the shape the service delivers, so the app reads it as a real one.
    Schema.decodeUnknownSync(TASK_LIST_READ.rows)({ tasks: plans, agents, issues: [] });
    for (const { item } of inbox) Schema.decodeUnknownSync(inboxItemSchema)(item);
    for (const workspace of WORKSPACES) Schema.decodeUnknownSync(workspaceSchema)(workspace);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const rows = localRows(yield* openLocalDatabase(root, "probe-account"));
        const write = (
          kept: { readonly name: string; readonly kind: string },
          keyed: readonly { readonly key: string; readonly row: unknown }[],
          cursor: unknown,
        ) =>
          rows.answered({
            read: kept.name,
            kind: kept.kind,
            workspace: undefined,
            upserted: keyed,
            deleted: [],
            held: { every: keyed.map(({ key }) => key) },
            cursor,
          });

        yield* write(
          KEPT_LIST.WORKSPACES,
          WORKSPACES.map((row) => ({ key: row.id, row })),
          undefined,
        );
        yield* write(
          KEPT_LIST.TASK_LIST_PLANS,
          plans.map((row) => ({ key: row.id, row })),
          undefined,
        );
        yield* write(
          KEPT_LIST.TASK_LIST_AGENTS,
          agents.map((row) => ({ key: row.id, row })),
          undefined,
        );
        yield* write(
          KEPT_LIST.INBOX,
          inbox.map(({ item }) => ({ key: item.id, row: item })),
          {
            plans: Object.fromEntries(inbox.map(({ item, taskId }) => [item.id, taskId])),
            ...(process.env.PROBE_SEED_HOLDERS === "1"
              ? {
                  holders: [...new Set(inbox.map(({ taskId }) => taskId))]
                    .slice(0, 250)
                    .map((taskId) =>
                      taskSummaryOf(plans.find((plan) => plan.id === taskId) as PlanRow, undefined),
                    ),
                }
              : undefined),
          },
        );
      }),
    );

    const size = (list: readonly unknown[]) =>
      Math.round(JSON.stringify(list).length / list.length);
    console.log(
      `probe seed: ${plans.length} plans ~${size(plans)} chars, ${agents.length} agents ~${size(agents)} chars, ${inbox.length} items ~${size(inbox.map(({ item }) => item))} chars, at ${root}/accounts/probe-account/local.sqlite`,
    );
  }).pipe(Effect.provide(platform)),
);
