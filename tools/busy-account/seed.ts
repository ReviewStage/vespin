/**
 * seed.ts -- a busy account for the iOS rig, every word invented: the local copy a phone keeps (its task list, its kept Inbox, its workspaces) and the answers the stub sign-in serves under `-busyAccount true` (`apps/mobile/src/host/stub-auth-server.ts`), at a scale.
 *
 * At scale 1 it is the size Charles's and Dean's freezes were measured at
 * (STAG-3917): 3,240 plans, 4,831 agents, 639 Inbox threads (~4.8 MB read
 * whole), 220 of them on open tasks and the other 419 each on an old settled
 * task outside the live list's thirty days, which "what waits" names and the
 * phone reads one by one. Scale 3 triples each. Rows are written through the
 * host's own writer, so the copy's schema is the build's, and every answer
 * is checked against the build's own read schemas before it is written.
 *
 * It writes, under `--out`:
 * - `accounts/<account>/local.sqlite`: the local copy, the task list kept at
 *   a sync id and the Inbox to the host's 1 MB cut, as a phone keeps them.
 * - `busy-account/`: the stub's answers. `inbox-whole.json`, the Inbox read
 *   whole; `tasks-delta.json`, the task list past its kept id;
 *   `what-waits.json`, every task holding a thread; `task-rows/<id>.json`,
 *   each old task read alone; `moving-agents.json` and `inbox-moves.json`,
 *   the rows the stub moves one a second and one every five.
 *
 * The rig copies both into the app's Documents/host/
 * (`apps/mobile/scripts/busy-account.sh`). It is a tool, not a test: nothing
 * is asserted beyond the rows' own decode, and no CI job runs it.
 *
 * Run: pnpm --filter @repo/busy-account seed -- --out /tmp/busy-account --scale 3
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { AGENT_ARCHIVER, AGENT_BRIEF } from "@repo/features/agent-wire";
import {
  ACCOUNT_INBOX_READ,
  INBOX_ITEMS_READ,
  inboxInOrder,
  inboxOfLiveRows,
} from "@repo/features/inbox-live";
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
import { LIVE_POLL_URL } from "@repo/features/live-wire";
import { TASK_LIST_READ, TASK_ROWS_READ, taskSummaryOf } from "@repo/features/task-list-live";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { workspaceSchema } from "@repo/features/workspace-wire";
import { openLocalDatabase } from "@repo/host/local-database";
import { localRows } from "@repo/host/local-rows";
import { nodeSqliteDriverLayer } from "@repo/host/node";
import type { WireRecord } from "@repo/wire";
import { Effect, Layer, Schema } from "effect";
import { KEPT_LIST } from "../../packages/host/src/kept-lists.js";
import type { AgentRow, PlanRow } from "../../packages/host/src/task-list-rows.js";

const { values: ARGS } = parseArgs({
  // Note that the `--` a package script's caller may put before its own arguments is left out.
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  options: {
    out: { type: "string", default: "/tmp/busy-account" },
    scale: { type: "string", default: "1" },
    // Note that the account is the stub's own (`stub-auth-server.ts`'s `STUB_ACCOUNT.sub`), whose folder the host opens once the stub signs it in.
    account: { type: "string", default: "stub-account" },
  },
});

/** How many times the measured account's size the seed is. */
const MULTIPLE = Number(ARGS.scale);

/** The threads on open tasks, the newest; every one past them sits on an old settled task of its own, outside the live list. */
const OPEN_HOLDERS = 220;

/** The account's size: at 1, the developer's first whole read's (639 threads at about 4.8 MB) beside a list of Dean's size. */
const SCALE = {
  PLANS: Math.round(3240 * MULTIPLE),
  AGENTS: Math.round(4831 * MULTIPLE),
  INBOX: Math.round(639 * MULTIPLE),
} as const;

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WORKSPACE_TEAM = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const WORKSPACE_OWN = "6fa459ea-ee8a-4ca4-894e-db77e160355e";

