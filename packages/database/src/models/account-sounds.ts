/**
 * account-sounds.ts -- the sounds an account keeps of its own: added under a name, renamed, removed, read back, and chosen for one of its two sounds, each by the account alone.
 *
 * Every statement is keyed by the caller's own account, so no account reads,
 * renames, removes, or chooses another's sound (`../schemas/account-sound.ts`):
 * a sound of another account answers as one that is not there. An add
 * answers the hash its bytes are named by on the account's live read, and a
 * read answers it beside them, so a client that holds a sound knows which
 * it holds.
 */

import { createHash } from "node:crypto";
import {
  type Sound,
  type SoundClip,
  type SoundClipSlot,
  soundClipSlotSchema,
  soundClipTypeSchema,
} from "@repo/features/sound-clip-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { accountSound, accountSoundChoice } from "../schemas/account-sound.js";

type SoundEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** A sound's clip as a read answers it: its bytes under its type, and their hash. */
export interface KeptSoundClip extends SoundClip {
  readonly sha256: string;
}

/** One sound of one account. */
const SoundKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** The row one account's one sound stands in. */
function owned({ userId, id }: typeof SoundKeySchema.Type) {
  return and(eq(accountSound.userId, userId), eq(accountSound.id, id));
}

const SoundRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  sha256: Schema.String,
});

const SOUND_COLUMNS = { id: accountSound.id, name: accountSound.name, sha256: accountSound.sha256 };

const insertSound = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    contentType: soundClipTypeSchema,
    sha256: Schema.String,
    bytes: Schema.Uint8Array,
    now: Schema.Date,
  }),
  Result: SoundRowSchema,
  execute: ({ userId, name, contentType, sha256, bytes, now }) =>
    Database.use((db) =>
      db
        .insert(accountSound)
        .values({
          userId,
          name,
          contentType,
          sha256,
          byteCount: bytes.length,
          bytes,
          createdAt: now,
        })
        .returning(SOUND_COLUMNS),
    ),
});

const upsertChoice = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    slot: soundClipSlotSchema,
    soundId: Schema.String,
  }),
  execute: ({ userId, slot, soundId }) =>
    Database.use((db) =>
      db
        .insert(accountSoundChoice)
        .values({ userId, slot, soundId })
        .onConflictDoUpdate({
          target: [accountSoundChoice.userId, accountSoundChoice.slot],
          set: { soundId },
        }),
    ),
});

const deleteChoice = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, slot: soundClipSlotSchema }),
  execute: ({ userId, slot }) =>
    Database.use((db) =>
      db
        .delete(accountSoundChoice)
        .where(and(eq(accountSoundChoice.userId, userId), eq(accountSoundChoice.slot, slot))),
    ),
});

const findChoice = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, slot: soundClipSlotSchema }),
  Result: Schema.Struct({ soundId: Schema.String }),
  execute: ({ userId, slot }) =>
    Database.use((db) =>
      db
        .select({ soundId: accountSoundChoice.soundId })
        .from(accountSoundChoice)
        .where(and(eq(accountSoundChoice.userId, userId), eq(accountSoundChoice.slot, slot))),
    ),
});

const renameRow = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...SoundKeySchema.fields, name: Schema.String }),
  Result: SoundRowSchema,
  execute: ({ name, ...key }) =>
    Database.use((db) =>
      db.update(accountSound).set({ name }).where(owned(key)).returning(SOUND_COLUMNS),
    ),
});

const deleteSound = SqlSchema.void({
  Request: SoundKeySchema,
  execute: (key) => Database.use((db) => db.delete(accountSound).where(owned(key))),
});

const findSound = SqlSchema.findOneOption({
  Request: SoundKeySchema,
  Result: SoundRowSchema,
  execute: (key) =>
    Database.use((db) => db.select(SOUND_COLUMNS).from(accountSound).where(owned(key))),
});

const findClip = SqlSchema.findOneOption({
  Request: SoundKeySchema,
  Result: Schema.Struct({
    contentType: soundClipTypeSchema,
    sha256: Schema.String,
    bytes: Schema.Uint8Array,
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          contentType: accountSound.contentType,
          sha256: accountSound.sha256,
          bytes: accountSound.bytes,
        })
        .from(accountSound)
        .where(owned(key)),
    ),
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Keeps `clip` as a sound of the account's under `name`, chosen at once for `slot` where one is named, and answers the sound kept. */
export function addSound(
  userId: string,
  name: string,
  clip: SoundClip,
  slot?: SoundClipSlot,
): SoundEffect<Sound> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        const sha256 = sha256Hex(clip.bytes);
        // An insert that answered no row is the database breaking its own contract, not an outcome.
        const sound = yield* insertSound({
          userId,
          name,
          contentType: clip.contentType,
          sha256,
          bytes: clip.bytes,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
        if (slot !== undefined) yield* upsertChoice({ userId, slot, soundId: sound.id });
        return sound;
      }),
    ),
  );
}

/** One of the account's sounds renamed; nothing where it keeps no such sound. */
export function renameSound(
  userId: string,
  id: string,
  name: string,
): SoundEffect<Option.Option<Sound>> {
  return renameRow({ userId, id, name });
}

/** One of the account's sounds removed, and every choice of it with it; a sound it keeps not is left as it is, so a removal retried answers the same. */
export function removeSound(userId: string, id: string): SoundEffect<void> {
  return deleteSound({ userId, id });
}

/** One of the account's own sounds' clips; nothing where it keeps no such sound. */
export function readSoundClip(
  userId: string,
  id: string,
): SoundEffect<Option.Option<KeptSoundClip>> {
  return findClip({ userId, id });
}

/**
 * Which of the account's sounds its `slot` sound plays: `id`, or none to let
 * it go. Answers the sound it now plays: where `id` names no sound the
 * account keeps, which chooses nothing, the one it played before, or none.
 */
export function chooseSound(
  userId: string,
  slot: SoundClipSlot,
  id: string | null,
): SoundEffect<string | null> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (id === null) {
          yield* deleteChoice({ userId, slot });
          return null;
        }
        const sound = yield* findSound({ userId, id });
        if (Option.isNone(sound)) {
          const standing = yield* findChoice({ userId, slot });
          return Option.match(standing, { onNone: () => null, onSome: (choice) => choice.soundId });
        }
        yield* upsertChoice({ userId, slot, soundId: id });
        return id;
      }),
    ),
  );
}
