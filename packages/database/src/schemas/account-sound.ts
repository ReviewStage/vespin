import {
  SOUND_CLIP_BOUNDS,
  SOUND_CLIP_SLOT,
  type SoundClipSlot,
  type SoundClipType,
} from "@repo/features/sound-clip-wire";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bound, bytea, literal, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * account-sound.ts -- the sounds an account keeps of its own, each a clip it named, and which of them each of its two sounds plays.
 *
 * A sound's bytes stand in its own row, since this deployment keeps no blob
 * store, held to the bound a request can carry (`SOUND_CLIP_BOUNDS`); no
 * bound is set on how many an account keeps. The media type is what the
 * service sniffed the bytes to be (`@repo/features/audio-signature`), which
 * they are served under, and the hash names the clip on the account's live
 * read, so a client fetches it again only once it changed. The name is the
 * one the member gave it; the file's own name is never kept.
 *
 * A choice records which sound one of the account's two sounds plays
 * (`SOUND_CLIP_SLOT`), and names its sound by the account and the sound
 * together, so it can only name a sound of the same account, and goes with
 * the sound when the sound is removed. Every row leaves with the account by
 * its cascade.
 */
export const accountSound = pgTable(
  "account_sound",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The name the member gave it. */
    name: text("name").notNull(),
    /** The media type the bytes were sniffed to be: what they are served under. */
    contentType: text("content_type").$type<SoundClipType>().notNull(),
    /** The hex SHA-256 of the bytes, which the account's live read carries. */
    sha256: text("sha256").notNull(),
    /** How many bytes it is, read off the row without the bytes. */
    byteCount: integer("byte_count").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    // The account's sounds are listed by the account, in the order it added them.
    index("account_sound_user").on(table.userId, table.createdAt),
    // A choice names a sound by its account and its id, so it can name no other account's.
    unique("account_sound_user_id").on(table.userId, table.id),
    // A sound is held to the bound a request can carry here as well as on the wire, so no writer keeps a larger one.
    check(
      "account_sound_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${bound(SOUND_CLIP_BOUNDS.MAX_BYTES)} and octet_length(${table.bytes}) = ${table.byteCount}`,
    ),
    check(
      "account_sound_name_bound",
      sql`char_length(${table.name}) between 1 and ${bound(SOUND_CLIP_BOUNDS.MAX_NAME_CHARS)}`,
    ),
  ],
);

export const accountSoundChoice = pgTable(
  "account_sound_choice",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Which of the account's sounds plays it. */
    slot: text("slot").$type<SoundClipSlot>().notNull(),
    soundId: uuid("sound_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.slot] }),
    foreignKey({
      name: "account_sound_choice_sound_fkey",
      columns: [table.userId, table.soundId],
      foreignColumns: [accountSound.userId, accountSound.id],
    }).onDelete("cascade"),
    check(
      "account_sound_choice_slot",
      sql`${table.slot} in (${sql.join(
        Object.values(SOUND_CLIP_SLOT).map((slot) => literal(slot)),
        sql`, `,
      )})`,
    ),
  ],
);