// Note that the reader is the stub's own account (`stub-auth-server.ts`'s `STUB_ACCOUNT.sub`), so the threads that wait on "me" wait on the signed-in reader, as the developer's do.
const ME = { userId: "stub-account", name: "Ada Lovelace" } as const;

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

/** One Inbox thread the seed writes, and the task it sits on. */
interface SeededThread {
  readonly item: InboxItem;
  readonly taskId: string;
}

/** A UUID that names `kind`'s `index`th row, the same on every run. */
function uuid(kind: number, index: number): string {
  const hex = (kind * 1_000_000 + index).toString(16).padStart(12, "0");

  return `5eed${kind.toString(16).padStart(4, "0")}-0000-4000-8000-${hex}`;
}

// SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
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

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
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
    turnSessionEnded: !running,
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
  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
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
function inboxAt(n: number): SeededThread {
  const old = n >= OPEN_HOLDERS;
  const plan = old ? SCALE.PLANS + (n - OPEN_HOLDERS) : n % 220;
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

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const item = {
    id: uuid(4, n),
    agentId: old ? uuid(2, SCALE.AGENTS + (n - OPEN_HOLDERS)) : uuid(2, plan),
    key: `busy-${n}`,
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

/**
 * The service's answers a launch reads past its kept rows, written as
 * the bodies the stub serves (`stub-auth-server.ts`, `-busyAccount true`):
 * the Inbox items read whole, as a phone that kept only the first 1 MB of a
 * larger Inbox reads it at every launch, and the task list past the sync id
 * its kept rows were read at, a small delta. The sync ids must match the
 * stub's (`BUSY_SYNC`).
 */
const BUSY_SYNC = { TASKS_KEPT: 1000, INBOX: 2000 } as const;

/** The Inbox items the host keeps on disk: the first, in its list's order, whose JSON fits in 1 MB (`account-items-follow.ts`'s `KEPT_CHARACTERS`). */
const KEPT_INBOX_CHARACTERS = 1_000_000;

/** One part of a sealed answer as the service writes it, its rows inline. */
function sealedPart(name: string, rows: readonly unknown[], sync: { past?: string; next: string }) {
  return {
    capability: "busy-account",
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: `busy-${sync.next}`,
    rows,
    sync,
    ...(sync.past === undefined ? undefined : { gone: [] }),
  };
}

/** The Inbox items read answered whole, as the service answers a reader that kept only part of it. */
function inboxWholeBody(inbox: readonly SeededThread[]): string {
  const sync = { next: String(BUSY_SYNC.INBOX) };

  const stamps = inbox.map(({ item, taskId }) => ({
    id: item.id,
    taskId,
    agentId: item.agentId,
    revision: item.revision,
    version: item.version,
    status: item.status,
    updatedAt: item.updatedAt,
    unread: false,
    remindAt: null,
    waitsOn: ME.userId,
    messages: (item.thread ?? []).length,
  }));

  const items = inbox.map(({ item }) => {
    const { thread, startedBy: _startedBy, waitsOn: _waitsOn, ...rest } = item;
    const openAsk = (thread ?? []).find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);

    return {
      ...rest,
      startedBy: ME.userId,
      startedByName: ME.name,
      waitsOn: ME.userId,
      waitsOnName: ME.name,
      answeredBy: null,
      answeredByName: null,
      closedReason: null,
      closedBy: null,
      closedByName: null,
      openAskMessageId: openAsk?.id ?? null,
      settledAt: null,
      unread: false,
      remindAt: null,
    };
  });

  const messages = inbox.flatMap(({ item }) =>
    (item.thread ?? []).map((message) => {
      // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
      const member = (message as { member?: { userId: string; name: string } }).member;

      return {
        id: message.id,
        itemId: item.id,
        author: message.author,
        userId: member?.userId ?? null,
        name: member?.name ?? null,
        text: message.text,
        ask: message.ask ?? null,
        answers: null,
        clientKey: null,
        createdAt: message.createdAt,
      };
    }),
  );

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      stamps: sealedPart("stamps", stamps, sync),
      items: sealedPart("items", items, sync),
      messages: sealedPart("messages", messages, sync),
      files: sealedPart("files", [], sync),
    },
  };

  // Note that the body is checked as the app reads it: every row of every part decodes, and the threads join whole.
  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(INBOX_ITEMS_READ.answer)(answer as never) as {
    queries: { readonly [part: string]: { readonly rows: string } };
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const back = Schema.decodeUnknownSync(INBOX_ITEMS_READ.answer)(body) as {
    queries: Record<string, { rows: readonly unknown[] }>;
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const rows = Schema.decodeUnknownSync(INBOX_ITEMS_READ.rows)(
    Object.fromEntries(Object.entries(back.queries).map(([part, query]) => [part, query.rows])),
  ) as {
    stamps: readonly unknown[];
    items: readonly unknown[];
    messages: readonly unknown[];
    files: readonly unknown[];
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const joined = inboxOfLiveRows(rows as never);

  if (
    rows.stamps.length !== stamps.length ||
    rows.items.length !== items.length ||
    rows.messages.length !== messages.length ||
    joined.length !== inbox.length ||
    joined.some((item) => item.thread?.length !== 8)
  ) {
    throw new Error(
      `busy account: the Inbox answer lost rows: ${rows.stamps.length}/${stamps.length} stamps, ${rows.items.length}/${items.length} items, ${rows.messages.length}/${messages.length} messages, ${joined.length} joined`,
    );
  }

  return JSON.stringify(body);
}

/** The `k`th old task: done six weeks back and more, outside the live list's thirty days, so only a read of it alone draws it. */
function oldPlanAt(k: number): PlanRow {
  const plan = planAt(SCALE.PLANS + k);
  const at = NOW - 45 * DAY - k * HOUR;

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  return { ...plan, status: TASK_STATUS.DONE, completedAt: at, updatedAt: at } as PlanRow;
}

/** The `k`th old task's one agent, archived with it. */
function oldAgentAt(k: number): AgentRow {
  const agent = agentAt(SCALE.AGENTS + k);

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  return { ...agent, id: uuid(2, SCALE.AGENTS + k), taskId: uuid(1, SCALE.PLANS + k) } as AgentRow;
}

/** "What waits" whole: every task holding a thread, as the account's read of it answers, so each the list does not hold is read alone. */
function whatWaitsBody(inbox: readonly SeededThread[]): string {
  const sync = { next: "1" };
  const byTask = new Map<string, { items: number; updatedAt: number }>();

  for (const { item, taskId } of inbox) {
    const held = byTask.get(taskId) ?? { items: 0, updatedAt: 0 };
    byTask.set(taskId, {
      items: held.items + 1,
      updatedAt: Math.max(held.updatedAt, item.updatedAt),
    });
  }

  const tasks = [...byTask].map(([taskId, { items, updatedAt }]) => ({
    taskId,
    items,
    toDo: items,
    updatedAt,
  }));

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      items: sealedPart("items", [], sync),
      taskless: sealedPart("taskless", [], sync),
      tasks: sealedPart("tasks", tasks, sync),
      automations: sealedPart("automations", [], sync),
      agents: sealedPart("agents", [], sync),
      failedRuns: sealedPart("failedRuns", [], sync),
    },
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(ACCOUNT_INBOX_READ.answer)(answer as never);
  Schema.decodeUnknownSync(ACCOUNT_INBOX_READ.answer)(body);

  return JSON.stringify(body);
}

/** One old task read alone, its plan and its agent, as the service answers a read of a task outside the list. */
function taskRowsBody(k: number): string {
  const sync = { next: "1" };

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      tasks: sealedPart("tasks", [oldPlanAt(k)], sync),
      agents: sealedPart("agents", [oldAgentAt(k)], sync),
    },
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(TASK_ROWS_READ.answer)(answer as never);
  Schema.decodeUnknownSync(TASK_ROWS_READ.answer)(body);

  return JSON.stringify(body);
}

