/**
 * seed.ts -- a busy account for the iOS rig, every word invented: the local copy a phone keeps (its task list, its kept Inbox, its workspaces) and the answers the stub sign-in serves under `-busyAccount true` (`apps/mobile/src/host/stub-auth-server.ts`), at a scale.
 *
 * At scale 1 it is the size Charles's and Dean's freezes were measured at
 * (STAG-3917): 3,240 plans, 4,831 agents, 639 Inbox threads (~4.8 MB read
 * whole), 220 of them on open tasks and the other 419 each on an old settled
 * task outside the live list's thirty days, which "what waits" names and the
 * phone reads one by one. Scale 3 triples the plans, agents and threads but
 * keeps the 220 open tasks, so every thread it adds sits on an old task: 1,697
 * read one by one, the 3× the diagnosis measured. Rows are written through the
 * host's own writer, so the copy's schema is the build's, and every answer
 * is checked against the build's own read schemas before it is written.
 *
 * It writes, under `--out`:
 * - `accounts/<account>/local.sqlite`: the local copy, the task list kept at
 *   a sync id and the Inbox to the host's 1 MB cut, as a phone keeps them;
 * - `accounts/<account>/collections.sqlite`: the Inbox kept on disk whole,
 *   at its sync id, as a phone whose Inbox kind is stored keeps it, so a
 *   catch-up launch reads past that id rather than whole.
 * - `busy-account/`: the stub's answers. `inbox-whole.json`, the Inbox read
 *   whole; `inbox-pages/<n>.json`, the same read in pages, as a build that
 *   reads pages is answered it; `tasks-delta.json`, the task list past its kept id;
 *   `tasks-whole.json` and `tasks-pages/<n>.json`, the task list read
 *   whole, in one answer and in pages, for a launch from an empty store;
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
import { entityPool } from "@repo/sync";
import { nodeKeptCollections } from "@repo/sync/testing";
import type { WireRecord } from "@repo/wire";
import { Effect, Exit, Layer, Schema, Scope } from "effect";
import { INBOX_THREAD, placedRow } from "../../packages/host/src/inbox-collections.js";
import { INBOX_MESSAGE, threadMessagesOf } from "../../packages/host/src/inbox-messages.js";
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

/** The open tasks, the newest, and the threads on them, one each, at every scale; every thread past them sits on an old settled task of its own, outside the live list. */
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
  const open = index < OPEN_HOLDERS;

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
  const archived = plan >= OPEN_HOLDERS;
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
    // Note that an agent holding a thread keeps its task, since the thread is that task's.
    taskId: index % 40 === 39 && index >= OPEN_HOLDERS ? null : uuid(1, plan),
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
  const plan = old ? SCALE.PLANS + (n - OPEN_HOLDERS) : n;
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

/**
 * Throws unless every part of `body`, an answer `read` encoded, decodes
 * under the read's own rows schema with as many rows as `written` gave it,
 * since a row that fails its own decode is dropped there rather than
 * failing the answer, and a seed that lost one would measure a launch that
 * never happens.
 */
function checkRows<Encoded>(
  what: string,
  read: {
    readonly answer: Schema.Codec<unknown, Encoded>;
    readonly rows: Schema.Codec<unknown, unknown>;
  },
  body: Encoded,
  written: { readonly [part: string]: number },
): void {
  // SAFETY: an answer's decode holds each part's rows as an array, which the read's own answer schema confirms.
  const back = Schema.decodeUnknownSync(read.answer)(body) as {
    readonly queries: { readonly [part: string]: { readonly rows: readonly unknown[] } };
  };

  // SAFETY: a read's rows decode holds each part as an array of its rows, which the read's own rows schema confirms.
  const rows = Schema.decodeUnknownSync(read.rows)(
    Object.fromEntries(Object.entries(back.queries).map(([part, query]) => [part, query.rows])),
  ) as { readonly [part: string]: readonly unknown[] };

  for (const [part, count] of Object.entries(written)) {
    const decoded = rows[part]?.length ?? 0;

    if (decoded !== count) {
      throw new Error(`busy account: ${what} lost rows of ${part}: ${decoded}/${count}`);
    }
  }
}

/**
 * How many threads a page of the Inbox's whole answer carries, as the
 * service pages it (`packages/service/src/live/reads/inbox-items.ts`'s
 * `ITEMS_A_PAGE`).
 */
const INBOX_THREADS_A_PAGE = 25;

/** The Inbox items read answered whole, as the service answers a reader that kept only part of it. */
function inboxWholeBody(inbox: readonly SeededThread[]): string {
  return inboxBody(inbox, { next: String(BUSY_SYNC.INBOX) });
}

/**
 * The Inbox's whole answer in pages, as the service answers a build that
 * reads pages: `INBOX_THREADS_A_PAGE` threads a page, the latest changed
 * first, each page naming the next by its number and every page the same
 * sync id, and the last carrying the snapshot that shows every write below
 * it. Note that the page and the snapshot are written onto the encoded
 * body, so a build from before the wire names them still writes them.
 */
