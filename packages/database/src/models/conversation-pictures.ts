import { createHash } from "node:crypto";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type ConversationMediaType,
  conversationMediaTypeSchema,
  type KeptPicture,
} from "@repo/features/conversation-picture-wire";
import { and, eq, inArray, sum } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * conversation-pictures.ts -- the pictures a conversation's tools answered, kept once each beside the transcript that names them.
 *
 * A tool hands each picture in as it settles the call that answered it
 * (`show-image.ts`, `browser-tool.ts`), already sniffed and measured, and
 * writes the id this answers into the stored output in the bytes' place.
 * A picture is keyed by the hash of its bytes within its conversation, so
 * handing the same one in again answers the row already kept, and a call
 * made twice keeps nothing twice. A conversation keeps at
 * most `MAX_BYTES_PER_CONVERSATION` of pictures, read off the rows' byte
 * counts; a picture that would take it past them is not kept, and the
 * caller names it as not kept. A read names the conversation beside the
 * picture, so whoever reads has settled first that the reader may read
 * that conversation, as every transcript read does.
 */

/** A picture to keep, or a video shown as one: its bytes, the type they were sniffed to be, and the size their header states. */
export interface PictureToKeep {
  readonly bytes: Uint8Array;
  readonly contentType: ConversationMediaType;
  readonly width: number;
  readonly height: number;
}

/** A kept picture as a read answers it: the type it is served under, and its bytes. */
export type StoredPicture = typeof StoredPictureSchema.Type;

const KeptRowSchema = Schema.Struct({
  id: Schema.String,
  contentType: conversationMediaTypeSchema,
  width: Schema.Int,
  height: Schema.Int,
  byteCount: Schema.Int,
});

const KEPT_COLUMNS = {
  id: attachment.id,
  contentType: attachment.contentType,
  width: attachment.width,
  height: attachment.height,
  byteCount: attachment.byteCount,
};

/** A kept row with the hash it is keyed by, so a set's rows are matched back to its pictures. */
const KeptHashRowSchema = Schema.Struct({ ...KeptRowSchema.fields, sha256: Schema.String });

const KEPT_HASH_COLUMNS = { ...KEPT_COLUMNS, sha256: attachment.sha256 };

const findByHashes = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, sha256s: Schema.Array(Schema.String) }),
  Result: KeptHashRowSchema,
  execute: ({ conversationId, sha256s }) =>
    Database.use((db) =>
      db
        .select(KEPT_HASH_COLUMNS)
        .from(attachment)
        .where(
          and(eq(attachment.conversationId, conversationId), inArray(attachment.sha256, sha256s)),
        ),
    ),
});

const sumKept = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({ kept: Schema.NullOr(Schema.Number) }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ kept: sum(attachment.byteCount).mapWith(Number) })
        .from(attachment)
        .where(eq(attachment.conversationId, conversationId)),
    ),
});

const PictureRowSchema = Schema.Struct({
  sha256: Schema.String,
  contentType: conversationMediaTypeSchema,
  width: Schema.Int,
  height: Schema.Int,
  bytes: Schema.Uint8Array,
});

const insertPictures = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    pictures: Schema.Array(PictureRowSchema),
    now: Schema.Date,
  }),
  Result: KeptHashRowSchema,
  execute: ({ userId, conversationId, pictures, now }) =>
    Database.use((db) =>
      db
        .insert(attachment)
        .values(
          pictures.map(({ bytes, ...row }) => ({
            ...row,
            userId,
            conversationId,
            bytes,
            byteCount: bytes.byteLength,
            createdAt: now,
          })),
        )
        .onConflictDoNothing({
          target: [attachment.conversationId, attachment.sha256],
        })
        .returning(KEPT_HASH_COLUMNS),
    ),
});