/** The newest agents' rows as the wire writes them, which the stub moves one a second past the kept sync id, as a busy account's turns move. */
function movingAgentsBody(agents: readonly AgentRow[]): string {
  const sync = { past: "1", next: "2" };

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      tasks: sealedPart("tasks", [], sync),
      agents: sealedPart("agents", agents.slice(0, 200), sync),
      issues: sealedPart("issues", [], sync),
    },
    taskWorkspaces: [WORKSPACE_TEAM, WORKSPACE_OWN],
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(TASK_LIST_READ.answer)(answer as never) as {
    queries: { agents: { rows: string } };
  };

  return body.queries.agents.rows;
}

/** A hundred Inbox moves as the wire writes them: thread `n` takes a new message, so it moves to the head, each its stamp, item, and message. */
function inboxMovesBody(inboxBody: string): string {
  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const encoded = JSON.parse(inboxBody) as {
    queries: { readonly [part: string]: { readonly rows: string } };
  };

  /** The rows of the answer's part `name`, as the wire writes them. */
  const rowsOf = (name: string): readonly WireRecord[] => {
    const part = encoded.queries[name];

    // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
    return part === undefined ? [] : (JSON.parse(part.rows) as WireRecord[]);
  };

  const raw = { stamps: rowsOf("stamps"), items: rowsOf("items"), messages: rowsOf("messages") };

  const moves = Array.from({ length: 100 }, (_, n) => {
    const index = (n * 7) % raw.items.length;
    // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
    const item = raw.items[index] as WireRecord;

    // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
    const last = raw.messages.find((message) => message.itemId === item.id) as WireRecord;

    return {
      index,
      stamp: raw.stamps[index],
      item,
      message: { ...last, id: uuid(9, n) },
    };
  });

  return JSON.stringify(moves);
}

