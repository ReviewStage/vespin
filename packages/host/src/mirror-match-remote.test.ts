import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect, Exit, Layer, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import {
  type MirrorMatchProcess,
  type MirrorMatchProcessListeners,
  mirrorMatchInProcess,
} from "./mirror-match-remote.js";

/** The matching process's side, run in a real Node child as the desktop runs it in a utility process. */
const CHILD = fileURLToPath(new URL("./testing/mirror-match-child.mjs", import.meta.url));

/** A child is started with tsx's loader, which takes a second or two. */
const CHILD_TIMEOUT_MS = 30_000;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A Node child running the matching process's side, and `afterSend` run on it after each match it is sent. */
function forkChild(
  listeners: MirrorMatchProcessListeners,
  afterSend: (child: ChildProcess) => void = () => undefined,
): MirrorMatchProcess {
  const child = fork(CHILD, { execArgv: ["--import", "tsx"], stdio: "inherit" });
  // SAFETY: the child sends structured-clone values, the wire boundary shape.
  child.on("message", (message) => listeners.onMessage(message as WireBoundaryInput));
  child.on("exit", () => listeners.onExit());

  return {
    send: (message) => {
      child.send(message);
      afterSend(child);
    },
    kill: () => {
      child.kill();
    },
  };
}

it.effect(
  "a process that dies holding a match fails it, and a new process answers the next with the files that differ",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* temporaryDirectoryScoped("mirror-match-");
        yield* fileSystem.writeFileString(path.join(root, "same.txt"), "same");
        yield* fileSystem.writeFileString(path.join(root, "changed.txt"), "old!");

        // The mirror holds same.txt as the sandbox does, changed.txt at the same size with other bytes, and lacks added.txt.
        const files = [
          { path: "same.txt", size: 4, hash: sha256("same") },
          { path: "changed.txt", size: 4, hash: sha256("new!") },
          { path: "added.txt", size: 5, hash: sha256("added") },
        ];

        let spawned = 0;

        const match = yield* mirrorMatchInProcess((listeners) => {
          spawned += 1;

          // The first process is killed the moment it is handed its match, as a crash would end it.
          return spawned === 1
            ? forkChild(listeners, (child) => child.kill("SIGKILL"))
            : forkChild(listeners);
        });

        const listed = ["same.txt", "changed.txt"];
        assert.ok(Exit.isFailure(yield* Effect.exit(match(root, listed, files))));
        assert.deepEqual(yield* match(root, listed, files), ["changed.txt", "added.txt"]);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  CHILD_TIMEOUT_MS,
);
