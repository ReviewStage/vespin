/**
 * profiler-binary.mjs -- Sentry's CPU profiler binary for the cloud sandbox's Node, copied into `dist/` beside the runner's bundle.
 *
 * The bundle leaves every `.node` file external, because esbuild cannot
 * inline a native module, and the profiler requires the one for its platform
 * by name from beside the bundle. The sandbox is x64 glibc Linux on Node 24
 * (ABI 137), so that one alone is copied, and the agent image installs it
 * beside the runner (`apps/web/agent-image/Dockerfile`). A host's runner
 * never loads the profiler (`trace.ts`), so it needs none.
 */

import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const BINARY = "sentry_cpu_profiler-linux-x64-glibc-137.node";

const runner = join(import.meta.dirname, "..");
const profilingNode = createRequire(join(runner, "package.json")).resolve("@sentry/profiling-node");
const cpuProfiler = createRequire(profilingNode).resolve("@sentry/node-cpu-profiler");
await copyFile(join(dirname(cpuProfiler), BINARY), join(runner, "dist", BINARY));
