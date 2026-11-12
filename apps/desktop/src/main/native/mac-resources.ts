import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { appProcesses, type ElectronProcessName, readProcessTable } from "@repo/host";
import { MAC_PROCESS_KIND, type MacProcessKind, type MacResources } from "@repo/host/contract";
import { Duration, Effect, Layer, Result } from "effect";
import { app, type ProcessMetric } from "electron";
import { printed } from "./cli-install";

/**
 * mac-resources.ts -- what this Mac spends on the app now, as a panel's Resources popover asks: the process table read with `ps`, Electron's own processes named from its metrics, and the host found in the table by the Node the app carries for it.
 *
 * `ps` gives every process its CPU and resident memory in one read, and
 * `@repo/host`'s `appProcesses` keeps those of the app's: main, the host
 * that runs local agents (the process launchd started on the bundle's own
 * Node, which only the host's agent runs), and each one's descendants.
 * `ps`'s CPU is the kernel's own decaying figure, as Activity Monitor's is,
 * so a read needs no second sample to answer.
 */

/** The Node the bundle carries for its host (`BUNDLED_HOST.nodePath`), beside `Contents/Resources`. */
const HOST_NODE = path.join(path.dirname(process.resourcesPath), "Helpers", "node");

/** launchd's pid, the parent of every agent it starts. */
const LAUNCHD_PID = 1;

/** How long `ps` may take to answer; a read the popover waits on is short. */
const ANSWER_WITHIN = Duration.seconds(5);

/** What `ps` runs on. */
const spawner = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
);

/** Electron's processes by its own name for their type; a process of any other type is named as the system names it. */
const KIND_OF_PROCESS_TYPE: Partial<Record<ProcessMetric["type"], MacProcessKind>> = {
  Browser: MAC_PROCESS_KIND.MAIN,
  Tab: MAC_PROCESS_KIND.RENDERER,
  GPU: MAC_PROCESS_KIND.GPU,
  Utility: MAC_PROCESS_KIND.UTILITY,
};

/** Electron's own processes by pid, each named as its metrics name it: a utility by its service ("Network Service"), any other by its type. */
function electronProcesses(): Map<number, ElectronProcessName> {
  const named = new Map<number, ElectronProcessName>();

  for (const metric of app.getAppMetrics()) {
    const kind = KIND_OF_PROCESS_TYPE[metric.type];

    if (kind === undefined) continue;
    named.set(metric.pid, { kind, name: metric.name ?? metric.serviceName ?? metric.type });
  }

  return named;
}

/** The app's processes now; none where `ps` did not answer. */
export const readMacResources: Effect.Effect<MacResources> = Effect.gen(function* () {
  const table = yield* printed("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,comm="], ANSWER_WITHIN);

  if (Result.isFailure(table)) return { processes: [] };
  const rows = readProcessTable(table.success);

  return {
    processes: appProcesses({
      table: rows,
      main: process.pid,
      host: rows.find((row) => row.command === HOST_NODE && row.parent === LAUNCHD_PID)?.pid,
      electron: electronProcesses(),
    }),
  };
}).pipe(Effect.provide(spawner));
