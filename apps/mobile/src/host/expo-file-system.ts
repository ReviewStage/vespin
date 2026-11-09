/**
 * expo-file-system.ts -- the host's files on the device: each file the host keeps, under the app's own Documents folder, through `expo-file-system`.
 *
 * The host in the app keeps one small file, the settings store's
 * `settings.json`, and retires none of an older layout's, so this answers
 * only what the settings store and the retired store call, as the web's
 * storage does (`apps/web/src/app/local-storage-file-system.ts`): a read, a
 * write, a directory made, a mode set, a rename, and a removal. Every other
 * call is `FileSystem.layerNoop`'s refusal. The host names its files by
 * plain paths under its state root, which `expo-file-system` reads as
 * `file://` addresses, so each path is turned into one here and nowhere
 * else.
 */

import { Effect, type Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";
import { Directory, File, Paths } from "expo-file-system";

const FILE_SCHEME = "file://";

/** The folder the host's files stand in, as a plain path: `host` under the app's Documents, which iOS keeps across launches and backs up. */
export function hostStateRoot(): string {
  return `${plainPath(Paths.document.uri)}/host`;
}

/** A `file://` address as a plain absolute path, without a trailing slash. */
function plainPath(uri: string): string {
  const path = uri.startsWith(FILE_SCHEME) ? uri.slice(FILE_SCHEME.length) : uri;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** A plain path as the `file://` address `expo-file-system` reads. */
function fileUri(path: string): string {
  return path.startsWith(FILE_SCHEME) ? path : `${FILE_SCHEME}${path}`;
}

/**
 * A path that names no file, refused as Node refuses one: the settings store
 * reads `ENOENT` on the reason's cause as "never written", which is what a
 * first launch is.
 */
function missing(method: string, path: string) {
  return systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    description: "No such file or directory",
    cause: Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
  });
}

/** A call the device's file system refused. */
function refused(method: string, path: string, cause: unknown) {
  return systemError({
    _tag: "Unknown",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    description: "The device's file system refused the call",
    cause,
  });
}

/** One synchronous call on the device's file system, its throw read as a refusal. */
const attempt = <A>(method: string, path: string, run: () => A) =>
  Effect.try({ try: run, catch: (cause) => refused(method, path, cause) });

/** The host's `FileSystem` over the device's own, each path read under `file://`. */
export function expoFileSystem(): Layer.Layer<FileSystem.FileSystem> {
  const fileAt = (path: string) => new File(fileUri(path));
  const directoryAt = (path: string) => new Directory(fileUri(path));
  const exists = (path: string) => fileAt(path).exists || directoryAt(path).exists;
  return FileSystem.layerNoop({
    exists: (path) => attempt("exists", path, () => exists(path)),
    readFileString: (path) =>
      Effect.suspend(() => {
        const file = fileAt(path);
        return file.exists
          ? attempt("readFileString", path, () => file.textSync())
          : Effect.fail(missing("readFileString", path));
      }),
    writeFileString: (path, data) =>
      attempt("writeFileString", path, () => {
        const file = fileAt(path);
        file.parentDirectory.create({ intermediates: true, idempotent: true });
        file.writeSync(data);
      }),
    makeDirectory: (path, options) =>
      attempt("makeDirectory", path, () =>
        directoryAt(path).create({ intermediates: options?.recursive === true, idempotent: true }),
      ),
    // A mode means nothing on iOS, where the app alone reads its folder; the file must still stand, as Node's chmod asks.
    chmod: (path) =>
      Effect.suspend(() => (exists(path) ? Effect.void : Effect.fail(missing("chmod", path)))),
    rename: (oldPath, newPath) =>
      Effect.suspend(() => {
        const from = fileAt(oldPath);
        if (!from.exists) return Effect.fail(missing("rename", oldPath));
        // Note that a rename lands over whatever stood at the new path, as Node's does: the settings store writes a file beside its own and renames it over.
        return attempt("rename", newPath, () => {
          const to = fileAt(newPath);
          if (to.exists) to.delete();
          from.moveSync(to);
        });
      }),
    remove: (path, options) =>
      Effect.suspend(() => {
        const file = fileAt(path);
        const directory = directoryAt(path);
        if (file.exists) return attempt("remove", path, () => file.delete());
        if (directory.exists) {
          // Note that a folder with files in it goes only where asked, as Node's `rm` asks.
          if (options?.recursive !== true && directory.list().length > 0) {
            return Effect.fail(refused("remove", path, new Error(`ENOTEMPTY: ${path}`)));
          }
          return attempt("remove", path, () => directory.delete());
        }
        return options?.force === true ? Effect.void : Effect.fail(missing("remove", path));
      }),
  });
}
