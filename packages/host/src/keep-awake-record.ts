import { isKeepAwake, KEEP_AWAKE_DEFAULT, type KeepAwake } from "@repo/settings";
import { Duration, Effect, Option, Path, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { folderMoves } from "./folder-moves.js";

/**
 * keep-awake-record.ts -- how a Mac's host keeps the Mac awake (`keep-awake.json` in `vespin-host`'s state), as This Mac's app hands it over.
 *
 * The choice is the desktop's setting (`@repo/settings`'s `keep-awake.ts`),
 * kept in the app's own store, which the host, a process of its own, never
 * reads; so the app writes it into the host's state folder whenever the
 * settings are told again (`compose-this-mac-host.ts`), and the host follows
 * the file as that folder moves (`daemon/host-keep-awake.ts`). A host no app
 * hands a choice, a Mac added with the install command, reads none and keeps
 * the default. The file is written beside itself and moved over itself, so a
 * read never meets half of one.
 */

/** The choice's file, in the host's state. */
const KEEP_AWAKE_FILE = "keep-awake.json";

/** How long the state folder stands still after a change before the choice is read, so the several pulses of one write read it once. */
const RECORD_SETTLE = Duration.millis(250);

const KeepAwakeRecordSchema = Schema.Struct({ keepAwake: Schema.String });

const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(KeepAwakeRecordSchema));
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(KeepAwakeRecordSchema));

/** The choice the host's state holds, the default where none was handed or it does not read. */
export const readKeepAwake = Effect.fnUntraced(function* (stateRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fileSystem
    .readFileString(path.join(stateRoot, KEEP_AWAKE_FILE))
    .pipe(Effect.orElseSucceed(() => ""));
  return Option.match(decodeRecord(text), {
    onNone: () => KEEP_AWAKE_DEFAULT,
    onSome: ({ keepAwake }): KeepAwake => (isKeepAwake(keepAwake) ? keepAwake : KEEP_AWAKE_DEFAULT),
  });
});

/**
 * The choice handed to the host, where its state folder stands and holds
 * another: a Mac whose host was never installed gets no folder made for it,
 * and a choice already there is not written again, so the write's own move
 * of the folder reads as nothing new.
 */
export const handKeepAwake = Effect.fnUntraced(function* (stateRoot: string, choice: KeepAwake) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!(yield* fileSystem.exists(stateRoot))) return;
  const file = path.join(stateRoot, KEEP_AWAKE_FILE);
  const kept = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
  if (Option.exists(decodeRecord(kept), (record) => record.keepAwake === choice)) return;
  const written = `${file}.writing`;
  yield* fileSystem.writeFileString(written, `${encodeRecord({ keepAwake: choice })}\n`);
  yield* fileSystem.rename(written, file);
});

/** The choice the host's state holds, read at once and again each time the folder settles after a move, said only when it changed. */
export const keepAwakeChoices = (
  stateRoot: string,
): Stream.Stream<KeepAwake, never, FileSystem.FileSystem | Path.Path> =>
  Stream.merge(folderMoves(stateRoot), Stream.succeed(undefined)).pipe(
    Stream.debounce(RECORD_SETTLE),
    Stream.mapEffect(() => readKeepAwake(stateRoot)),
    Stream.changes,
  );
