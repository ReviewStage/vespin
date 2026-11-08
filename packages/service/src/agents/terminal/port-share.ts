/**
 * port-share.ts -- one port of an agent's running sandbox shared by a public link: the helper that serves it, the public route opened to the helper, and the row that keeps the share.
 *
 * A sandbox serves a port on a public route, which anyone holding its
 * address may open. Only the helper's own fixed port is ever routed: the
 * helper, one small Node process started detached in the running sandbox,
 * pipes each connection to `127.0.0.1` at the port shared, and rewrites the
 * `Host` and `Origin` request headers to `localhost` at that port as they
 * pass, so a dev server that answers only on localhost still answers. A
 * WebSocket upgrade passes as any other bytes do. The port shared is read
 * from a file in the workspace's state folder at each connection, so
 * sharing another port rewrites the file and the helper already running
 * serves it; a second helper finds the port taken and leaves. Each
 * connection writes the time to a file beside it, the share's last visit,
 * which the sweep reads to close a link no one has visited lately
 * (`maintenance/port-share-sweep.ts`); starting the helper counts as one.
 *
 * The share is kept in the store by the agent's session
 * (`@repo/database/models/sandbox-port-shares`), which the sweep lists, and
 * never on the sandbox, whose tags are left as they stand. Closing it closes
 * the route, removes the folder, which the helper notices and leaves, and
 * forgets the row. A row the store could not write or forget fails the call
 * as the sandbox unavailable, so a caller retries it as any other. Nothing
 * here reads a byte the link carries.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { forgetPortShare, recordPortShare } from "@repo/database/models/sandbox-port-shares";
import {
  type CommandAsk,
  type ListedSandbox,
  SANDBOX_CALL,
  type SandboxError,
  type SandboxRunning,
  type SandboxService,
  SandboxUnavailable,
} from "@repo/sandbox";
import { DateTime, Duration, Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";

export const PORT_SHARE = {
  /** The one port routed publicly: the helper's, which no dev server is likely to take. */
  HELPER_PORT: 48_211,
  /** How long a link stays open past its last visit. */
  IDLE: Duration.minutes(10),
  /** The folder the port shared and the last visit are written in. */
  FOLDER: `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${SANDBOX_STATE_FOLDER}/share`,
} as const;

/** The files in the folder: the port shared, and the last visit in epoch milliseconds. */
const SHARE_FILE = { PORT: "port", VISIT: "visit" } as const;

/** The helper, as Node runs it with the port it listens on and its folder as its arguments. */
export const PORT_SHARE_HELPER_SOURCE = `"use strict";
const net = require("node:net");
const fs = require("node:fs");
const { Transform } = require("node:stream");
const listen = Number(process.argv[1]);
const folder = process.argv[2];
const portFile = folder + "/${SHARE_FILE.PORT}";
const visited = () => { try { fs.writeFileSync(folder + "/${SHARE_FILE.VISIT}", String(Date.now())); } catch {} };
const target = () => { try { return Number(fs.readFileSync(portFile, "utf8")); } catch { return 0; } };
const localhost = (port) => new Transform({
  transform(bytes, _, done) {
    const head = bytes.toString("latin1").replace(/\\r\\n(host|origin):[^\\r\\n]*/gi, (_, name) =>
      name.toLowerCase() === "host" ? "\\r\\n" + name + ": localhost:" + port : "\\r\\n" + name + ": http://localhost:" + port);
    done(null, Buffer.from(head, "latin1"));
  },
});
const server = net.createServer((client) => {
  const port = target();
  if (!Number.isInteger(port) || port <= 0) return client.destroy();
  visited();
  const app = net.connect(port, "127.0.0.1");
  client.pipe(localhost(port)).pipe(app);
  app.pipe(client);
  client.on("error", () => app.destroy());
  app.on("error", () => client.destroy());
  client.on("close", () => app.destroy());
  // Note that the visitor's side closes only once the bytes still queued for it are written.
  app.on("close", () => client.destroySoon());
});
visited();
server.on("error", () => process.exit(0));
server.listen(listen, "0.0.0.0");
setInterval(() => { if (!fs.existsSync(portFile)) process.exit(0); }, 2000);
`;

