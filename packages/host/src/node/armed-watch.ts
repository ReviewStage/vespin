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
import { Cause, Data, Effect, Layer, Option, Queue, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";

/** A watch's moves, made as the file system's own. */
const WatchEvent = Data.taggedEnum<FileSystem.WatchEvent>();

/** The file system's watch backend for a host on Node: each watch laid at once, and heard from its first move. */
export const armedWatchLayer = Layer.succeed(FileSystem.WatchBackend, {
  register: (path, info, options) => {
    const directory = info.type === "Directory" ? path : dirname(path);
    const watcher = watch(path, { recursive: options?.recursive ?? false });
    // Note that the watch is heard from the moment it is laid, its moves and failure held until its stream runs, because one emitted before would be lost, and a failure with no listener thrown.
    const held: FileSystem.WatchEvent[] = [];
    let failure: PlatformError.PlatformError | undefined;
    let heard:
      | Queue.Queue<FileSystem.WatchEvent, PlatformError.PlatformError | Cause.Done>
      | undefined;
    const tell = (move: FileSystem.WatchEvent) =>
      heard === undefined ? held.push(move) : Queue.offerUnsafe(heard, move);
    const fail = (error: PlatformError.PlatformError) => {
      if (heard === undefined) failure = error;
      else Queue.failCauseUnsafe(heard, Cause.fail(error));
    };
    watcher.on("change", (event, name) => {
      // A move that names nothing is told as one of nothing in particular, which its watcher checks as it checks the first.
      if (typeof name !== "string") return tell(WatchEvent.Update({ path: "" }));
      const stands = existsSync(join(directory, name));
      tell(
        WatchEvent[event !== "rename" ? "Update" : stands ? "Create" : "Remove"]({ path: name }),
      );
    });
    watcher.on("error", (cause) =>
      fail(
        PlatformError.systemError({
          // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- Effect's systemError takes its tag as data
          _tag: "Unknown",
          module: "FileSystem",
          method: "watch",
          pathOrDescriptor: path,
          cause,
        }),
      ),
    );
    watcher.on("close", () => (heard === undefined ? undefined : Queue.endUnsafe(heard)));
    return Option.some(
      Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            heard = queue;
            for (const move of held.splice(0)) Queue.offerUnsafe(queue, move);
            // Note that the first move after those held says the watch is armed, because a change made before it was laid was heard by nobody.
            Queue.offerUnsafe(queue, WatchEvent.Update({ path: "" }));
            if (failure !== undefined) Queue.failCauseUnsafe(queue, Cause.fail(failure));
          }),
          () => Effect.sync(() => watcher.close()),
        ),
      ),
    );
  },
});
