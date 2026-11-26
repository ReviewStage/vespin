import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type ConversationMediaType,
  conversationMediaTypeSchema,
  type KeptPicture,
} from "@repo/features/conversation-picture-wire";
import {
  MP4_TYPE,
  PLAYABLE_VIDEO_TYPE,
  type PlayableVideoType,
  playableVideoTypeSchema,
} from "@repo/features/video-signature";
import { and, eq, exists, inArray, sql, sum } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { attachment, servedColumns } from "../schemas/attachment.js";
import { messages } from "../schemas/storage.js";
import {
  type AttachmentBody,
  attachmentBodyFields,
  attachmentBodyOf,
  phoneBodyFields,
  phoneBodyOf,
  type StoredAttachment,
  StoredAttachmentSchema,
  storedAttachmentColumns,
} from "./attachment-body.js";
import type { TaskStoreEffect } from "./task-store.js";
import { agentVisibleTo } from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * conversation-pictures.ts -- the pictures a conversation's tools answered, kept once each beside the transcript that names them.
 *
 * A tool hands each picture in as it settles the call that answered it
 * (`show-media.ts`, `browser-tool.ts`), already sniffed, measured, hashed,
 * and uploaded to the Blob store under a fresh id, and writes the id this
 * answers into the stored output in the bytes' place.
 * A picture is keyed by the hash of its bytes within its conversation, so
 * handing the same one in again answers the row already kept, and a call
 * made twice keeps nothing twice. A conversation keeps at
 * most `MAX_BYTES_PER_CONVERSATION` of pictures, read off the rows' byte
 * counts; a picture that would take it past them is not kept, and the
 * caller names it as not kept. A read names the conversation beside the
 * picture, so whoever reads has settled first that the reader may read
 * that conversation, as every transcript read does; the one read by the
 * picture's id alone, a copy of what an agent showed
 * (`readShownAgentPicture`), settles that itself.
 */

/** A picture to keep, or a video shown as one: its bytes as uploaded to the Blob store, with a recording's copy for a phone where its sandbox made one, the hex SHA-256 of its bytes, the type they were sniffed to be, and the size their header states. */
export interface PictureToKeep {
  readonly stored: StoredAttachment;
  readonly sha256: string;
  readonly contentType: ConversationMediaType;
  readonly width: number;
  readonly height: number;
}

/** A kept picture as a read answers it: the type it is served under, and where its bytes stand. */
export interface StoredPicture {
  readonly contentType: ConversationMediaType;
  readonly body: AttachmentBody;
}

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
  stored: StoredAttachmentSchema,
  sha256: Schema.String,
  contentType: conversationMediaTypeSchema,
  width: Schema.Int,
  height: Schema.Int,
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
          pictures.map(({ stored, ...row }) => ({
            ...row,
            ...storedAttachmentColumns(stored),
            userId,
            conversationId,
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
  ...attachmentBodyFields,
});

/** A kept picture as a reader is served it: a recording's MP4 copy where the reader plays MP4 and the row keeps one. */
export interface ServedPicture {
  readonly contentType: ConversationMediaType | typeof MP4_TYPE;
  readonly body: AttachmentBody;
}

const ServedPictureSchema = Schema.Struct({
  contentType: Schema.Union([conversationMediaTypeSchema, Schema.Literal(MP4_TYPE)]),
  ...attachmentBodyFields,
});

/** The picture's row, served as the reader plays a video. */
function pictureQuery(conversationId: string, id: string, playable: PlayableVideoType) {
  return Database.use((db) =>
    db
      .select(servedColumns(playable))
      .from(attachment)
      .where(and(eq(attachment.conversationId, conversationId), eq(attachment.id, id))),
  );
}

const findPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, id: Schema.String }),
  Result: StoredPictureSchema,
  execute: ({ conversationId, id }) => pictureQuery(conversationId, id, PLAYABLE_VIDEO_TYPE.WEBM),
});

const findServedPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({
    conversationId: Schema.String,
    id: Schema.String,
    playable: playableVideoTypeSchema,
  }),
  Result: ServedPictureSchema,
  execute: ({ conversationId, id, playable }) => pictureQuery(conversationId, id, playable),
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
 * rather than failing. A picture answered by a row already kept, or kept
 * by none, leaves its upload under an id no row takes, which its uploader
 * tombstones once the write is done (`tombstoneUnwrittenUploads`).
 */
