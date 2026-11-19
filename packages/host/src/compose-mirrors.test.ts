import assert from "node:assert/strict";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { accountBearer } from "@repo/features";
import { PRODUCT_EVENT } from "@repo/features/analytics";
import { MIRROR_FAILURE, MIRROR_STEP } from "@repo/features/mirror-steps";
import { TUNNEL_CLOSE } from "@repo/features/sandbox-tunnel-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Path, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { composeMirrors } from "./compose-mirrors.js";

/**
 * Cloud agents' mirrors on this Mac, tried once from the host's start over a
 * relay whose every tunnel closes as the sandbox not running: a failure is
 * counted only where something waits on the mirror. Synthetic ids throughout.
 */

const STANDING_AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const UNMADE_AGENT_ID = "1d2f3a4b-5c6d-4c6b-9e0a-8b3c7a1e2f4d";

/** The machine's own file system and processes, which a mirror's folders and scripts run on. */
const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, {
  discard: true,
});

it.effect(
  "a stopped sandbox at the host's start is counted only for a mirror whose worktree does not stand",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* temporaryDirectoryScoped("mirrors-");
        yield* fileSystem.makeDirectory(
          path.join(folder, STANDING_AGENT_ID, "repository", ".git"),
          {
            recursive: true,
          },
        );
        yield* fileSystem.makeDirectory(path.join(folder, UNMADE_AGENT_ID), { recursive: true });
        const counted: { name: string; properties: unknown }[] = [];

        const composer = yield* composeMirrors({
          kernel: {
            runMode: { sendsNetwork: true },
            hostedServiceBaseUrl: "https://tryapp.test",
            emit: () => {},
          },
          account: {
            credential: accountBearer({
              readAccessToken: () => Effect.succeed("bearer-1"),
              refreshAccount: () => Effect.void,
              readAccountKey: () => Effect.succeed("developer@app.test"),
            }),
          },
          openSocket: () =>
            Effect.succeed({
              socket: {
                arrivals: Stream.make({ close: TUNNEL_CLOSE.NOT_RUNNING }),
                send: () => Effect.void,
                pause: Effect.void,
                resume: Effect.void,
              },
            }),
          platform: {
            folder,
            prefetchScript: () => "exit 1",
            worktreeScript: () => "exit 1",
            listScript: () => "exit 1",
            removeScript: () => "exit 0",
          },
          agentListed: () => undefined,
          listings: Effect.succeed(Stream.never),
          recordProductEvent: (name, properties) => {
            counted.push({ name, properties });
          },
        });

        yield* composer.lifetime;
        yield* settle;

        assert.deepEqual(counted, [
          {
            name: PRODUCT_EVENT.MIRROR_FAIL,
            properties: {
              mirror_step: MIRROR_STEP.HEADER,
              mirror_failure: MIRROR_FAILURE.NOT_RUNNING,
              attempt: 1,
              elapsed_seconds: 0,
            },
          },
        ]);
      }),
    ).pipe(Effect.provide(NODE)),
);
