/**
 * busy-account-server.ts -- the service as the rig's busy account meets it after a gap, under `-busyAccount true` beside `-authServer stub`: the Inbox read whole, the task list past its kept sync id, "what waits" naming every task holding a thread, each old task read alone, and an account that keeps moving, one agent a second and one Inbox message every five.
 *
 * It answers from the files the busy-account seed wrote
 * (`tools/busy-account/seed.ts`), which the rig copies under the host's
 * state root beside the local copy they match
 * (`apps/mobile/scripts/busy-account.sh`), at the waits the service was
 * seen to answer with: the Inbox whole about 3 s after the ask, a small
 * delta a few hundred milliseconds, and a held poll with nothing new about
 * 25 s, which the moving account's own moves cut short. It keeps the
 * workspaces the local copy kept by answering their read not found, so a
 * launch draws its kept list as a phone that was away does. A read the
 * seed answered nothing for is not found, as the stub answers every other.
 *
 * A launch from an empty store (`busy-account.sh --empty`) reads the task
 * list whole as well. To a build that reads pages, the Inbox and the task
 * list whole come a page at a time (`PAGED`); a page, and the task list
 * whole in one answer, wait a round trip and the time their bytes take at
 * the rate the Inbox whole was seen to arrive at (`BUSY_RATE`), so the two
 * ways are timed on one network.
 *
 * It takes the two Inbox writes a person makes most, a thread marked read
 * or unread and a thread settled by a nod or a close, as the service does:
 * at once, without a transaction, so the client takes what it answered in
 * place of its read's. Each is kept in a file beside the answers
 * (`written.json`), since the stub runs in the app and a relaunch would
 * otherwise forget it, and laid over every row the Inbox is answered with
 * from then on: the next answer past a sync id carries each thread written
 * since it last carried it, and every later move of the thread keeps it.
 */

import { HOSTED_SERVICE_PATH } from "@repo/features";
import { HOSTED_API_VERSION } from "@repo/features/client-identity";
import { INBOX_ITEMS_READ, inboxOfLiveRows } from "@repo/features/inbox-live";
import { INBOX_STATUS, inboxItemSchema } from "@repo/features/inbox-wire";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import { HTTP_METHOD, type WireRecord, type WireValue } from "@repo/wire";
import { Schema } from "effect";
import { File, Paths } from "expo-file-system";
import { hostStateRootIn } from "./expo-file-system.js";

/** The sync ids the seed kept the task list at and answered the Inbox whole at (the seed's `BUSY_SYNC`). */
const BUSY_SYNC = { TASKS_KEPT: 1000, INBOX: 2000 } as const;

/** How long each read waits before it answers, in milliseconds. */
const BUSY_WAIT = {
  INBOX_WHOLE: 3000,
  TASKS_DELTA: 300,
  AGENT_EVERY: 1000,
  INBOX_EVERY: 5000,
  TASK_ROWS: 150,
  WAITS_FIRST: 400,
  WAITS_AGAIN: 30_000,
} as const;

/** The first hosted API version whose builds read a whole answer in pages, as the service's (`packages/service/src/live/live-pages.ts`). */
const PAGED = { API_VERSION: 10 } as const;

/** The network an answer the service was not seen to answer crosses: a round trip, and the bytes a millisecond the Inbox whole arrived at (4.8 MB in 3 s). */
const BUSY_RATE = { ROUND_TRIP: 250, BYTES_A_MS: 1600 } as const;

/** A page of a whole answer as the seed numbers it: digits alone, so no page reaches past its folder. */
const PAGE_NUMBER = /^\d{1,4}$/;

/** The seed's answers, beside the local copy under the host's state root. */
const ANSWERS = `${hostStateRootIn(Paths.document.uri)}/busy-account`;

/** One thread's move as the seed wrote it: its stamp, item, and a message of its own, as the wire writes them. */
type InboxMove = {
  readonly stamp: WireRecord;
  readonly item: WireRecord;
  readonly message: WireRecord;
};

/** The task list's delta past its kept id, as much of it as the moves carry on: the workspaces it reaches. */
type TasksDelta = {
  readonly taskWorkspaces?: readonly string[];
};

