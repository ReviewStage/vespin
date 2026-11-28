/**
 * attachment-bytes.ts -- an attachment's bytes wherever its row keeps them: in the row, or read from the Blob store by its key.
 *
 * A read of an attachment answers where its bytes stand
 * (`@repo/database/models/attachment-body`), and every reader of the bytes
 * themselves (a look at a picture, a copy into another row, a file handed
 * to an agent again) loads them here. A stored object the store no longer
 * holds reads as none, as a row that is gone does, since the row's delete
 * is what removes its objects.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { ATTACHMENT_BODY, type AttachmentBody } from "@repo/database/models/attachment-body";
import { readConversationPicture } from "@repo/database/models/conversation-pictures";
import type { ConversationMediaType } from "@repo/features/conversation-picture-wire";
import { Effect, Option } from "effect";
import { BlobStore, type BlobStoreFailure } from "./blob-store.js";

/** The body's bytes: the row's own, or the stored object's; nothing where the store holds no such object. */
export function attachmentBytes(
  body: AttachmentBody,
): Effect.Effect<Option.Option<Uint8Array>, BlobStoreFailure> {
  return Effect.gen(function* () {
    if (body.kind === ATTACHMENT_BODY.INLINE) return Option.some(body.bytes);
    const store = yield* BlobStore;

    return yield* store.get(body.blobKey);
  });
}

/**
 * One kept picture of the conversation with its bytes, wherever its row
 * keeps them (`readConversationPicture`); nothing where the conversation
 * keeps no such picture or the store no longer holds its bytes.
 */
export function readConversationPictureBytes(
  conversationId: string,
  id: string,
): Effect.Effect<
  Option.Option<{ readonly contentType: ConversationMediaType; readonly bytes: Uint8Array }>,
  StoreFailure | BlobStoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const picture = yield* readConversationPicture(conversationId, id);

    if (Option.isNone(picture)) return Option.none();
    const bytes = yield* attachmentBytes(picture.value.body);

    return Option.map(bytes, (read) => ({ contentType: picture.value.contentType, bytes: read }));
  });
}
