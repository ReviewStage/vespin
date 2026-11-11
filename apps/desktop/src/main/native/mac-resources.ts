import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { appProcesses, type ElectronProcessName, readProcessTable } from "@repo/host";
import { MAC_PROCESS_KIND, type MacProcessKind, type MacResources } from "@repo/host/contract";
import { Duration, Effect, Layer, Result } from "effect";
import { app, type ProcessMetric } from "electron";
import { printed } from "./this-mac-host";

/**
 * mac-resources.ts -- what this Mac spends on the app now, as a panel's Resources popover asks: the process table read with `ps`, Electron's own processes named from its metrics, and the host found through launchd.
 *
 * `ps` gives every process its CPU and resident memory in one read, and
 * `@repo/host`'s `appProcesses` keeps those of the app's: main, the host
 * that runs local agents (`dev.vespin.host.standalone`, whose pid launchd
 * answers), and each one's descendants. `ps`'s CPU is the kernel's own
 * decaying figure, as Activity Monitor's is, so a read needs no second
 * sample to answer.
 */

/** The account install's LaunchAgent, by its label (`MAC_LABEL` in the install script). */
const HOST_LABEL = "dev.vespin.host.standalone";

/** How long `ps` and launchd may take to answer; a read the popover waits on is short. */
const ANSWER_WITHIN = Duration.seconds(5);

/** The pid launchd says a running job has, on a line of its own in `launchctl print`. */
const LAUNCHD_PID = /^\s*pid = (\d+)$/mu;

/** What `ps` and launchd run on. */
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

/** The host's pid while launchd runs it; none where it is not installed or not running. */
const hostPid = Effect.map(
  printed("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${HOST_LABEL}`], ANSWER_WITHIN),
  (said) => {
    if (Result.isFailure(said)) return undefined;
    const pid = LAUNCHD_PID.exec(said.success)?.[1];
    return pid === undefined ? undefined : Number(pid);
  },
);

/** The app's processes now; none where `ps` did not answer. */
export const readMacResources: Effect.Effect<MacResources> = Effect.gen(function* () {
  const [table, host] = yield* Effect.all(
    [printed("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,comm="], ANSWER_WITHIN), hostPid],
    { concurrency: "unbounded" },
  );
  if (Result.isFailure(table)) return { processes: [] };
  return {
    processes: appProcesses({
      table: readProcessTable(table.success),
      main: process.pid,
      host,
      electron: electronProcesses(),
    }),
  };
}).pipe(Effect.provide(spawner));
