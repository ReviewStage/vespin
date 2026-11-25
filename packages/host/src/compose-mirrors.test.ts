import assert from "node:assert/strict";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import type { TerminalSocketOpening } from "@repo/features/relay-socket";
import { SANDBOX_TUNNEL } from "@repo/features/sandbox-tunnel-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Path, PubSub, Queue, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { composeMirrors } from "./compose-mirrors.js";

/** The machine's own file system and processes, which a mirror's folders and scripts run on. */
const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** The status the fake relay refuses every tunnel with, so each attempt ends at once. */
const REFUSED = 403;

/** Three agents with a mirror on disk: one the task list holds live, one it shows archived, and one it does not hold, its agent deleted. */
const AGENT = {
  LIVE: "0b1e2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  ARCHIVED: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  GONE: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
} as const;

/** The task list as the test draws it: the live agent and the archived one. */
const LISTED = new Map<string, { repository: null; sandboxOpen?: boolean; archivedAt?: number }>([
  [AGENT.LIVE, { repository: null, sandboxOpen: true }],
  [AGENT.ARCHIVED, { repository: null, archivedAt: 1 }],
]);

describe("composeMirrors", () => {
  it.effect(
    "tries no mirror as the host starts, and finds the leftovers once ten minutes in and once a day",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* temporaryDirectoryScoped("mirrors-leftovers-");

        for (const agentId of Object.values(AGENT)) {
          yield* fileSystem.makeDirectory(path.join(folder, agentId));
        }

        const opened = yield* Queue.unbounded<string>();
        const drawings = yield* PubSub.unbounded<unknown>();

        // Each run is a host's start over the same folder, the task list already drawn.
        const run = Effect.gen(function* () {
          const mirrors = yield* composeMirrors({
            kernel: {
              hostedServiceBaseUrl: "https://vespin.test",
              emit: () => undefined,
              runMode: { sendsNetwork: true },
            },
            account: { credential: {} },
            openSocket: (url) =>
              Effect.as(
                Queue.offer(
                  opened,
                  new URL(url).searchParams.get(SANDBOX_TUNNEL.QUERY.AGENT) ?? url,
                ),
                { refused: REFUSED } satisfies TerminalSocketOpening,
              ),
            platform: {
              folder,
              prefetchScript: () => "true",
              worktreeScript: () => "true",
              listScript: () => "true",
              removeScript: () => "true",
            },
            agentListed: (agentId) => LISTED.get(agentId),
            listDrawn: () => true,
            listings: Effect.map(PubSub.subscribe(drawings), Stream.fromSubscription),
            recordProductEvent: () => undefined,
          });

          yield* mirrors.lifetime;
        });

        yield* run;
        yield* TestClock.adjust("9 minutes");
        assert.equal(
          yield* Queue.size(opened),
          0,
          "a tunnel opened within ten minutes of the start",
        );

        yield* TestClock.adjust("2 minutes");
        assert.equal(yield* Queue.take(opened), AGENT.GONE);

        while (yield* fileSystem.exists(path.join(folder, AGENT.ARCHIVED))) {
          yield* Effect.yieldNow;
        }

        yield* run;
        yield* TestClock.adjust("11 minutes");
        assert.equal(yield* Queue.size(opened), 0, "a second pass ran within the day");
        assert.equal(yield* fileSystem.exists(path.join(folder, AGENT.LIVE)), true);
      }).pipe(Effect.provide(NODE)),
  );
});