/** Resolves after `ms`. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** The seed's file `name` under the answers, or none where it wrote none. */
function answerFile(name: string): File | undefined {
  const file = new File(`file://${ANSWERS}/${name}`);

  return file.exists ? file : undefined;
}

/** Each answer file read once, parsed, by its name. */
const parsed = new Map<string, Promise<WireValue>>();

/** The seed's file `name`, parsed once for the launch. */
function answerOnce(name: string): Promise<WireValue> {
  const held = parsed.get(name);

  if (held !== undefined) return held;

  const next = (answerFile(name)?.text() ?? Promise.resolve("null")).then(
    // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, and each row in it was decoded by the build's own schemas as it was written.
    (text) => JSON.parse(text) as WireValue,
  );

  parsed.set(name, next);

  return next;
}

function json(body: WireRecord): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The seed's file `name` as the answer, no sooner than `ms` after `askedAt`; not found where it wrote none. */
async function answered(name: string, askedAt: number, ms: number): Promise<Response> {
  const file = answerFile(name);
  const text = file === undefined ? undefined : await file.text();
  await wait(ms - (performance.now() - askedAt));

  return text === undefined
    ? new Response(null, { status: 404 })
    : new Response(text, { status: 200, headers: { "content-type": "application/json" } });
}

/** The seed's file `name` as the answer, no sooner than its bytes cross `BUSY_RATE`'s network after `askedAt`; not found where it wrote none. */
async function answeredAtRate(name: string, askedAt: number): Promise<Response> {
  const text = await answerFile(name)?.text();

  if (text === undefined) return new Response(null, { status: 404 });
  await wait(
    BUSY_RATE.ROUND_TRIP + text.length / BUSY_RATE.BYTES_A_MS - (performance.now() - askedAt),
  );

  return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
}

/** Whether this build reads a whole answer in pages: it reads them from the version it is built at. */
const READS_PAGES = HOSTED_API_VERSION >= PAGED.API_VERSION;

/** The page `page` of the whole answer the seed wrote under `folder`, or its first where none is named; not found for one of no number. */
function pageAnswer(folder: string, page: string | null, askedAt: number): Promise<Response> {
  return page === null || PAGE_NUMBER.test(page)
    ? answeredAtRate(`${folder}/${page ?? "0"}.json`, askedAt)
    : Promise.resolve(new Response(null, { status: 404 }));
}

/** A thread as a member wrote it this launch or an earlier one: read or not, settled how and when, and whether an answer past a sync id carried it since. */
interface Written {
  readonly unread?: boolean;
  readonly status?: string;
  readonly settledAt?: number;
  readonly revision?: number;
  readonly updatedAt?: number;
  readonly carried: boolean;
}

/** Every thread written, by its id, as `written.json` keeps it. */
let written: Map<string, Written> | undefined;

/** The file the writes are kept in, beside the answers. */
const WRITTEN_FILE = `file://${ANSWERS}/written.json`;

/** What `file` kept of the writes: none where it holds none, or holds what no longer reads, as one cut short by a quit mid-write. */
function keptWrites(file: File): Record<string, Written> {
  if (!file.exists) return {};

  try {
    // SAFETY: the file is this module's own, written by `keepWritten` as this shape.
    return JSON.parse(file.textSync()) as Record<string, Written>;
  } catch {
    return {};
  }
}

/** The threads written, read from their file the first time they are asked for this launch. */
function writtenNow(): Map<string, Written> {
  if (written !== undefined) return written;
  written = new Map(Object.entries(keptWrites(new File(WRITTEN_FILE))));

  return written;
}

/** `writes` kept for the next launch. */
function keepWritten(writes: Map<string, Written>): void {
  new File(WRITTEN_FILE).writeSync(JSON.stringify(Object.fromEntries(writes)));
}

