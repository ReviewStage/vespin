/**
 * mirror-match-worker.ts -- the matching process's side of `mirror-match-remote.ts`: each match it is sent run in turn and answered under its id.
 *
 * The desktop's matching process (`apps/desktop/src/utility/mirror-match.ts`)
 * runs this over its parent port, with the machine's file system provided;
 * neither is named here. The hashes each mirror's matches read are kept for
 * the life of the process, by the mirror's folder, so a mirror that connects
 * again reads only the files that changed since. A match that fails is
 * answered with no paths, so the asking side always hears back.
 */

import type { WireBoundaryInput } from "@repo/wire";
import { Effect, Exit, Option, type Path, Queue, Schema } from "effect";
import type * as FileSystem from "effect/FileSystem";
import { type KnownHashes, mirrorMatched } from "./mirror-disk.js";
import { type mirrorMatchAnswerSchema, mirrorMatchRequestSchema } from "./mirror-match-remote.js";

/** The port the matching process is asked over: what it is sent, and where it answers. */
export interface MirrorMatchParentPort {
  readonly onMessage: (listener: (message: WireBoundaryInput) => void) => void;
  readonly postMessage: (message: typeof mirrorMatchAnswerSchema.Encoded) => void;
}

/**
 * Answers every match `port` is sent, one at a time in the order sent, for
 * as long as the process runs. Note that a message that is not a match is
 * passed over with a warning: it carries no id to answer under.
 */
export function serveMirrorMatch(
  port: MirrorMatchParentPort,
): Effect.Effect<never, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const sent = yield* Queue.unbounded<unknown>();
    const knownByMirror = new Map<string, KnownHashes>();

    port.onMessage((message) => {
      Queue.offerUnsafe(sent, message);
    });

    const answer = (request: typeof mirrorMatchRequestSchema.Type) =>
      Effect.gen(function* () {
        const known = knownByMirror.get(request.root) ?? new Map();
        knownByMirror.set(request.root, known);

        // Note that a match that failed or died is answered with no paths, so the asking side is never left waiting.
        const asked = yield* Effect.exit(
          mirrorMatched(request.root, request.listed, request.files, known),
        );

        port.postMessage(
          Exit.isSuccess(asked) ? { id: request.id, asked: asked.value } : { id: request.id },
        );
      });

    return yield* Effect.forever(
      Effect.flatMap(Queue.take(sent), (message) =>
        Option.match(Schema.decodeUnknownOption(mirrorMatchRequestSchema)(message), {
          onNone: () => Effect.logWarning("The matching process was sent what is not a match"),
          onSome: answer,
        }),
      ),
    );
  });
}
