/**
 * listening-ports.ts -- the TCP ports a server listens on in an agent's running sandbox: the command that reads the kernel's socket tables, and the ports read back from what it printed.
 *
 * The tables are read from `/proc/net/tcp` and `/proc/net/tcp6` rather
 * than `ss`, which the sandbox's image does not carry: one `cat`, quick
 * enough for the desktop to ask every few seconds. A socket is kept where
 * it listens and is not one of our own. Ours are the agent's browser's DevTools port
 * (`SANDBOX_BROWSER.DEVTOOLS_PORT`) and whatever root holds: a member's
 * server runs as the sandbox's default user and an agent's as its own,
 * while the sandbox's own init, which serves the sandbox's API, listens as
 * root.
 *
 * The same read says what serves each port (`port-label.ts`). After the
 * tables, a short Node script run as root, which alone may look into
 * another user's processes, finds the process holding each listening
 * socket, matching the socket's inode to a `/proc/<pid>/fd` link, and
 * prints the command line of the one the shell ran: the listener's ancestor
 * whose parent is a shell, or the listener itself where no shell stands
 * above it, the rule the shared preview's relay records a server by
 * (`preview-relay.ts`). It prints the listener's own command line beside
 * it, which labels two ports one command started, such as a monorepo's
 * `turbo dev`. A port whose process could not be read is listed
 * without a label, as is every port where the script did not run. A command
 * line can carry a secret, so it never leaves this module: only the label
 * made from it does, and nothing here is logged or traced.
 */

import type { ListeningPortsAnswer, PortLabel } from "@repo/features/listening-ports-wire";
import type { CommandAsk, CommandRun } from "@repo/sandbox";
import { Result, Schema } from "effect";
import { SANDBOX_BROWSER } from "../browser/sandbox-browser.js";
import { labelOf } from "./port-label.js";

/** The kernel's TCP socket tables, IPv4's and IPv6's; a kernel without IPv6 has no second one, and `cat` prints the first alone. */
const SOCKET_TABLES = ["/proc/net/tcp", "/proc/net/tcp6"] as const;

/** A table's header names the columns; one printed nowhere is a read that did not happen. */
const TABLE_HEADER = "local_address";

/** The columns of a table's row, split on whitespace: the local address and port, the state, the owner's uid, and the socket's inode. */
const COLUMN = { LOCAL_ADDRESS: 1, STATE: 3, UID: 7, INODE: 9 } as const;

/** The state a listening socket is in, as the kernel prints it (`TCP_LISTEN`). */
const LISTEN_STATE = "0A";

/** The uid of root, whose listeners are the sandbox's own. */
const ROOT_UID = "0";

/** Our own ports, apart from root's, that are never a server's to forward. */
const OWN_PORTS: ReadonlySet<number> = new Set([SANDBOX_BROWSER.DEVTOOLS_PORT]);

/** The line between the tables and the listeners. */
const LISTENERS_MARK = "vespin-listeners";

/**
 * The script that prints, one JSON line each, the process holding each
 * socket a non-root user listens on: the socket's inode, the command line
 * the shell ran, and the listener's own command line. It is
 * written without a single quote, since the shell's own quotes hold it.
 */
const LISTENERS_SOURCE = String.raw`"use strict";
const fs = require("node:fs");
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "fish"]);
const read = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const parentOf = (pid) => Number(read("/proc/" + pid + "/stat").replace(/^.*\) /s, "").split(" ")[1]);
const nameOf = (pid) => read("/proc/" + pid + "/comm").trim();
const argvOf = (pid) => read("/proc/" + pid + "/cmdline").split("\0").filter(Boolean);
const wanted = new Set();
for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
  for (const line of read(table).split("\n").slice(1)) {
    const cells = line.trim().split(/\s+/);
    if (cells[3] === "0A" && cells[7] !== "0") wanted.add(cells[9]);
  }
}
const found = new Map();
for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
  if (found.size === wanted.size) break;
  let fds = [];
  try { fds = fs.readdirSync("/proc/" + pid + "/fd"); } catch { continue; }
  for (const fd of fds) {
    let link = "";
    try { link = fs.readlinkSync("/proc/" + pid + "/fd/" + fd); } catch { continue; }
    const inode = (/^socket:\[(\d+)\]$/.exec(link) || [])[1];
    if (inode !== undefined && wanted.has(inode) && !found.has(inode)) found.set(inode, Number(pid));
  }
}
for (const [inode, listener] of found) {
  let pid = listener;
  for (let parent = parentOf(pid); parent > 1 && !SHELLS.has(nameOf(parent)); parent = parentOf(pid)) pid = parent;
  if (!SHELLS.has(nameOf(parentOf(pid)))) pid = listener;
  console.log(JSON.stringify({ inode, command: argvOf(pid), listener: argvOf(listener) }));
}
`;

