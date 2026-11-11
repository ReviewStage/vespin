import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Duration, Effect, Layer, Option, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import { printed } from "./cli-install";

/**
 * mac-photo.ts -- a photo Chromium cannot decode, HEIC off an iPhone, written again as a JPEG with macOS's own `sips`, as a panel asks before it decodes one.
 *
 * The photo is written to a folder of its own under the system's temporary
 * folder, `sips` writes the JPEG beside it, and the folder goes once the JPEG
 * is read, whatever came of it. Nothing is scaled here: the panel's own
 * re-encode bounds the JPEG as it bounds any picture.
 */

/** macOS's own image tool, which reads HEIC through ImageIO. */
const SIPS = "/usr/bin/sips";

/** How long `sips` may take; a large photo converts in well under a second. */
const ANSWER_WITHIN = Duration.seconds(20);

/** What the conversion runs on: `sips` and the folder it writes in. */
const services = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
);

/** The photo's bytes written again as a JPEG; none where `sips` could not read or write it. */
export const photoAsJpeg = (photo: Uint8Array): Effect.Effect<Option.Option<Uint8Array>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vespin-photo-" });
      const source = path.join(folder, "photo.heic");
      const target = path.join(folder, "photo.jpg");
      yield* fileSystem.writeFile(source, photo);
      const converted = yield* printed(
        SIPS,
        ["-s", "format", "jpeg", source, "--out", target],
        ANSWER_WITHIN,
      );
      if (Result.isFailure(converted)) return Option.none();
      return Option.some(yield* fileSystem.readFile(target));
    }),
  ).pipe(
    // Note that a folder that could not be written or a JPEG that could not be read is a photo not converted, which the panel says.
    Effect.catch(() => Effect.succeed(Option.none<Uint8Array>())),
    Effect.provide(services),
  );