/** The task list read past its kept sync id: the five newest agents moved, as a busy account's list moves between launches. */
function tasksDeltaBody(agents: readonly AgentRow[]): string {
  const sync = { past: String(BUSY_SYNC.TASKS_KEPT), next: String(BUSY_SYNC.TASKS_KEPT + 1) };
  const moved = agents.slice(0, 5).map((agent) => ({ ...agent, saidAt: NOW - MINUTE }));

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      tasks: sealedPart("tasks", [], sync),
      agents: sealedPart("agents", moved, sync),
      issues: sealedPart("issues", [], sync),
    },
    taskWorkspaces: [WORKSPACE_TEAM, WORKSPACE_OWN],
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(TASK_LIST_READ.answer)(answer as never) as object;

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const back = Schema.decodeUnknownSync(TASK_LIST_READ.answer)(body) as {
    queries: Record<string, { rows: readonly unknown[] }>;
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const rows = Schema.decodeUnknownSync(TASK_LIST_READ.rows)(
    Object.fromEntries(Object.entries(back.queries).map(([part, query]) => [part, query.rows])),
  ) as { agents: readonly unknown[] };

  if (rows.agents.length !== moved.length)
    throw new Error(
      `busy account: the task list delta lost rows: ${rows.agents.length}/${moved.length}`,
    );

  return JSON.stringify(body);
}

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeSqliteDriverLayer);

