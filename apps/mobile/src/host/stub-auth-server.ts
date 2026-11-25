/**
 * stub-auth-server.ts -- the account service the Maestro flows sign in against, chosen by the `-authServer stub` launch argument: OAuth's token, identity, and revocation answered in the app, an authorization page that grants at once, and the account's two workspaces.
 *
 * A Release build on CI's simulator can neither reach the service with an
 * account nor complete the system's authentication session, whose HTTPS
 * callback only a signed app with a verified association catches. So a
 * stubbed run swaps both ends of the trip and nothing between them: the
 * sheet answers the authorization page with its own callback carrying a
 * code and the page's own state, as a provider that granted would, and
 * every request the host makes is answered by `stubAuthFetch`, stood up as
 * the global `fetch` (`standStubAuthServer`). Note that it replaces the
 * global rather than being handed to the runtime as Effect's
 * `FetchHttpClient.Fetch`, because a fiber the host forks outside the
 * runtime's own context, as the session's launch renewal is, reads the
 * global, and a renewal that reached the real service would sign the stub's
 * account out. The host itself runs as a live run
 * signed in through the `ios` client: the code exchanged, the identity
 * read, the tokens sealed in the settings file by the Keychain's cipher,
 * read back at the next launch, and revoked at sign-out. Anything else the
 * host reads answers not found, which the host reads as a read that failed
 * rather than a service it cannot reach.
 */

import { AUTH_SESSION_END, type AuthSession } from "@repo/credentials";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { INBOX_ITEMS_READ } from "@repo/features/inbox-live";
import { LIVE_POLL, LIVE_POLL_URL } from "@repo/features/live-wire";
import { TASK_LIST_READ } from "@repo/features/task-list-live";
import type { WireRecord } from "@repo/wire";
import { File, Paths } from "expo-file-system";
import { Settings } from "react-native";
import { probe } from "../launch-probe.js";

/** PROBE ONLY: whether the stub leaves the kept workspaces standing, so a seeded local copy draws as it was kept. */
const PROBE_KEEP_ROWS = Settings.get("probeKeepRows") === "true";

/**
 * PROBE ONLY: whether the stub answers the Inbox items read and the task list
 * as the service answered the developer's launches: the Inbox whole after
 * `PROBE_TIMING.INBOX_WHOLE_MS`, since a phone that kept only the first 1 MB
 * of a larger Inbox reads it whole at every launch, and the task list past its
 * kept sync id with a small delta; each poll after is held, then answered
 * with nothing moved past a sync id that moves, as the service's does. The
 * bodies are the seed's (`zz-probe-seed.test.ts`), read from the state root.
 */
const PROBE_ANSWERS = Settings.get("probeAnswers") === "true";

/** The sync ids the seed kept the task list at and answered the Inbox at (the seed's `PROBE_SYNC`). */
const PROBE_SYNC = { TASKS_KEPT: 1000, INBOX: 2000 } as const;

/** How long the stub takes to answer, as the service took on the developer's launch: the Inbox whole about 3 s, a small delta a few hundred ms, and a held poll until it ends with nothing moved. */
const PROBE_TIMING = { INBOX_WHOLE_MS: 3000, TASKS_DELTA_MS: 300, HELD_MS: 20_000 } as const;

/** Where the seed's answer bodies stand: beside the account's local database, under the host's state root. */
const PROBE_ANSWERS_DIR = "host/probe-answers";

/** Resolves after `ms`. */
function probeWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** The seed's answer body `name`, answered no sooner than `ms` after `askedAt`. */
async function probeAnswerFile(name: string, askedAt: number, ms: number): Promise<Response> {
  const text = await new File(Paths.document, `${PROBE_ANSWERS_DIR}/${name}`).text();
  await probeWait(ms - (performance.now() - askedAt));
  probe(`stub:answer:${name}`, { chars: text.length, ms: Math.round(performance.now() - askedAt) });

  return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
}