function inboxPageBodies(inbox: readonly SeededThread[]): readonly string[] {
  const newestFirst = inbox.toSorted(
    (one, other) =>
      other.item.updatedAt - one.item.updatedAt || (other.item.id < one.item.id ? -1 : 1),
  );

  const count = Math.ceil(newestFirst.length / INBOX_THREADS_A_PAGE);
  const next = String(BUSY_SYNC.INBOX);

  return Array.from({ length: count }, (_, n) => {
    const threads = newestFirst.slice(n * INBOX_THREADS_A_PAGE, (n + 1) * INBOX_THREADS_A_PAGE);

    // SAFETY: the body is the one `inboxBody` encoded through the build's own answer schema, whose parts each carry `sync`.
    const body = JSON.parse(inboxBody(threads, { next })) as {
      queries: Record<string, { sync: Record<string, string>; snapshot?: string }>;
    };

    const last = n === count - 1;

    for (const part of Object.values(body.queries)) {
      if (last) part.snapshot = `${next}:${next}:`;
      else part.sync.page = String(n + 1);
    }

    // SAFETY: the body is the read's own encoded answer, parsed back, with only its page or its snapshot written onto each part, which the answer schema reads.
    checkRows(`the Inbox's page ${n}`, INBOX_ITEMS_READ, body as never, {
      stamps: threads.length,
      items: threads.length,
      messages: threads.reduce((sum, { item }) => sum + (item.thread ?? []).length, 0),
    });

    return JSON.stringify(body);
  });
}

/** The Inbox items read answering `inbox`'s threads at `sync`, checked as the app reads it. */
function inboxBody(inbox: readonly SeededThread[], sync: { readonly next: string }): string {
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

  // Note that an old task takes a number past the list's own, each its own, since a number under one fails the row's decode and the task would read as gone.
  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  return {
    ...plan,
    number: SCALE.PLANS + k + 1,
    status: TASK_STATUS.DONE,
    completedAt: at,
    updatedAt: at,
  } as PlanRow;
}