/** Writes the account's local copy, through the host's own writer, and the stub's answers beside it. */
const seed = Effect.gen(function* () {
  const root = ARGS.out;
  const plans = Array.from({ length: SCALE.PLANS }, (_, index) => planAt(index));

  const agents = Array.from({ length: SCALE.AGENTS }, (_, index) => agentAt(index)).sort(
    (one, other) => other.createdAt - one.createdAt,
  );

  const inbox = Array.from({ length: SCALE.INBOX }, (_, n) => inboxAt(n));
  const olds = Math.max(0, SCALE.INBOX - OPEN_HOLDERS);

  // Note that the kept Inbox's holders are the list's tasks or an old task's, as the phone keeps either beside the threads it kept.
  const planById = new Map(
    [...plans, ...Array.from({ length: olds }, (_, k) => oldPlanAt(k))].map((plan) => [
      plan.id,
      plan,
    ]),
  );

  // Note that the host keeps only the first of a large Inbox, in its list's order, within 1 MB, so the seed keeps what the phone keeps.
  const taskOf = new Map(inbox.map(({ item, taskId }) => [item.id, taskId]));
  let keptChars = 0;

  const keptInbox = inboxInOrder(inbox.map(({ item }) => item))
    .filter((item) => {
      keptChars += JSON.stringify(item).length;

      return keptChars <= KEPT_INBOX_CHARACTERS;
    })
    .flatMap((item) => {
      const taskId = taskOf.get(item.id);

      return taskId === undefined ? [] : [{ item, taskId }];
    });

  // Note that every row is checked against the shape the service delivers, so the app reads it as a real one.
  Schema.decodeUnknownSync(TASK_LIST_READ.rows)({ tasks: plans, agents, issues: [] });

  for (const { item } of inbox) Schema.decodeUnknownSync(inboxItemSchema)(item);

  for (const workspace of WORKSPACES) Schema.decodeUnknownSync(workspaceSchema)(workspace);

  yield* Effect.scoped(
    Effect.gen(function* () {
      const rows = localRows(yield* openLocalDatabase(root, ARGS.account));

      const write = (
        kept: { readonly name: string; readonly kind: string },
        keyed: readonly { readonly key: string; readonly row: unknown }[],
        cursor: Parameters<typeof rows.answered>[0]["cursor"],
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

      // Note that the list is kept at a sync id, as the host keeps it, so the first read asks past it (`task-list-collections.ts`'s `taskListKeptSchema`).
      const listKept = {
        at: String(BUSY_SYNC.TASKS_KEPT),
        taskWorkspaces: [WORKSPACE_TEAM, WORKSPACE_OWN],
      };

      yield* write(
        KEPT_LIST.TASK_LIST_PLANS,
        plans.map((row) => ({ key: row.id, row })),
        listKept,
      );
      yield* write(
        KEPT_LIST.TASK_LIST_AGENTS,
        agents.map((row) => ({ key: row.id, row })),
        listKept,
      );
      yield* write(
        KEPT_LIST.INBOX,
        keptInbox.map(({ item }) => ({ key: item.id, row: item })),
        {
          plans: Object.fromEntries(keptInbox.map(({ item, taskId }) => [item.id, taskId])),
          holders: [...new Set(keptInbox.map(({ taskId }) => taskId))]
            .slice(0, 250)
            .flatMap((taskId) => {
              const plan = planById.get(taskId);

              return plan === undefined ? [] : [taskSummaryOf(plan, undefined)];
            }),
        },
      );
    }),
  );

  const answers = `${root}/busy-account`;
  mkdirSync(`${answers}/task-rows`, { recursive: true });
  const inboxBody = inboxWholeBody(inbox);
  writeFileSync(`${answers}/inbox-whole.json`, inboxBody);
  writeFileSync(`${answers}/tasks-delta.json`, tasksDeltaBody(agents));
  writeFileSync(`${answers}/what-waits.json`, whatWaitsBody(inbox));
  writeFileSync(`${answers}/moving-agents.json`, movingAgentsBody(agents));
  writeFileSync(`${answers}/inbox-moves.json`, inboxMovesBody(inboxBody));

  for (let k = 0; k < olds; k += 1) {
    writeFileSync(`${answers}/task-rows/${uuid(1, SCALE.PLANS + k)}.json`, taskRowsBody(k));
  }

  process.stdout.write(
    `busy account at ${MULTIPLE}x: ${plans.length} plans, ${agents.length} agents, ${inbox.length} Inbox threads (${olds} on old tasks read alone), ${keptInbox.length} kept; local copy at ${root}/accounts/${ARGS.account}/local.sqlite, answers at ${answers} (Inbox whole ${Math.round(inboxBody.length / 1e5) / 10} MB)\n`,
  );
});

await Effect.runPromise(seed.pipe(Effect.provide(platform)));
