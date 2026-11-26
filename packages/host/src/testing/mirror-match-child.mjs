// mirror-match-child.mjs -- the matching process's side run in a plain Node child, over its IPC channel, as the desktop runs it over a utility process's parent port.
//
// A test forks this with tsx's loader (`mirror-match-remote.test.ts`), so the
// match crosses a real process boundary as it does on the desktop. It is
// plain JavaScript because it is a process's edge: it runs the one Effect
// that serves for the child's life, on the machine's own file system.
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { serveMirrorMatch } from "../mirror-match-worker.js";

Effect.runFork(
  serveMirrorMatch({
    onMessage: (listener) => {
      process.on("message", listener);
    },
    postMessage: (message) => {
      process.send?.(message);
    },
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
);