const StoredPictureSchema = Schema.Struct({
  contentType: conversationMediaTypeSchema,
  bytes: Schema.Uint8Array,
});

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String }),
  Result: StoredPictureSchema,
  execute: ({ conversationId, id }) =>
    Database.use((db) =>
      db
        .select({
          contentType: attachment.contentType,
          bytes: attachment.bytes,
        })
        .from(attachment)
        .where(and(eq(attachment.conversationId, conversationId), eq(attachment.id, id))),
    ),
});

/** A kept row as a stored output names it. */
function keptPicture(row: typeof KeptRowSchema.Type): KeptPicture {
  return {
    id: row.id,
    mediaType: row.contentType,
    width: row.width,
    height: row.height,
    byteCount: row.byteCount,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The rows of `found` by the hash each is keyed by. */
function byHash(
  found: readonly (typeof KeptHashRowSchema.Type)[],
): ReadonlyMap<string, KeptPicture> {
  return new Map(found.map((row) => [row.sha256, keptPicture(row)]));
}

/**
 * Keeps a set of pictures beside the conversation, and answers each as a
 * stored output names it, in the order handed in: the row already kept for
 * the same bytes, or a new one; nothing where keeping the set's new bytes
 * would take the conversation past its bytes, so a set is kept whole or not
 * at all. The set is read, summed, and written in a statement each rather
 * than a few a picture. Note that a write that raced another to the same
 * bytes reads the winner's row, because the insert stands down on the hash
 * rather than failing.
 */
export function keepConversationPictures(
  target: ConversationTarget,
  pictures: readonly PictureToKeep[],
): TaskStoreEffect<Option.Option<readonly KeptPicture[]>> {
  return Effect.gen(function* () {
    const { conversationId } = target;
    const hashed = pictures.map((picture) => ({ ...picture, sha256: sha256Hex(picture.bytes) }));
    const sha256s = [...new Set(hashed.map((picture) => picture.sha256))];
    const held = byHash(yield* findByHashes({ conversationId, sha256s }));
    // Note that bytes the set names twice are kept once.
    const fresh = [
      ...new Map(
        hashed
          .filter((picture) => !held.has(picture.sha256))
          .map((picture) => [picture.sha256, picture]),
      ).values(),
    ];
    let kept = held;
    if (fresh.length > 0) {
      const [summed] = yield* sumKept({ conversationId });
      const keptBytes = summed?.kept ?? 0;
      const freshBytes = fresh.reduce((total, picture) => total + picture.bytes.byteLength, 0);
      if (keptBytes + freshBytes > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION) {
        return Option.none();
      }
      const now = yield* DateTime.nowAsDate;
      const inserted = byHash(
        yield* insertPictures({ userId: target.userId, conversationId, pictures: fresh, now }),
      );
      const raced = fresh
        .map((picture) => picture.sha256)
        .filter((sha256) => !inserted.has(sha256));
      const winners =
        raced.length === 0
          ? new Map<string, KeptPicture>()
          : byHash(yield* findByHashes({ conversationId, sha256s: raced }));
      kept = new Map([...held, ...inserted, ...winners]);
    }
    const answered: KeptPicture[] = [];
    for (const { sha256 } of hashed) {
      const one = kept.get(sha256);
      if (one === undefined) return Option.none();
      answered.push(one);
    }
    return Option.some(answered);
  });
}

/** Keeps one picture beside the conversation, as `keepConversationPictures` keeps a set of one. */
export function keepConversationPicture(
  target: ConversationTarget,
  picture: PictureToKeep,
): TaskStoreEffect<Option.Option<KeptPicture>> {
  return Effect.map(
    keepConversationPictures(target, [picture]),
    Option.flatMap(([one]) => Option.fromNullishOr(one)),
  );
}

/** One kept picture of the conversation: its type and its bytes; nothing where the conversation keeps no such picture. */
export function readConversationPicture(
  conversationId: string,
  id: string,
): TaskStoreEffect<Option.Option<StoredPicture>> {
  return findPicture({ conversationId, id });
}
