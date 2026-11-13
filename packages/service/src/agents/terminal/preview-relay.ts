/**
 * preview-relay.ts -- the relay a shared port is served through in its sandbox: a small Node server that passes each request on to the port on the sandbox's loopback, its Host header turned to `localhost`, and that brings the port's server back after the sandbox wakes.
 *
 * A dev server often answers only the hosts it was told of: Vite refuses
 * any other with "Blocked request. This host is not allowed", and a shared
 * port's preview reaches the sandbox at its route on Vercel's sandbox domain.
 * Every such server answers `localhost`, so the route goes to this relay
 * instead of the port itself, and the relay hands the port each request as
 * if it came from the sandbox's own loopback, a WebSocket's upgrade among
 * them. It runs detached, as root, for as long as the share stands, one at a
 * time, found again by the marker its command line carries.
 *
 * A stopped sandbox keeps its drive and nothing else, so its dev server is
 * gone when it wakes, made again from the image on that drive. When a port
 * is shared, the relay records how the server on it was started, in a file
 * on the agent's own drive beside the checkout's record (`RECORD_PATH`): the
 * command the agent's shell ran (the listener's ancestor whose parent is a
 * shell, or the listener itself where no shell stands above it), its folder, its user, and its `PATH` and `HOME`, never the rest of
 * its environment, which may carry credentials. When a preview wakes the
 * sandbox, the relay is started from that record instead: it runs the
 * command again where nothing listens on the port, and answers 503 with
 * `STARTING_HEADER` until the server takes connections. A server that stops
 * while the sandbox runs is never started again: the relay answers
 * `NOT_RUNNING_HEADER` for it instead.
 */

import type { CommandAsk, DetachedCommandAsk } from "@repo/sandbox";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";

/** What marks the relay's process, so a new share or a stop ends the one before. */
const RELAY_MARKER = "vespin-preview-relay";

/** How far above the shared port its relay listens: the shared port is below it, the relay at or past it. */
const RELAY_OFFSET = 32_768;

/** Where the shared port and how its server was started are kept: in our state folder on the agent's own drive, which a sandbox made again mounts. */
const RECORD_PATH = `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${SANDBOX_STATE_FOLDER}/preview.json`;

/** How the relay is started: recording the server on the port at a share, or bringing it back from the record at a wake. */
const RELAY_MODE = { RECORD: "record", RESTORE: "restore" } as const;

type RelayMode = (typeof RELAY_MODE)[keyof typeof RELAY_MODE];

/** The response header the relay answers with while a server it started again after a wake is still coming up. */
export const STARTING_HEADER = "x-vespin-preview-starting";

/** The response header the relay answers with where nothing listens on the shared port and it started nothing: the server stopped while the sandbox ran. */
export const NOT_RUNNING_HEADER = "x-vespin-preview-not-running";

