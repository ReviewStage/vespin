/**
 * main.ts -- the runner's process: stdin and the environment in, one launch run, and the process's exit code out.
 *
 * Bundled with the SDK into one file (`pnpm --filter @repo/agent-runner
 * build`), which the service uploads to the agent's sandbox and starts there as the
 * agent user (P08). Exit 0 is a launch that ended as the service asked or as the
 * turn did; anything else is one we show as interrupted, and
 * `RUNNER_EXIT.UNCONFIGURED` one whose config line never came.
 */

import { createInterface } from "node:readline";
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { Effect, Exit, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { checkoutSnapshotsLive } from "./checkout-snapshot.js";
import { claudeCodeLive } from "./claude-code.js";
import { RunnerUnconfigured } from "./launch.js";
import { RUNNER_END, RUNNER_EXIT } from "./protocol.js";
import { providerProbeLive } from "./reconnect.js";
import { runAgent } from "./runner.js";

// Note that the interface is made only as the stream starts, and iterated at
// once, because readline drops every line it reads before its iterator exists.
const stdin: AsyncIterable<string> = {
  [Symbol.asyncIterator]: () =>
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })[
      Symbol.asyncIterator
    ](),
};

const stdinLines = Stream.fromAsyncIterable(stdin, () => undefined).pipe(
  Stream.catch(() => Stream.empty),
);

const spawner = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const main = runAgent({ lines: stdinLines, env: process.env }).pipe(
  Effect.scoped,
  Effect.map((end) => (end === RUNNER_END.FAILED ? RUNNER_EXIT.FAILED : RUNNER_EXIT.ENDED)),
  Effect.catch((error) =>
    Effect.logError(`agent-runner: ${error._tag}: ${error.detail}`).pipe(
      Effect.as(
        error instanceof RunnerUnconfigured ? RUNNER_EXIT.UNCONFIGURED : RUNNER_EXIT.FAILED,
      ),
    ),
  ),
  Effect.provide(
    Layer.mergeAll(
      claudeCodeLive,
      providerProbeLive,
      FetchHttpClient.layer,
      // Codex's app-server, spawned as the runner's own child (codex.ts), and git for the
      // checkout's snapshot before each turn (checkout-snapshot.ts).
      spawner,
      checkoutSnapshotsLive(process.env).pipe(Layer.provide(spawner)),
    ),
  ),
);

// Note that we exit explicitly, even on success, where `runMain` would leave
// the process to drain, because stdin, which the service may hold open, would keep
// it alive after the launch has ended.
NodeRuntime.runMain(main, {
  teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : RUNNER_EXIT.FAILED),
});