/** `row`, a stamp's or an item's, with what a member wrote on its thread laid over it. */
function overWritten(row: WireRecord): WireRecord {
  const write = writtenNow().get(String(row.id));

  if (write === undefined) return row;

  return {
    ...row,
    ...(write.unread === undefined ? undefined : { unread: write.unread }),
    // Note that an item's row carries the reader's own mark beside the read state, which a mark unread sets too, so a thread closed and marked unread stays in Open.
    ...(write.unread === undefined || !("settledAt" in row)
      ? undefined
      : { markedUnread: write.unread }),
    ...(write.status === undefined ? undefined : { status: write.status }),
    ...(write.revision === undefined ? undefined : { revision: write.revision }),
    ...(write.updatedAt === undefined ? undefined : { updatedAt: write.updatedAt }),
    ...(write.settledAt === undefined || !("settledAt" in row)
      ? undefined
      : { settledAt: write.settledAt }),
  };
}

/** The whole Inbox answer as the seed wrote it, its parts' rows each a JSON array. */
type WholeBody = {
  readonly queries: Readonly<Record<string, WireRecord & { readonly rows: string }>>;
};

/** The whole Inbox answer's rows of each part, as the seed wrote them, parsed once for the launch. */
let wholeParsed: Promise<Readonly<Record<string, readonly WireRecord[]>>> | undefined;

/** The whole Inbox answer's rows of each part, as the seed wrote them. */
function wholeRows(): Promise<Readonly<Record<string, readonly WireRecord[]>>> {
  wholeParsed ??= answerOnce("inbox-whole.json").then((body) =>
    Object.fromEntries(
      // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, each part's rows a JSON array of rows as the wire writes them.
      Object.entries((body as WholeBody).queries).map(([part, query]) => [
        part,
        JSON.parse(query.rows) as WireRecord[],
      ]),
    ),
  );

  return wholeParsed;
}

/**
 * The whole Inbox answer, no sooner than `ms` after `askedAt`: the seed's
 * file as it stands where nothing was written, and otherwise its stamps and
 * items with each write laid over them, every write then carried.
 */
async function wholeAnswer(askedAt: number, ms: number): Promise<Response> {
  const writes = writtenNow();

  if (writes.size === 0) return answered("inbox-whole.json", askedAt, ms);
  // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build.
  const body = (await answerOnce("inbox-whole.json")) as WholeBody;
  const rows = await wholeRows();

  const queries = Object.fromEntries(
    Object.entries(body.queries).map(([part, query]) => [
      part,
      part === "stamps" || part === "items"
        ? { ...query, rows: JSON.stringify((rows[part] ?? []).map(overWritten)) }
        : query,
    ]),
  );

  for (const [threadId, write] of writes) writes.set(threadId, { ...write, carried: true });
  keepWritten(writes);
  await wait(ms - (performance.now() - askedAt));

  return json({ ...body, queries });
}

/** The rows of every part the whole answer holds for the thread `id`, each with what was written on it laid over it. */
async function threadRows(id: string): Promise<Readonly<Record<string, readonly WireRecord[]>>> {
  const rows = await wholeRows();
  const messages = (rows.messages ?? []).filter((message) => message.itemId === id);
  const messageIds = new Set(messages.map((message) => message.id));

  return {
    stamps: (rows.stamps ?? []).filter((stamp) => stamp.id === id).map(overWritten),
    items: (rows.items ?? []).filter((item) => item.id === id).map(overWritten),
    messages,
    files: (rows.files ?? []).filter((file) => messageIds.has(file.messageId)),
  };
}

/** The thread `id` as a nod or a close answers it, the wire's item, settled as written. */
async function settledItem(id: string): Promise<WireValue | undefined> {
  const rows = await threadRows(id);
  const [item] = inboxOfLiveRows(Schema.decodeUnknownSync(INBOX_ITEMS_READ.rows)(rows));

  return item === undefined ? undefined : Schema.encodeSync(inboxItemSchema)(item);
}

/** An Inbox write's path: a thread's id, and its read mark or its close where it names one. */
const INBOX_WRITE_PATH = /^\/api\/inbox\/([0-9a-f-]{36})(\/read|\/close)?$/;

/**
 * An Inbox write a member made, taken at once and kept: a read mark set or
 * cleared, or a nod or a close settling the thread; none for any other
 * request.
 */