/** The relay as Node runs it, its arguments the marker, the mode, the record's path, and, when recording, the port. */
const RELAY_SOURCE = `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const [, mode, recordPath, asked] = process.argv.slice(1);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "fish"]);
const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const parentOf = (pid) => Number(read("/proc/" + pid + "/stat").replace(/^.*\\) /s, "").split(" ")[1]);
const nameOf = (pid) => read("/proc/" + pid + "/comm").trim();
const idOf = (pid, field) => Number((read("/proc/" + pid + "/status").match(new RegExp("^" + field + ":\\\\s+(\\\\d+)", "m")) || [])[1]);
const listenerOf = (port) => {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of read(table).split("\\n").slice(1)) {
      const cells = line.trim().split(/\\s+/);
      if (cells[1] && cells[1].endsWith(":" + hex) && cells[3] === "0A") inodes.add("socket:[" + cells[9] + "]");
    }
  }
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\\d+$/.test(name))) {
    let fds = [];
    try { fds = fs.readdirSync("/proc/" + pid + "/fd"); } catch { continue; }
    for (const fd of fds) {
      try { if (inodes.has(fs.readlinkSync("/proc/" + pid + "/fd/" + fd))) return Number(pid); } catch {}
    }
  }
  return undefined;
};
const record = (port) => {
  const listener = listenerOf(port);
  if (listener === undefined) return;
  let pid = listener;
  for (let parent = parentOf(pid); parent > 1 && !SHELLS.has(nameOf(parent)); parent = parentOf(pid)) pid = parent;
  // With no shell above it, the walk reached whatever started the sandbox's processes, so the listener alone is kept.
  if (!SHELLS.has(nameOf(parentOf(pid)))) pid = listener;
  const environ = Object.fromEntries(read("/proc/" + pid + "/environ").split("\\0").filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
  const kept = {
    port,
    argv: read("/proc/" + pid + "/cmdline").split("\\0").filter(Boolean),
    cwd: fs.readlinkSync("/proc/" + pid + "/cwd"),
    uid: idOf(pid, "Uid"),
    gid: idOf(pid, "Gid"),
    env: { PATH: environ.PATH || process.env.PATH, HOME: environ.HOME || "/" },
  };
  // A state folder the relay makes is handed to the workspace's owner, who writes the checkout's record in it.
  const made = fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  if (made !== undefined) { const owner = fs.statSync(path.dirname(made)); fs.chownSync(made, owner.uid, owner.gid); }
  fs.writeFileSync(recordPath, JSON.stringify(kept));
};
const restore = (kept) => {
  const probe = net.connect(kept.port, "127.0.0.1");
  probe.on("connect", () => probe.destroy());
  probe.on("error", () => {
    if (!kept.argv || kept.argv.length === 0) return;
    const child = spawn(kept.argv[0], kept.argv.slice(1), { cwd: kept.cwd, uid: kept.uid, gid: kept.gid, env: kept.env, detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  });
};
let port = Number(asked);
const restoring = mode !== "${RELAY_MODE.RECORD}";
if (!restoring) record(port);
else {
  const kept = JSON.parse(read(recordPath) || "{}");
  port = kept.port;
  restore(kept);
}
const host = "localhost:" + port;
const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: "127.0.0.1", port, method: req.method, path: req.url, headers: { ...req.headers, host } },
    (answer) => { res.writeHead(answer.statusCode, answer.rawHeaders); answer.pipe(res); },
  );
  upstream.on("error", (error) => {
    // Note that only a server this relay started again is coming up; one that stopped under a running share is not.
    const down = error.code === "ECONNREFUSED";
    if (!res.headersSent) res.writeHead(down && restoring ? 503 : 502, down ? { [restoring ? "${STARTING_HEADER}" : "${NOT_RUNNING_HEADER}"]: "1" } : {});
    res.end();
  });
  req.pipe(upstream);
});
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(port, "127.0.0.1", () => {
    const lines = [req.method + " " + req.url + " HTTP/1.1"];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(name + ": " + (name.toLowerCase() === "host" ? host : req.rawHeaders[i + 1]));
    }
    upstream.write(lines.join("\\r\\n") + "\\r\\n\\r\\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
server.listen(port + ${RELAY_OFFSET}, "0.0.0.0");
`;

/** A command run as root, which the relay's process and its record need. */
function asRoot(command: string, args: readonly string[]): CommandAsk {
  return { command: "sudo", args: ["-n", command, ...args] };
}

/** The relay started in a mode, detached, as root. */
function relay(mode: RelayMode, port?: number): DetachedCommandAsk {
  const args = ["-e", RELAY_SOURCE, RELAY_MARKER, mode, RECORD_PATH];

  return { command: "node", args: port === undefined ? args : [...args, String(port)], sudo: true };
}

/** The port a shared port's relay listens on, which its route serves. */
export function relayPortOf(port: number): number {
  return port + RELAY_OFFSET;
}

/** The shared port a route's port stands for: the relay's port taken back, or the port itself for a route opened before the relay. */
export function sharedPortOf(routePort: number): number {
  return routePort >= RELAY_OFFSET ? routePort - RELAY_OFFSET : routePort;
}

/** Whether a port can be shared through a relay, whose port must be one a socket can take. */
export function relayable(port: number): boolean {
  return port < RELAY_OFFSET;
}

/** Ends whatever relay a share before left running; a sandbox with none ends nothing. */
// Note that the pattern brackets its first letter, so it never matches a shell that runs pkill with it.
export const STOP_RELAY = asRoot("pkill", ["-f", `[${RELAY_MARKER[0]}]${RELAY_MARKER.slice(1)}`]);

/** Forgets the record, so a share stopped on purpose never comes back on a wake. */
export const FORGET_RECORD = asRoot("rm", ["-f", RECORD_PATH]);

/** Reads the record, whose `port` is the port shared before the sandbox stopped; empty where none was. */
export const READ_RECORD = asRoot("cat", [RECORD_PATH]);

/** Starts the relay for the port as it is shared, recording how the server on it was started. */
export const recordingRelay = (port: number) => relay(RELAY_MODE.RECORD, port);

/** Starts the relay from the record as a preview wakes the sandbox, starting the server again where none listens. */
export const restoringRelay = () => relay(RELAY_MODE.RESTORE);