/** A held poll past `past` ended with nothing moved, every part of `parts` empty, past a sync id one on, as the service's settled id moves. */
async function probeHeldStill(parts: readonly string[], past: number, read: string): Promise<Response> {
  await probeWait(PROBE_TIMING.HELD_MS);
  const sync = { past: String(past), next: String(past + 1) };
  probe(`stub:held:${read}`, { past });

  return json({
    url: LIVE_POLL_URL,
    queries: Object.fromEntries(
      parts.map((part) => [
        part,
        {
          capability: "probe",
          queryFingerprint: part,
          expiresAt: 4_000_000_000_000,
          digest: `probe-${sync.next}`,
          rows: "[]",
          sync,
          gone: [],
        },
      ]),
    ),
  });
}

/**
 * PROBE: under `-probeMoving true` the stub answers as a busy account's
 * service does after a gap (STAG-3917's catch-up trace): "what waits" names
 * every task holding a thread, so each the list does not hold is read alone
 * (`task-rows`), and the task list and the Inbox keep moving, one agent a
 * second and one Inbox message every five, past each sync id. The bodies are
 * the seed's (`PROBE_OLD_HOLDERS=1`).
 */
const PROBE_MOVING = Settings.get("probeMoving") === "true";

/** How the moving account answers: the agent and Inbox moves' spacing, a read of one task, and "what waits" first and after. */
const PROBE_MOVE_TIMING = {
  AGENT_EVERY_MS: 1000,
  INBOX_EVERY_MS: 5000,
  TASK_ROWS_MS: 150,
  WAITS_FIRST_MS: 400,
  WAITS_AGAIN_MS: 30_000,
} as const;

/** The seed's answer file `name`, parsed once. */
const probeJsonOnce = (() => {
  const read = new Map<string, Promise<unknown>>();

  return (name: string): Promise<unknown> => {
    const held = read.get(name);
    if (held !== undefined) return held;
    const next = new File(Paths.document, `${PROBE_ANSWERS_DIR}/${name}`).text().then((text) => JSON.parse(text) as unknown);
    read.set(name, next);

    return next;
  };
})();

/** One part of a moving answer past `past`, its rows as the wire writes them. */
function probeMovedPart(name: string, rows: readonly unknown[], past: number) {
  const sync = { past: String(past), next: String(past + 1) };

  return {
    capability: "probe",
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: `probe-${sync.next}`,
    rows: JSON.stringify(rows),
    sync,
    gone: [],
  };
}

/** The task list past `past`: one of the newest agents said something, a second after the ask. */
async function probeTasksMoved(past: number): Promise<Response> {
  await probeWait(PROBE_MOVE_TIMING.AGENT_EVERY_MS);
  const agents = (await probeJsonOnce("moving-agents.json")) as Record<string, unknown>[];
  const delta = (await probeJsonOnce("tasks-delta.json")) as { taskWorkspaces?: readonly string[] };
  const n = past - PROBE_SYNC.TASKS_KEPT;
  const agent = { ...agents[n % agents.length], saidAt: Date.now() };
  probe("stub:moved:agent", { past });

  return json({
    url: LIVE_POLL_URL,
    queries: {
      tasks: probeMovedPart("tasks", [], past),
      agents: probeMovedPart("agents", [agent], past),
      issues: probeMovedPart("issues", [], past),
    },
    ...(delta.taskWorkspaces === undefined ? undefined : { taskWorkspaces: [...delta.taskWorkspaces] }),
  });
}

/** The Inbox past `past`: one thread took a new message, five seconds after the ask. */
async function probeInboxMoved(past: number): Promise<Response> {
  await probeWait(PROBE_MOVE_TIMING.INBOX_EVERY_MS);
  const moves = (await probeJsonOnce("inbox-moves.json")) as {
    stamp: Record<string, unknown>;
    item: Record<string, unknown>;
    message: Record<string, unknown>;
  }[];
  const n = past - PROBE_SYNC.INBOX;
  const move = moves[n % moves.length];
  if (move === undefined) return new Response(null, { status: 404 });
  const at = Date.now();
  const id = `${String(move.message.id).slice(0, 24)}${(0x100000 + n).toString(16).padStart(12, "0")}`;
  probe("stub:moved:inbox", { past });

  return json({
    url: LIVE_POLL_URL,
    queries: {
      stamps: probeMovedPart("stamps", [{ ...move.stamp, updatedAt: at, messages: Number(move.stamp.messages) + 1 + n }], past),
      items: probeMovedPart("items", [{ ...move.item, updatedAt: at }], past),
      messages: probeMovedPart("messages", [{ ...move.message, id, createdAt: at }], past),
      files: probeMovedPart("files", [], past),
    },
  });
}