function inboxWrite(request: Request, url: URL): Promise<Response> | undefined {
  const matched = INBOX_WRITE_PATH.exec(url.pathname);
  const id = matched?.[1];

  if (id === undefined) return undefined;
  const writes = writtenNow();
  const was = writes.get(id) ?? { carried: true };
  const rest = matched?.[2];

  if (
    rest === "/read" &&
    (request.method === HTTP_METHOD.PUT || request.method === HTTP_METHOD.DELETE)
  ) {
    const unread = request.method === HTTP_METHOD.DELETE;
    writes.set(id, { ...was, unread, carried: false });
    keepWritten(writes);

    return Promise.resolve(json({ id, unread }));
  }

  if (request.method !== HTTP_METHOD.POST || rest === "/read") return undefined;

  return threadRows(id).then(async ({ items }) => {
    const row = items?.[0];

    if (row === undefined) return new Response(null, { status: 404 });
    const at = Date.now();

    writes.set(id, {
      ...was,
      unread: false,
      status: rest === "/close" ? INBOX_STATUS.CLOSED : INBOX_STATUS.ANSWERED,
      settledAt: at,
      updatedAt: at,
      revision: Number(row.revision) + 1,
      carried: false,
    });
    keepWritten(writes);
    const item = await settledItem(id);

    return item === undefined ? new Response(null, { status: 404 }) : json({ item, taken: true });
  });
}

/** One part of an answer past the sync id `past`, its rows as the wire writes them. */
function movedPart(name: string, rows: readonly unknown[], past: number) {
  const sync = { past: String(past), next: String(past + 1) };

  return {
    capability: "busy-account",
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: `busy-${sync.next}`,
    rows: JSON.stringify(rows),
    sync,
    gone: [],
  };
}

/** The task list past `past`: the kept list's delta past its kept id, whole where it asks past no id of the seed's, as a launch from an empty store does, in pages to a build that reads them, and after that one of the newest agents said something, a second after the ask. */
async function tasksAnswer(url: URL, askedAt: number): Promise<Response> {
  const past = Number(url.searchParams.get(LIVE_POLL.SYNC));
  const page = url.searchParams.get(LIVE_POLL.PAGE);

  if (page !== null && READS_PAGES) return pageAnswer("tasks-pages", page, askedAt);

  if (past === BUSY_SYNC.TASKS_KEPT)
    return answered("tasks-delta.json", askedAt, BUSY_WAIT.TASKS_DELTA);

  if (!Number.isInteger(past) || past < BUSY_SYNC.TASKS_KEPT) {
    return READS_PAGES
      ? pageAnswer("tasks-pages", null, askedAt)
      : answeredAtRate("tasks-whole.json", askedAt);
  }

  await wait(BUSY_WAIT.AGENT_EVERY);
  // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, and each row in it was decoded by the build's own schemas as it was written.
  const agents = (await answerOnce("moving-agents.json")) as readonly WireRecord[];
  // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, and each row in it was decoded by the build's own schemas as it was written.
  const delta = (await answerOnce("tasks-delta.json")) as TasksDelta;
  const agent = agents[(past - BUSY_SYNC.TASKS_KEPT) % agents.length];

  return json({
    url: LIVE_POLL_URL,
    queries: {
      tasks: movedPart("tasks", [], past),
      agents: movedPart(
        "agents",
        agent === undefined ? [] : [{ ...agent, saidAt: Date.now() }],
        past,
      ),
      issues: movedPart("issues", [], past),
    },
    ...(delta.taskWorkspaces === undefined
      ? undefined
      : { taskWorkspaces: [...delta.taskWorkspaces] }),
  });
}