/** The `k`th old task's one agent, archived with it, in its task's workspace. */
function oldAgentAt(k: number): AgentRow {
  const agent = agentAt(SCALE.AGENTS + k);
  const plan = oldPlanAt(k);

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  return {
    ...agent,
    id: uuid(2, SCALE.AGENTS + k),
    taskId: plan.id,
    workspaceId: plan.workspaceId,
  } as AgentRow;
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
  checkRows("what waits", ACCOUNT_INBOX_READ, body, { tasks: tasks.length });

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
  checkRows(`old task ${k}`, TASK_ROWS_READ, body, { tasks: 1, agents: 1 });

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

/** How many plans a page of the task list's whole answer carries, as the service pages it (`packages/service/src/live/reads/tasks.ts`'s `TASKS_A_PAGE`). */
const TASK_PLANS_A_PAGE = 80;

/** The task list read answering `plans` and `agents` at the kept sync id, checked as the app reads it: every row of every part decodes. */
function tasksBody(plans: readonly PlanRow[], agents: readonly AgentRow[]): string {
  const sync = { next: String(BUSY_SYNC.TASKS_KEPT) };

  const answer = {
    url: LIVE_POLL_URL,
    queries: {
      tasks: sealedPart("tasks", plans, sync),
      agents: sealedPart("agents", agents, sync),
      issues: sealedPart("issues", [], sync),
    },
    taskWorkspaces: [WORKSPACE_TEAM, WORKSPACE_OWN],
  };

  // SAFETY: the seed's rows are built to the wire's shapes, and every one is decoded by the build's own schemas before it is written (`seed`'s checks), so the shape named here is the one the decode confirms.
  const body = Schema.encodeSync(TASK_LIST_READ.answer)(answer as never);
  checkRows("the task list", TASK_LIST_READ, body, { tasks: plans.length, agents: agents.length });

  return JSON.stringify(body);
}

/**
 * The task list's whole answer in pages, as the service answers a build
 * that reads pages: `TASK_PLANS_A_PAGE` plans a page, the newest first,
 * each with every agent of it, the agents on no plan on the first page,
 * each page naming the next by its number and every page the kept sync id,
 * and the last carrying the snapshot that shows every write below it,
 * written onto the encoded body as the Inbox's pages are.
 */
function tasksPageBodies(
  plans: readonly PlanRow[],
  agents: readonly AgentRow[],
): readonly string[] {
  const newestFirst = plans.toSorted(
    (one, other) => other.createdAt - one.createdAt || (other.id < one.id ? -1 : 1),
  );

  const count = Math.ceil(newestFirst.length / TASK_PLANS_A_PAGE);
  const next = String(BUSY_SYNC.TASKS_KEPT);

  return Array.from({ length: count }, (_, n) => {
    const page = newestFirst.slice(n * TASK_PLANS_A_PAGE, (n + 1) * TASK_PLANS_A_PAGE);
    const ids = new Set(page.map((plan) => plan.id));

    const ofPage = agents.filter((agent) =>
      agent.taskId === null ? n === 0 : ids.has(agent.taskId),
    );

    // SAFETY: the body is the one `tasksBody` encoded through the build's own answer schema, whose parts each carry `sync`.
    const body = JSON.parse(tasksBody(page, ofPage)) as {
      queries: Record<string, { sync: Record<string, string>; snapshot?: string }>;
    };

    const last = n === count - 1;

    for (const part of Object.values(body.queries)) {
      if (last) part.snapshot = `${next}:${next}:`;
      else part.sync.page = String(n + 1);
    }

    // SAFETY: the body is the read's own encoded answer, parsed back, with only its page or its snapshot written onto each part, which the answer schema reads.
    checkRows(`the task list's page ${n}`, TASK_LIST_READ, body as never, {
      tasks: page.length,
      agents: ofPage.length,
    });

    return JSON.stringify(body);
  });
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

/**
 * The account's Inbox kept whole in its database of stored kinds
 * (`collections.sqlite`), at the sync id the stub answers the Inbox past, as
 * the host's stored follow keeps it (`account-items-stored.ts`): written
 * through TanStack DB's own persistence, as the pool keeps a stored kind,
 * since rows written by hand would not be read back. Note that the pool's
 * scope closes before the database does, since its collections' release
 * waits on their writes.
 */
const keepInboxWhole = (file: string, inbox: readonly SeededThread[]) =>
  Effect.gen(function* () {
    const database = nodeKeptCollections(file);
    const scope = yield* Scope.make();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const pool = yield* entityPool({
          mintKey: () => "busy-account",
          replayRefused: Effect.void,
          store: { collections: () => ({ keep: database.keep, scope }) },
        });

        // Note that the iPhone keeps the Inbox lean: each thread's row under the kept list, and its messages as a kind of their own, written first as the host writes them (`account-items-stored.ts`).
        const threads = yield* pool.stand(INBOX_THREAD, {
          owns: true,
          kept: KEPT_LIST.INBOX,
          redraw: () => Effect.void,
          confirmation: () => undefined,
        });

        const messages = yield* pool.stand(INBOX_MESSAGE, {
          owns: true,
          redraw: () => Effect.void,
          confirmation: () => undefined,
        });

        yield* messages.answer(inbox.flatMap(({ item }) => threadMessagesOf(item)));

        yield* threads.answer(
          inbox.map(({ item, taskId }) => placedRow(item, taskId)),
          { cursor: { at: String(BUSY_SYNC.INBOX) } },
        );
      }),
    );

    yield* Scope.close(scope, Exit.void);
    yield* Effect.promise(() => database.close());
  });

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

      // Note that each write is read back and its rows counted, since the store's writer logs a failed transaction rather than failing, and a seed that kept part of a list would measure a launch that never happens.
      const write = (
        kept: { readonly name: string; readonly kind: string },
        keyed: readonly { readonly key: string; readonly row: unknown }[],
        cursor: Parameters<typeof rows.answered>[0]["cursor"],
      ) =>
        Effect.gen(function* () {
          const name = { read: kept.name, kind: kept.kind, workspace: undefined };

          yield* rows.answered({
            ...name,
            upserted: keyed,
            deleted: [],
            held: { every: keyed.map(({ key }) => key) },
            cursor,
          });

          const stored = yield* rows.loaded(name);

          if (stored?.rows.length !== keyed.length) {
            return yield* Effect.die(
              new Error(
                `busy account: the local copy kept ${stored?.rows.length ?? 0} of ${keyed.length} rows of ${kept.name}`,
              ),
            );
          }
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

  yield* keepInboxWhole(`${root}/accounts/${ARGS.account}/collections.sqlite`, inbox);

  const answers = `${root}/busy-account`;
  mkdirSync(`${answers}/task-rows`, { recursive: true });
  const inboxBody = inboxWholeBody(inbox);
  writeFileSync(`${answers}/inbox-whole.json`, inboxBody);
  mkdirSync(`${answers}/inbox-pages`, { recursive: true });

  for (const [n, page] of inboxPageBodies(inbox).entries()) {
    writeFileSync(`${answers}/inbox-pages/${n}.json`, page);
  }

  writeFileSync(`${answers}/tasks-delta.json`, tasksDeltaBody(agents));
  writeFileSync(`${answers}/tasks-whole.json`, tasksBody(plans, agents));
  mkdirSync(`${answers}/tasks-pages`, { recursive: true });

  for (const [n, page] of tasksPageBodies(plans, agents).entries()) {
    writeFileSync(`${answers}/tasks-pages/${n}.json`, page);
  }

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