export function keepConversationPictures(
  target: ConversationTarget,
  pictures: readonly PictureToKeep[],
): TaskStoreEffect<Option.Option<readonly KeptPicture[]>> {
  return Effect.gen(function* () {
    const { conversationId } = target;
    const sha256s = [...new Set(pictures.map((picture) => picture.sha256))];
    const held = byHash(yield* findByHashes({ conversationId, sha256s }));

    // Note that bytes the set names twice are kept once.
    const fresh = [
      ...new Map(
        pictures.flatMap((picture) =>
          held.has(picture.sha256) ? [] : [[picture.sha256, picture] as const],
        ),
      ).values(),
    ];

    let kept = held;

    if (fresh.length > 0) {
      const [summed] = yield* sumKept({ conversationId });
      const keptBytes = summed?.kept ?? 0;
      const freshBytes = fresh.reduce((total, picture) => total + picture.stored.byteCount, 0);

      if (keptBytes + freshBytes > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION) {
        return Option.none();
      }

      const now = yield* DateTime.nowAsDate;

      const inserted = byHash(
        yield* insertPictures({ userId: target.userId, conversationId, pictures: fresh, now }),
      );

      const raced = fresh.flatMap(({ sha256 }) => (inserted.has(sha256) ? [] : [sha256]));

      const winners =
        raced.length === 0
          ? new Map<string, KeptPicture>()
          : byHash(yield* findByHashes({ conversationId, sha256s: raced }));

      kept = new Map([...held, ...inserted, ...winners]);
    }

    const answered: KeptPicture[] = [];

    for (const { sha256 } of pictures) {
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

/** One kept picture of the conversation: its type and where its bytes stand; nothing where the conversation keeps no such picture. */
export function readConversationPicture(
  conversationId: string,
  id: string,
): TaskStoreEffect<Option.Option<StoredPicture>> {
  return Effect.map(
    findPicture({ conversationId, id }),
    Option.map(({ contentType, ...row }) => ({ contentType, body: attachmentBodyOf(row) })),
  );
}

/** One kept picture of the conversation as a reader that plays the video given is served it: a recording's MP4 copy where it plays MP4 and one is kept, and its WebM otherwise; nothing where the conversation keeps no such picture. */
export function readServedConversationPicture(
  conversationId: string,
  id: string,
  playable: PlayableVideoType,
): TaskStoreEffect<Option.Option<ServedPicture>> {
  return Effect.map(
    findServedPicture({ conversationId, id, playable }),
    Option.map(({ contentType, ...row }) => ({ contentType, body: attachmentBodyOf(row) })),
  );
}

/** A picture an agent showed, as a copy of it is made: its type, where its bytes stand, and where a recording's or a clip's copy for a phone stands, where one is kept. */
export interface ShownAgentPicture {
  readonly contentType: ConversationMediaType;
  readonly body: AttachmentBody;
  readonly phone: AttachmentBody | undefined;
}

const ShownAgentPictureSchema = Schema.Struct({
  contentType: conversationMediaTypeSchema,
  ...attachmentBodyFields,
  ...phoneBodyFields,
});

/**
 * Whether the conversation of the picture under the id holds a `show_media`
 * call that answered it, as its stored part names a kept picture by id
 * (`show-media.ts`).
 */
function shownByShowMedia(pictureId: string) {
  const part = [
    { type: `tool-${AGENT_TOOL.SHOW_MEDIA}`, output: { pictures: [{ id: pictureId }] } },
  ];

  return exists(
    queryBuilder
      .select({ one: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, attachment.conversationId),
          sql`${messages.parts} @> ${JSON.stringify(part)}::jsonb`,
        ),
      ),
  );
}

const findShownAgentPicture = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    pictureId: Schema.String,
  }),
  Result: ShownAgentPictureSchema,
  execute: ({ userId, organizationId, pictureId }) =>
    Database.use((db) =>
      db
        .select({
          contentType: attachment.contentType,
          bytes: attachment.bytes,
          blobKey: attachment.blobKey,
          mp4Bytes: attachment.mp4Bytes,
          phoneBlobKey: attachment.phoneBlobKey,
        })
        .from(attachment)
        .innerJoin(agentTable, eq(agentTable.conversationId, attachment.conversationId))
        .where(
          and(
            eq(attachment.id, pictureId),
            eq(agentTable.organizationId, organizationId),
            agentVisibleTo(userId),
            shownByShowMedia(pictureId),
          ),
        ),
    ),
});

/**
 * The picture, recording, or clip under the id, which `pictureId` must
 * spell as a UUID, where an agent of the workspace the account may read
 * (`agentVisibleTo`) showed it with `show_media` in its own transcript;
 * nothing otherwise. Note that every other picture beside a transcript
 * (a browser's screenshot, a Mac's window, a file a line handed the agent)
 * reads as none, because each is kept on terms of its own that a copy
 * elsewhere would break.
 */
export function readShownAgentPicture(
  reader: { readonly userId: string; readonly organizationId: string },
  pictureId: string,
): TaskStoreEffect<Option.Option<ShownAgentPicture>> {
  return Effect.map(
    findShownAgentPicture({ ...reader, pictureId }),
    Option.map((row) => ({
      contentType: row.contentType,
      body: attachmentBodyOf(row),
      phone: phoneBodyOf(row),
    })),
  );
}
