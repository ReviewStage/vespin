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
 */

import { HOSTED_SERVICE_PATH } from "@repo/features";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WireRecord, WireValue } from "@repo/wire";
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

/** The task list past `past`: the kept list's delta past its kept id, and after that one of the newest agents said something, a second after the ask. */
async function tasksAnswer(sync: string | null, askedAt: number): Promise<Response> {
  const past = Number(sync);

  if (past === BUSY_SYNC.TASKS_KEPT)
    return answered("tasks-delta.json", askedAt, BUSY_WAIT.TASKS_DELTA);

  // Note that a read asked whole is one a launch with the list kept never asks, so it answers not found, as the rest of the service does.
  if (!Number.isInteger(past) || past < BUSY_SYNC.TASKS_KEPT)
    return new Response(null, { status: 404 });
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

/** The Inbox past `past`: whole where it asks past no id of the seed's, and after that one thread took a new message, five seconds after the ask. */
async function inboxAnswer(sync: string | null, askedAt: number): Promise<Response> {
  const past = Number(sync);

  if (!Number.isInteger(past) || past < BUSY_SYNC.INBOX) {
    return answered("inbox-whole.json", askedAt, BUSY_WAIT.INBOX_WHOLE);
  }

  await wait(BUSY_WAIT.INBOX_EVERY);
  // SAFETY: the file is the seed's, written as this shape by `tools/busy-account/seed.ts` from the same commit as this build, and each row in it was decoded by the build's own schemas as it was written.
  const moves = (await answerOnce("inbox-moves.json")) as readonly InboxMove[];
  const n = past - BUSY_SYNC.INBOX;
  const move = moves[n % moves.length];

  if (move === undefined) return new Response(null, { status: 404 });
  const at = Date.now();
  // Note that each move's message takes an id of its own, the seed's with its last group the move's number, so a thread taking a second move takes a second message.
  const id = `${String(move.message.id).slice(0, 24)}${(0x100000 + n).toString(16).padStart(12, "0")}`;

  return json({
    url: LIVE_POLL_URL,
    queries: {
      stamps: movedPart(
        "stamps",
        [
          {
            ...move.stamp,
            updatedAt: at,
            // Note that a thread takes one message a move, and the moves come round to it again once a pass through them is done, so its count is its seed's, this move's, and one for each pass before.
            messages: Number(move.stamp.messages) + 1 + Math.floor(n / moves.length),
          },
        ],
        past,
      ),
      items: movedPart("items", [{ ...move.item, updatedAt: at }], past),
      messages: movedPart("messages", [{ ...move.message, id, createdAt: at }], past),
      files: movedPart("files", [], past),
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
export function busyAccountAnswer(url: URL): Promise<Response> | undefined {
  const askedAt = performance.now();
  const sync = url.searchParams.get(LIVE_POLL.SYNC);

  switch (url.pathname) {
    case HOSTED_SERVICE_PATH.LIVE_WORKSPACES:
      return Promise.resolve(new Response(null, { status: 404 }));
    case HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS:
      return inboxAnswer(sync, askedAt);
    case HOSTED_SERVICE_PATH.LIVE_TASKS:
      return tasksAnswer(sync, askedAt);
    case HOSTED_SERVICE_PATH.LIVE_INBOX:
      return whatWaitsAnswer(askedAt);
    case HOSTED_SERVICE_PATH.LIVE_TASK_ROWS:
      return taskRowsAnswer(url.searchParams.get("id"), askedAt);
    default:
      return undefined;
  }
}
