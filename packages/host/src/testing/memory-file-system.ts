/**
 * memory-file-system.ts -- a disk held in memory, for a host test: each file's text by its path, so what a fiber wrote is there the moment it ran, with no disk's own time between.
 */

import { ByteSize, Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";

/**
 * Each file's text by its path, and the file system over them: a write, a
 * rename, and a removal land at once, each read looks as it runs, a file
 * never written reads as not found, making a folder or setting a mode
 * does nothing, and every path stats as a private folder the host's own user
 * owns (`MEMORY_OWNER`). `overrides` stands over any of it, and the rest is as
 * `layerNoop` leaves it.
 */
/** The user every path of the memory disk is owned by. */
const MEMORY_OWNER = 501;

/** What every path of the memory disk stats as: a private folder `MEMORY_OWNER` owns. */
const PRIVATE_FOLDER: FileSystem.File.Info = {
  type: "Directory",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0o40700,
  nlink: Option.none(),
  uid: Option.some(MEMORY_OWNER),
  gid: Option.some(MEMORY_OWNER),
  rdev: Option.none(),
  size: ByteSize.bytes(0),
  blksize: Option.none(),
  blocks: Option.none(),
};

export function memoryFileSystem(overrides: Parameters<typeof FileSystem.layerNoop>[0] = {}) {
  const files = new Map<string, string>();
  const layer = FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => files.has(path)),
    makeDirectory: () => Effect.void,
    chmod: () => Effect.void,
    stat: () => Effect.succeed(PRIVATE_FOLDER),
    // Note that a missing file fails with the errno a disk's would, which a host's reader takes as no file yet.
    readFileString: (path) =>
      Effect.suspend(() => {
        const held = files.get(path);
        return held === undefined
          ? Effect.fail(
              systemError({
                // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- Effect's systemError takes its tag as data
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: path,
                cause: Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
              }),
            )
          : Effect.succeed(held);
      }),
    writeFileString: (path, data) => Effect.sync(() => void files.set(path, data)),
    rename: (from, to) =>
      Effect.sync(() => {
        const held = files.get(from);
        files.delete(from);
        if (held !== undefined) files.set(to, held);
      }),
    remove: (path) => Effect.sync(() => void files.delete(path)),
    ...overrides,
  });
  return { files, layer };
}
