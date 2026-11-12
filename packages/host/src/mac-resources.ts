/**
 * mac-resources.ts -- the app's processes picked out of the Mac's process table: Electron's own, the host that runs local agents, and every child either started, each with its CPU and memory.
 *
 * The desktop's main reads the table (`ps`) and names Electron's processes
 * from `app.getAppMetrics()`; this reads what both hand it and answers
 * `MAC_RESOURCES_READ`. A process belongs to the app where it is main, the
 * host, or a descendant of either, so a shell a terminal opened, an agent's
 * `claude`, and the `git` it runs are all counted, and nothing else on the Mac
 * is. Electron's helpers stand at the top beside main rather than under it,
 * as Activity Monitor lists an app's helpers, while the children main
 * started itself, its shells and their commands, stand under it.
 */

import { MAC_PROCESS_KIND, type MacProcess, type MacProcessKind } from "./contract/index.js";

/**
 * The four figures that lead a line of `ps -axo pid=,ppid=,pcpu=,rss=,comm=`;
 * the command is the rest of the line, since its path may hold spaces. Note
 * that the command is cut off by its length rather than matched, because a
 * pattern running to the line's end backtracks over a long run of spaces.
 */
const PROCESS_FIGURES = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s/u;

/** `ps` counts resident memory in kibibytes. */
const KIBIBYTE = 1024;

/** One process as the Mac's process table lists it. */
export interface ProcessTableRow {
  readonly pid: number;
  readonly parent: number;
  /** In percent of one core. */
  readonly cpu: number;
  /** In bytes. */
  readonly memory: number;
  /** Its executable's path, or its name where the system gives no path. */
  readonly command: string;
}

/** What Electron calls one of its own processes. */
export interface ElectronProcessName {
  readonly kind: MacProcessKind;
  readonly name: string;
}

/** The rows of `ps -axo pid=,ppid=,pcpu=,rss=,comm=`'s output; a line it cannot read is passed over. */
export function readProcessTable(text: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];

  for (const line of text.split("\n")) {
    const read = PROCESS_FIGURES.exec(line);

    if (read === null) continue;
    const [figures, pid, parent, cpu, memory] = read;
    const command = line.slice(figures.length).trim();

    if (command === "") continue;
    rows.push({
      pid: Number(pid),
      parent: Number(parent),
      cpu: Number(cpu),
      memory: Number(memory) * KIBIBYTE,
      command,
    });
  }

  return rows;
}

/** A command's executable named as Activity Monitor names it: the last part of its path. */
function executableName(command: string): string {
  return command.slice(command.lastIndexOf("/") + 1) || command;
}

/**
 * The app's processes in `table`, each under its parent's in the table's
 * order: main (`main`), the host (`host`, where it runs), and every
 * descendant of either, named by Electron where it is one of `electron`'s.
 */
export function appProcesses(input: {
  readonly table: readonly ProcessTableRow[];
  readonly main: number;
  readonly host: number | undefined;
  readonly electron: ReadonlyMap<number, ElectronProcessName>;
}): MacProcess[] {
  const { table, main, host, electron } = input;
  const byPid = new Map(table.map((row) => [row.pid, row]));
  const children = new Map<number, ProcessTableRow[]>();

  for (const row of table) {
    const siblings = children.get(row.parent);

    if (siblings === undefined) children.set(row.parent, [row]);
    else siblings.push(row);
  }

  const answered: MacProcess[] = [];
  const seen = new Set<number>();

  const walk = (row: ProcessTableRow, parent: number | undefined, kind: MacProcessKind) => {
    // Note that a pid is walked once, because a table read while processes come and go may list a pid reused under its own descendant.
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    const named = electron.get(row.pid);
    answered.push({
      pid: row.pid,
      ...(parent === undefined ? {} : { parent }),
      ppid: row.parent,
      kind,
      name: named?.name ?? executableName(row.command),
      command: row.command,
      cpu: row.cpu,
      memory: row.memory,
    });

    for (const child of children.get(row.pid) ?? []) {
      const helper = electron.get(child.pid);

      // Electron's helpers stand at the top beside main, as an app's helpers do in Activity Monitor.
      if (helper !== undefined) walk(child, undefined, helper.kind);
      else walk(child, row.pid, MAC_PROCESS_KIND.CHILD);
    }
  };

  const mainRow = byPid.get(main);

  if (mainRow !== undefined) walk(mainRow, undefined, MAC_PROCESS_KIND.MAIN);
  const hostRow = host === undefined ? undefined : byPid.get(host);

  if (hostRow !== undefined) walk(hostRow, undefined, MAC_PROCESS_KIND.HOST);

  return answered;
}