/** The Inbox past `past`: whole where it asks past no id of the seed's, in pages to a build that reads them, and after that one thread took a new message, five seconds after the ask. */
async function inboxAnswer(url: URL, askedAt: number): Promise<Response> {
  const past = Number(url.searchParams.get(LIVE_POLL.SYNC));
  const page = url.searchParams.get(LIVE_POLL.PAGE);
  const whole = page !== null || !Number.isInteger(past) || past < BUSY_SYNC.INBOX;

  // Note that a build reads pages from the version it is built at, so the stub of a build that reads none answers it in one.
  if (whole && READS_PAGES) return pageAnswer("inbox-pages", page, askedAt);

  if (whole) return wholeAnswer(askedAt, BUSY_WAIT.INBOX_WHOLE);

  await wait(BUSY_WAIT.INBOX_EVERY);
  // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, and each row in it was decoded by the build's own schemas as it was written.
  const moves = (await answerOnce("inbox-moves.json")) as readonly InboxMove[];
  const n = past - BUSY_SYNC.INBOX;
  const move = moves[n % moves.length];

  if (move === undefined) return new Response(null, { status: 404 });
  const at = Date.now();
  // Note that each thread written since the last answer past a sync id rides on this one, so the client's kept rows carry the write on the service's word.
  const writes = writtenNow();
  const fresh = [...writes].flatMap(([threadId, write]) => (write.carried ? [] : [threadId]));
  const carriedRows = await Promise.all(fresh.map((threadId) => threadRows(threadId)));

  for (const threadId of fresh) {
    const write = writes.get(threadId);

    if (write !== undefined) writes.set(threadId, { ...write, carried: true });
  }

  if (fresh.length > 0) keepWritten(writes);
  // Note that each move's message takes an id of its own, the seed's with its last group the move's number, so a thread taking a second move takes a second message.
  const id = `${String(move.message.id).slice(0, 24)}${(0x100000 + n).toString(16).padStart(12, "0")}`;

  return json({
    url: LIVE_POLL_URL,
    queries: {
      stamps: movedPart(
        "stamps",
        [
          ...carriedRows.flatMap((rows) => rows.stamps ?? []),
          {
            ...overWritten(move.stamp),
            updatedAt: at,
            // Note that a thread takes one message a move, and the moves come round to it again once a pass through them is done, so its count is its seed's, this move's, and one for each pass before.
            messages: Number(move.stamp.messages) + 1 + Math.floor(n / moves.length),
          },
        ],
        past,
      ),
      items: movedPart(
        "items",
        [
          ...carriedRows.flatMap((rows) => rows.items ?? []),
          { ...overWritten(move.item), updatedAt: at },
        ],
        past,
      ),
      messages: movedPart(
        "messages",
        [
          ...carriedRows.flatMap((rows) => rows.messages ?? []),
          { ...move.message, id, createdAt: at },
        ],
        past,
      ),
      files: movedPart(
        "files",
        carriedRows.flatMap((rows) => rows.files ?? []),
        past,
      ),
    },
  });
}

/** How many times "what waits" was asked this launch, so the first is answered at once and each after held, as the service holds one with nothing new. */
let waitsAsked = 0;

/** "What waits" whole: every task holding a thread. */
function whatWaitsAnswer(askedAt: number): Promise<Response> {
  waitsAsked += 1;

  return answered(
    "what-waits.json",
    askedAt,
    waitsAsked === 1 ? BUSY_WAIT.WAITS_FIRST : BUSY_WAIT.WAITS_AGAIN,
  );
}

/** A task's id as the seed names its file: a UUID and nothing else, so no id reaches past the answers' folder. */
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One old task read alone, after a round trip; not found for one the seed wrote none for. */
function taskRowsAnswer(id: string | null, askedAt: number): Promise<Response> {
  return id !== null && TASK_ID.test(id)
    ? answered(`task-rows/${id}.json`, askedAt, BUSY_WAIT.TASK_ROWS)
    : Promise.resolve(new Response(null, { status: 404 }));
}

/**
 * The busy account's answer to `url`, or none where the stub answers it as
 * it does for any account: its sign-in, and every read the seed has no
 * answer for.
 */
export function busyAccountAnswer(request: Request): Promise<Response> | undefined {
  const url = new URL(request.url);
  const askedAt = performance.now();

  switch (url.pathname) {
    case HOSTED_SERVICE_PATH.LIVE_WORKSPACES:
      return Promise.resolve(new Response(null, { status: 404 }));
    case HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS:
      return inboxAnswer(url, askedAt);
    case HOSTED_SERVICE_PATH.LIVE_TASKS:
      return tasksAnswer(url, askedAt);
    case HOSTED_SERVICE_PATH.LIVE_INBOX:
      return whatWaitsAnswer(askedAt);
    case HOSTED_SERVICE_PATH.LIVE_TASK_ROWS:
      return taskRowsAnswer(url.searchParams.get("id"), askedAt);
    default:
      return inboxWrite(request, url);
  }
}