/** How many times "what waits" was asked, so the first is answered at once and each after held, as the service holds one with nothing new. */
let probeWaitsAsked = 0;

/** "What waits" whole: every task holding a thread, at once the first time and after a hold every time after. */
async function probeWhatWaits(): Promise<Response> {
  probeWaitsAsked += 1;
  const askedAt = performance.now();
  probe("stub:asked:what-waits", { n: probeWaitsAsked });

  return probeAnswerFile(
    "what-waits.json",
    askedAt,
    probeWaitsAsked === 1 ? PROBE_MOVE_TIMING.WAITS_FIRST_MS : PROBE_MOVE_TIMING.WAITS_AGAIN_MS,
  );
}

/** One task read alone, as the seed wrote its answer, after a round trip; not found for one the seed wrote none for. */
async function probeTaskRows(id: string | null): Promise<Response> {
  const askedAt = performance.now();
  probe("stub:asked:task-rows");
  const file = new File(Paths.document, `${PROBE_ANSWERS_DIR}/task-rows/${id ?? "none"}.json`);

  if (id === null || !file.exists) {
    await probeWait(PROBE_MOVE_TIMING.TASK_ROWS_MS);

    return new Response(null, { status: 404 });
  }

  return probeAnswerFile(`task-rows/${id}.json`, askedAt, PROBE_MOVE_TIMING.TASK_ROWS_MS);
}

/** The Inbox items read: whole where it asks past no sync id of the stub's, held where it asks past one. */
function probeInboxAnswer(sync: string | null, askedAt: number): Promise<Response> {
  const past = Number(sync);

  if (Number.isInteger(past) && past >= PROBE_SYNC.INBOX) {
    if (PROBE_MOVING) return probeInboxMoved(past);

    return probeHeldStill(Object.keys(INBOX_ITEMS_READ.parts), past, "inbox");
  }
  probe("stub:asked:inbox-whole", { sync });

  return probeAnswerFile("inbox-whole.json", askedAt, PROBE_TIMING.INBOX_WHOLE_MS);
}

/** The task list read: the seed's delta past its kept sync id, held past a later one, and not found asked whole, which a launch with the list kept never asks. */
function probeTasksAnswer(sync: string | null, askedAt: number): Promise<Response> {
  const past = Number(sync);

  if (past === PROBE_SYNC.TASKS_KEPT) {
    return probeAnswerFile("tasks-delta.json", askedAt, PROBE_TIMING.TASKS_DELTA_MS);
  }

  if (Number.isInteger(past) && past > PROBE_SYNC.TASKS_KEPT) {
    if (PROBE_MOVING) return probeTasksMoved(past);

    return probeHeldStill(Object.keys(TASK_LIST_READ.parts), past, "tasks");
  }
  probe("stub:asked:tasks-whole", { sync });

  return Promise.resolve(new Response(null, { status: 404 }));
}

/** The account the stub signs in, as its identity answers it. */
export const STUB_ACCOUNT = {
  sub: "stub-account",
  email: "ada@example.com",
  name: "Ada Lovelace",
  // Note that the picture is GitHub's own Octocat, the one address a flow
  // reaches past the app, so the bar's photo and Settings' are drawn from a
  // real sign-in picture; where it does not load, the letters stand instead.
  picture: "https://avatars.githubusercontent.com/u/583231?v=4",
} as const;

