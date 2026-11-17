/**
 * retired-entity-file.ts -- the file an older build kept the account's lists and queues in, `entities.sealed`, deleted unread at launch and at sign-out.
 *
 * The account's lists and queues stand in its local database
 * (`local-copy.ts`). A build before this one imported the file's waiting
 * writes and refused messages into it once, so what is left of the file is
 * never read: a launch that finds it deletes it, with a temporary file a
 * cut-off write left beside it, as a sign-out does.
 */

import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

/** The retired file, beside the settings file in the state root. */
export const ENTITY_STORE_FILE_NAME = "entities.sealed";

/** Deletes the retired file under `directory`, kept for whichever account, and its temporary file, unread. */
export const forgetEntityStore = Effect.fn("host/forgetEntityStore")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_STORE_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});
