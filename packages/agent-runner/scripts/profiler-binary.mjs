/**
 * profiler-binary.mjs -- Sentry's CPU profiler binary for the cloud sandbox's Node, copied into `dist/` beside the runner's bundle.
 *
 * The bundle leaves every `.node` file external, because esbuild cannot
 * inline a native module, and the profiler requires the one for its platform
 * by name from beside the bundle. The sandbox is x64 glibc Linux on Node 24
 * (ABI 137), so that one alone is copied, under the name the runner's unit
 * gives it (`RUNNER_UNIT`), which ships and installs it with the bundle. A
 * host's runner never loads the profiler (`trace.ts`), so it needs none.
 */

import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { RUNNER_UNIT } from "../src/pins.ts";

const runner = join(import.meta.dirname, "..");
const profilingNode = createRequire(join(runner, "package.json")).resolve("@sentry/profiling-node");
const cpuProfiler = createRequire(profilingNode).resolve("@sentry/node-cpu-profiler");

await copyFile(
  join(dirname(cpuProfiler), RUNNER_UNIT.PROFILER),
  join(runner, "dist", RUNNER_UNIT.PROFILER),
);
