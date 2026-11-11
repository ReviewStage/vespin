/**
 * armed-watch.ts -- the file system's watch laid the moment it is asked for, its first move saying it is armed.
 *
 * Effect's own Node watch is laid in a fiber of its own once its stream
 * runs, so whoever asked cannot tell when a change would first be heard: a
 * folder made after a check found it missing and before the watch above it
 * was laid was never heard of, and a wait on it never ended
 * (`folder-moves.ts`). Here the watch is laid as the file system registers
 * it, and its stream opens on one move of nothing in particular, so a
 * caller that checked before the watch was laid checks once more after.
 */

import { existsSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

/** The file system's watch backend for a host on Node: each watch laid at once, and heard from its first move. */
export const armedWatchLayer = Layer.succeed(FileSystem.WatchBackend, {
  register: (path, info, options) => {
    const directory = info.type === "Directory" ? path : dirname(path);
    const watcher = watch(path, { recursive: options?.recursive ?? false });
    return Option.some(
      Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            watcher.on("change", (event, name) => {
              if (typeof name !== "string") return;
              const stands = existsSync(join(directory, name));
              const tag = event !== "rename" ? "Update" : stands ? "Create" : "Remove";
              Queue.offerUnsafe(queue, { _tag: tag, path: name });
            });
            watcher.on("error", (cause) =>
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(
                  PlatformError.systemError({
                    _tag: "Unknown",
                    module: "FileSystem",
                    method: "watch",
                    pathOrDescriptor: path,
                    cause,
                  }),
                ),
              ),
            );
            watcher.on("close", () => Queue.endUnsafe(queue));
            // Note that the first move says the watch is armed, because a change made before it was laid was heard by nobody.
            Queue.offerUnsafe(queue, { _tag: "Update", path: "" });
          }),
          () => Effect.sync(() => watcher.close()),
        ),
      ),
    );
  },
});
