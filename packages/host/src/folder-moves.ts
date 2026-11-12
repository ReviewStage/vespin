import { Effect, Path, Predicate, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * folder-moves.ts -- a folder followed as it changes, by the file system's own watch: a pulse each time an entry in it is made, written, moved, or removed, and each time the folder itself comes or goes.
 *
 * A folder that is not there yet is waited for on the watch of the nearest
 * folder above it that is, so it is followed from the moment it is made, and
 * one that is removed is waited for again the same way; nothing reads it on a
 * schedule. Note that the watch is never recursive, and is laid on the folder
 * rather than a file in it, because a file written beside itself and moved
 * over itself, as the host's record is, is a new file that a watch on the
 * old one never hears of. A folder removed is known by the move that names
 * the folder itself or finds it gone, or by its watch failing to be laid
 * because it is missing, and never by whether a folder stands at its path
 * once that is read, because one removed and made again before then is a new
 * folder the old watch never hears of. A watch the system refuses ends the
 * pulses of the folder it was laid on, rather than being laid again on a
 * timer.
 */

/** Whether the folder stands, read as missing where it cannot be read. */
const standing = (fileSystem: FileSystem.FileSystem, folder: string) =>
  fileSystem.exists(folder).pipe(Effect.orElseSucceed(() => false));

/** The pulses of the folder given, from the moment it stands, for as long as the stream is read. */
export const folderMoves = (
  folder: string,
): Stream.Stream<void, never, FileSystem.FileSystem | Path.Path> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      if (!(yield* standing(fileSystem, folder))) {
        const parent = path.dirname(folder);

        if (parent === folder) return Stream.never;

        // Note that each move of the parent asks whether the folder now stands, and the one that finds it is the folder's first pulse.
        return folderMoves(parent).pipe(
          Stream.mapEffect(() => standing(fileSystem, folder)),
          Stream.takeUntil((stands) => stands),
          Stream.filter((stands) => stands),
          Stream.as(undefined),
          // Note that a parent whose watch was refused before the folder stood follows it no further, so a refused watch never lays itself again at once.
          Stream.concat(
            Stream.unwrap(
              Effect.map(standing(fileSystem, folder), (stands) =>
                stands ? Stream.suspend(() => folderMoves(folder)) : Stream.empty,
              ),
            ),
          ),
        );
      }

      const name = path.basename(folder);

      // Note that a move that names the folder or finds it gone is its last pulse here, and it is followed again from the start, as is a folder gone before its watch was laid.
      return fileSystem.watch(folder).pipe(
        Stream.mapEffect((move) =>
          move.path === name ? Effect.succeed(false) : standing(fileSystem, folder),
        ),
        Stream.catchIf(
          (error) => Predicate.isTagged(error.reason, "NotFound"),
          () => Stream.succeed(false),
        ),
        // Note that a folder removed between its check and its watch is a folder gone too, because the system's watch throws as it is laid, which reaches here as a defect rather than a failure.
        Stream.catchDefect((defect) =>
          Predicate.hasProperty(defect, "code") && defect.code === "ENOENT"
            ? Stream.succeed(false)
            : Stream.die(defect),
        ),
        Stream.ignore,
        Stream.takeUntil((stays) => !stays),
        Stream.flatMap((stays) =>
          stays
            ? Stream.succeed(undefined)
            : Stream.concat(
                Stream.succeed(undefined),
                Stream.suspend(() => folderMoves(folder)),
              ),
        ),
      );
    }),
  );
