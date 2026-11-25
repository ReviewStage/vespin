/**
 * mirror-match.ts -- the mirror matching process main spawns with Electron's `utilityProcess`, answering over its parent port.
 *
 * Its own bundle (`dist/mirror-match.js`, `scripts/build.mjs`), so a mirror's
 * match reads and hashes its checkout on this process's event loop and file
 * pool, never main's. What a match does is `@repo/host`'s
 * (`mirror-match-worker.ts`); this is only the process's edge: it runs that
 * over the port main asks it on, on the machine's own file system, for as
 * long as main keeps it.
 */
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { serveMirrorMatch } from "@repo/host/mirror-match-worker";
import { Effect, Layer } from "effect";

const { parentPort } = process;

Effect.runFork(
  serveMirrorMatch({
    onMessage: (listener) => {
      parentPort.on("message", (event) => listener(event.data));
    },
    postMessage: (message) => parentPort.postMessage(message),
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
);