/** One listener as the script prints it. */
const ListenerLine = Schema.fromJsonString(
  Schema.Struct({
    inode: Schema.String,
    command: Schema.Array(Schema.String),
    listener: Schema.Array(Schema.String),
  }),
);

type Listener = typeof ListenerLine.Type;

const readListenerLine = Schema.decodeUnknownResult(ListenerLine);

/** A port kept, and the inode of a socket listening on it. */
interface KeptSocket {
  readonly port: number;
  readonly inode: string;
}

/**
 * Reads the sandbox's socket tables, and after them the listeners as root,
 * in the lines `listeningPortsOf` reads. A sandbox where `sudo` or `node`
 * cannot run prints the tables alone.
 */
export function readSocketTables(): CommandAsk {
  const script = [
    `cat ${SOCKET_TABLES.join(" ")}`,
    `echo ${LISTENERS_MARK}`,
    `sudo -n node -e '${LISTENERS_SOURCE}' 2>/dev/null`,
    "true",
  ].join("; ");

  return { command: "sh", args: ["-c", script] };
}

/** The port a row listens on and its socket's inode, where it is a listener the list keeps. */
function keptSocket(row: string): KeptSocket | undefined {
  const columns = row.trim().split(/\s+/);

  if (columns[COLUMN.STATE] !== LISTEN_STATE || columns[COLUMN.UID] === ROOT_UID) return undefined;
  const port = Number.parseInt(columns[COLUMN.LOCAL_ADDRESS]?.split(":").at(-1) ?? "", 16);

  return OWN_PORTS.has(port) ? undefined : { port, inode: columns[COLUMN.INODE] ?? "" };
}

/** The listeners the script printed, by their socket's inode; a line it could not have printed is passed over. */
function listenersOf(lines: readonly string[]): Map<string, Listener> {
  const listeners = new Map<string, Listener>();

  for (const line of lines) {
    const read = readListenerLine(line);

    if (Result.isSuccess(read)) listeners.set(read.success.inode, read.success);
  }

  return listeners;
}

/**
 * Each port's label: what the shell ran, or, where several ports would read
 * the same, what listens on each, so two servers one command started are
 * told apart; a port none could be made for has none.
 */
function labelsOf(
  sockets: readonly KeptSocket[],
  listeners: ReadonlyMap<string, Listener>,
): PortLabel[] {
  const made = new Map<number, { readonly ran: string; readonly own: string | undefined }>();

  for (const { port, inode } of sockets) {
    const listener = listeners.get(inode);

    if (listener === undefined || made.has(port)) continue;
    const own = labelOf(listener.listener);
    const ran = labelOf(listener.command) ?? own;

    if (ran !== undefined) made.set(port, { ran, own });
  }

  const readings = [...made.values()].map(({ ran }) => ran);

  return [...made]
    .map(([port, { ran, own }]) => ({
      port,
      label: readings.indexOf(ran) !== readings.lastIndexOf(ran) && own !== undefined ? own : ran,
    }))
    .sort((a, b) => a.port - b.port);
}

/**
 * The ports listened on, each once and the lowest first, and what serves
 * each where it could be read, from what the read printed; nothing where it
 * printed no table, which is an outage rather than a sandbox with no
 * servers. A port listened on over both IPv4 and IPv6 is one port.
 */
export function listeningPortsOf(
  run: CommandRun,
): Omit<ListeningPortsAnswer, "running"> | undefined {
  const mark = run.stdout.indexOf(`${LISTENERS_MARK}\n`);
  const tables = mark === -1 ? run.stdout : run.stdout.slice(0, mark);
  const printed = mark === -1 ? "" : run.stdout.slice(mark + LISTENERS_MARK.length + 1);

  if (!tables.includes(TABLE_HEADER)) return undefined;
  const sockets = tables.split("\n").flatMap((row) => keptSocket(row) ?? []);
  const ports = [...new Set(sockets.map(({ port }) => port))].sort((a, b) => a - b);

  return { ports, labels: labelsOf(sockets, listenersOf(printed.split("\n"))) };
}
