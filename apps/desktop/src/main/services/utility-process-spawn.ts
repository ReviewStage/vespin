/**
 * utility-process-spawn.ts -- a bundle built beside main forked as a `utilityProcess` of main's own, as `@repo/host`'s asking side spawns one.
 *
 * What is asked and when, and the restart, are `@repo/host`'s
 * (`process-asking.ts` and the modules that ask through it); this is only
 * how the desktop starts the process: the bundle forked from main's build
 * directory, talked to over its parent port, and killed when the asking
 * side's scope closes.
 */
import path from "node:path";
import type { SpawnAskedProcess } from "@repo/host/process-asking";
import type { WireBoundaryInput } from "@repo/wire";
import { utilityProcess } from "electron";

/** A spawn of `entry`'s bundle in `resourceDirectory`, named `serviceName` in Activity Monitor. */
export function utilityProcessSpawn<Request>(
  resourceDirectory: string,
  entry: string,
  serviceName: string,
): SpawnAskedProcess<Request> {
  return (listeners) => {
    const child = utilityProcess.fork(path.join(resourceDirectory, entry), [], { serviceName });

    child.on("message", (message: WireBoundaryInput) => listeners.onMessage(message));
    child.on("exit", () => listeners.onExit());

    return {
      send: (message) => child.postMessage(message),
      kill: () => {
        child.kill();
      },
    };
  };
}
