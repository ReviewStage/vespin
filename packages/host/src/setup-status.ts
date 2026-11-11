import { Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * setup-status.ts -- where a machine's own setup stands, kept in its state as the follower last registered it (`compose-local-agents.ts`), so `vespin-host status` reads it on the machine itself, and the install script waits on it: setting up while the device fetches its agents' tools, failed with our own words for why, or ready.
 */

/** Where the machine's setup stands. */
export const SETUP_STEP = {
  SETTING_UP: "setting_up",
  FAILED: "failed",
  READY: "ready",
} as const;

export type SetupStep = (typeof SETUP_STEP)[keyof typeof SETUP_STEP];

/** The file in the machine's state holding where its setup stands. */
const STATUS_FILE = "setup-status.json";

/** Where the setup stands, our own words for why it failed where it did, and when, in milliseconds since the epoch. */
const setupStatusSchema = Schema.Struct({
  step: Schema.Literals(Object.values(SETUP_STEP)),
  failure: Schema.optionalKey(Schema.String),
  at: Schema.Number,
});

export type SetupStatus = typeof setupStatusSchema.Type;

const setupStatusJson = Schema.fromJsonString(setupStatusSchema);
const decodeSetupStatus = Schema.decodeUnknownOption(setupStatusJson);
const encodeSetupStatus = Schema.encodeEffect(setupStatusJson);

/** Keeps where the machine's setup stands in its state; a write the disk refuses is let go, since it only tells a person. */
export const keepSetupStatus = (stateRoot: string, status: SetupStatus) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(stateRoot, { recursive: true, mode: 0o700 });
    yield* fileSystem.writeFileString(
      path.join(stateRoot, STATUS_FILE),
      yield* encodeSetupStatus(status),
    );
  }).pipe(Effect.ignore);

/** Where the machine's setup stands as its state keeps it; none before the follower first kept it, or where it cannot be read. */
export const readSetupStatus = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fileSystem.readFileString(path.join(stateRoot, STATUS_FILE));
    return decodeSetupStatus(text);
  }).pipe(Effect.orElseSucceed(() => Option.none<SetupStatus>()));