/** Writes the port shared and starts the helper in the workspace, its output dropped. */
function startHelper(port: number): CommandAsk {
  const workspace = REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE;
  return {
    command: "sh",
    args: [
      "-c",
      `cd ${workspace} && ${LINK_SANDBOX_STATE_FOLDER} && mkdir -p ${PORT_SHARE.FOLDER} && printf %s "$1" >${PORT_SHARE.FOLDER}/${SHARE_FILE.PORT} && exec node --no-warnings -e "$2" "$3" ${PORT_SHARE.FOLDER} >/dev/null 2>&1`,
      "sh",
      String(port),
      PORT_SHARE_HELPER_SOURCE,
      String(PORT_SHARE.HELPER_PORT),
    ],
  };
}

/** Reads the port shared, then the last visit, one a line. */
function readShare(): CommandAsk {
  return {
    command: "sh",
    args: [
      "-c",
      `cat ${PORT_SHARE.FOLDER}/${SHARE_FILE.PORT}; echo; cat ${PORT_SHARE.FOLDER}/${SHARE_FILE.VISIT}`,
    ],
  };
}

/** A store failure keeping the share's row, as the sandbox unavailable, in words naming no value. */
function kept<A>(
  effect: Effect.Effect<A, StoreFailure, DatabaseServices>,
): Effect.Effect<A, SandboxError, DatabaseServices> {
  return Effect.mapError(
    effect,
    () => new SandboxUnavailable({ call: SANDBOX_CALL.PORTS, detail: "the share's row" }),
  );
}

/** The share as the folder holds it: the port shared and its last visit; none where it holds no port. */
export function readSharedPort(
  api: SandboxService,
  running: SandboxRunning,
): Effect.Effect<{ readonly port: number; readonly visitedAt: number } | undefined, SandboxError> {
  return Effect.map(api.run(running, readShare()), (run) => {
    const [port, visitedAt] = run.stdout.split("\n").map(Number);
    return port === undefined || !Number.isInteger(port) || port <= 0
      ? undefined
      : { port, visitedAt: visitedAt ?? 0 };
  });
}

/**
 * Shares the port from the session's running sandbox, replacing any shared
 * before, answering its public link. Note that the row is kept before the
 * helper starts, because a share the sweep cannot list stays open for as
 * long as its sandbox, while a row whose share never opened is only closed
 * again by the sweep.
 */
export function sharePort(
  api: SandboxService,
  sessionId: string,
  sandbox: ListedSandbox,
  running: SandboxRunning,
  port: number,
): Effect.Effect<string, SandboxError, DatabaseServices> {
  return Effect.gen(function* () {
    yield* kept(recordPortShare(sessionId, port, yield* DateTime.nowAsDate));
    yield* api.start(running, { ...startHelper(port), env: {}, sudo: false });
    const routes = yield* api.updatePorts(sandbox.name, [PORT_SHARE.HELPER_PORT]);
    const route = routes.find((each) => each.port === PORT_SHARE.HELPER_PORT);
    if (route === undefined) {
      return yield* new SandboxUnavailable({ call: SANDBOX_CALL.PORTS, detail: "no route" });
    }
    return route.url;
  });
}

/** Closes the session's share: no public route, and, while the sandbox runs, the helper gone with its folder, then its row forgotten. */
export function unsharePort(
  api: SandboxService,
  sessionId: string,
  sandbox: ListedSandbox,
  running: SandboxRunning | undefined,
): Effect.Effect<void, SandboxError, DatabaseServices> {
  return Effect.gen(function* () {
    yield* api.updatePorts(sandbox.name, []);
    if (running !== undefined)
      yield* api.run(running, { command: "rm", args: ["-rf", PORT_SHARE.FOLDER] });
    yield* kept(forgetPortShare(sessionId));
  });
}

/** The port the running sandbox shares now and its link: its helper's route and the port the helper serves. */
export function sharedPortOf(
  api: SandboxService,
  sandbox: ListedSandbox,
  running: SandboxRunning,
): Effect.Effect<{ readonly port: number; readonly url: string } | null, SandboxError> {
  return Effect.gen(function* () {
    const named = yield* api.get(sandbox.name);
    const route = named?.routes?.find((each) => each.port === PORT_SHARE.HELPER_PORT);
    if (route === undefined) return null;
    const share = yield* readSharedPort(api, running);
    return share === undefined ? null : { port: share.port, url: route.url };
  });
}