/** The account's workspaces, as the live read's rows name them: its own first, and one it was invited to. */
const STUB_WORKSPACES = [
  {
    id: "stub-workspace-own",
    name: "Ada's workspace",
    slug: "ada",
    own: true,
    personal: true,
    role: "owner",
    memberCount: 1,
    photoVersion: null,
    ownerImage: null,
  },
  {
    id: "stub-workspace-team",
    name: "Analytical Engines",
    slug: "engines",
    own: false,
    personal: false,
    role: "member",
    memberCount: 4,
    photoVersion: null,
    ownerImage: null,
  },
] as const;

/** The paths the stub answers under the service's origin. */
const STUB_PATH = {
  TOKEN: "/api/auth/oauth2/token",
  USER_INFO: "/api/auth/oauth2/userinfo",
  REVOKE: "/api/auth/oauth2/revoke",
} as const;

/** The code the stub's authorization page grants, which its token endpoint takes. */
const STUB_CODE = "stub-code";

function json(body: WireRecord): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** One part of a polled live read, its rows inline only on the first read, since they never move. */
function polledPart(name: string, rows: readonly unknown[], unchanged: boolean) {
  return {
    capability: name,
    queryFingerprint: name,
    expiresAt: 4_000_000_000_000,
    digest: "1",
    ...(unchanged ? undefined : { rows: JSON.stringify(rows) }),
  };
}

/** The workspaces read, polled: its rows the first time and unchanged after, as a read past its digest answers. */
function workspacesAnswer(unchanged: boolean): Response {
  return json({
    url: LIVE_POLL_URL,
    queries: {
      workspaces: polledPart("workspaces", STUB_WORKSPACES, unchanged),
      installations: polledPart("installations", [], unchanged),
      experiments: polledPart("experiments", [], unchanged),
    },
  });
}

/** The service as the stub answers it: OAuth's three endpoints, the workspaces read, and not found for the rest. */
export const stubAuthFetch: typeof globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  switch (url.pathname) {
    case STUB_PATH.TOKEN:
      return Promise.resolve(
        json({ access_token: "stub-access", refresh_token: "stub-refresh", token_type: "Bearer" }),
      );
    case STUB_PATH.USER_INFO:
      return Promise.resolve(json(STUB_ACCOUNT));
    case STUB_PATH.REVOKE:
      return Promise.resolve(json({}));
    case HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS:
      if (!PROBE_ANSWERS) return Promise.resolve(new Response(null, { status: 404 }));

      return probeInboxAnswer(url.searchParams.get(LIVE_POLL.SYNC), performance.now());
    case HOSTED_SERVICE_PATH.LIVE_TASKS:
      if (!PROBE_ANSWERS) return Promise.resolve(new Response(null, { status: 404 }));

      return probeTasksAnswer(url.searchParams.get(LIVE_POLL.SYNC), performance.now());
    case HOSTED_SERVICE_PATH.LIVE_INBOX:
      if (!PROBE_MOVING) return Promise.resolve(new Response(null, { status: 404 }));

      return probeWhatWaits();
    case HOSTED_SERVICE_PATH.LIVE_TASK_ROWS:
      if (!PROBE_MOVING) return Promise.resolve(new Response(null, { status: 404 }));

      return probeTaskRows(url.searchParams.get("id"));
    case HOSTED_SERVICE_PATH.LIVE_WORKSPACES:
      if (PROBE_KEEP_ROWS) return Promise.resolve(new Response(null, { status: 404 }));

      return Promise.resolve(workspacesAnswer(url.searchParams.has(LIVE_POLL.AFTER)));
    default:
      return Promise.resolve(new Response(null, { status: 404 }));
  }
};

/** The authorization page, granted at once: the callback carrying the stub's code and the page's own state. */
export const stubAuthSession: AuthSession = {
  open: (page, callbackUrl) => {
    const callback = new URL(callbackUrl);
    callback.searchParams.set("code", STUB_CODE);
    callback.searchParams.set("state", new URL(page).searchParams.get("state") ?? "");

    return Promise.resolve({ end: AUTH_SESSION_END.REDIRECTED, url: callback.href });
  },
  dismiss: () => undefined,
};

/** Answers every request of this launch from the stub, in place of the network. */
export function standStubAuthServer(): void {
  globalThis.fetch = stubAuthFetch;
}
