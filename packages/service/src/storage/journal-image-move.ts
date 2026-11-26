/**
 * journal-image-move.ts -- the sweep's one-off move of the images developers' lines kept as `data:` URLs in the journal into conversation pictures whose bytes stand in the Blob store.
 *
 * A row the migration queued (`journal_image_move`) is taken a few at a
 * time. Each image part's bytes are decoded, sniffed, and measured as a line's
 * image is when it is kept (`agents/attached-files.ts`). Bytes the
 * conversation already keeps are named by the picture kept; any others are
 * written to the store under an id minted here, read back, and compared by
 * their hash. Then the row is settled in one transaction
 * (`@repo/database/models/journal-image-moves`), which writes the pictures
 * and rewrites the parts only where the row still holds the parts as they
 * were read. Whatever was uploaded but never named by a row is tombstoned
 * once the transaction has ended, so the purge deletes it. A row whose image
 * cannot be kept as a picture is marked and passed over, and a deployment
 * that names no store moves nothing. Nothing here logs a URL or a byte.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  type AttachmentUpload,
  tombstoneUnwrittenUploads,
} from "@repo/database/models/attachment-blob-tombstones";
import {
  dropJournalImageMove,
  failJournalImageMove,
  type HeldJournalPicture,
  type JournalImagePart,
  type JournalImageRewrite,
  type JournalImageRow,
  readJournalImageMoves,
  readJournalImageRow,
  readKeptJournalPictures,
  type StoredJournalPicture,
  settleJournalImageRow,
} from "@repo/database/models/journal-image-moves";
import {
  JOURNAL_IMAGE_MOVE_FAILURE,
  type JournalImageMoveFailure,
} from "@repo/database/schemas/journal-image-move";
import { CONVERSATION_PICTURE_BOUNDS } from "@repo/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@repo/features/image-signature";
import type { InboxImageType } from "@repo/features/inbox-wire";
import { Data, Effect, Option } from "effect";
import { JOURNAL_IMAGE_MOVE } from "../maintenance/maintenance-bounds.js";
import { attachmentBlobPath } from "./attachment-blob-paths.js";
import { BLOB_STORE_FAILURE, BlobStore, BlobStoreFailure } from "./blob-store.js";

/** An image's bytes as decoded from its part, with what they were sniffed and measured to be. */
interface DecodedImage {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType: InboxImageType;
  readonly width: number;
  readonly height: number;
}

/** What the store answered for an object it was handed was not the bytes it was handed. */
export class JournalImageReadBackMismatch extends Data.TaggedError("JournalImageReadBackMismatch")<{
  readonly messageId: string;
}> {}

/** Whether the store failed only because this deployment names none, which no retry this minute would mend. */
const isUnconfigured = (failure: unknown): failure is BlobStoreFailure =>
  failure instanceof BlobStoreFailure && failure.reason === BLOB_STORE_FAILURE.UNCONFIGURED;

/** An image that cannot be kept as a picture, and why. */
interface RefusedImage {
  readonly refused: JournalImageMoveFailure;
}

/** Whether an image was refused rather than decoded. */
const isRefused = (decoded: DecodedImage | RefusedImage): decoded is RefusedImage =>
  "refused" in decoded;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The image a part's `data:` URL holds, sniffed and measured, or why it cannot be kept as a picture. */
function decodedImageOf(image: JournalImagePart): DecodedImage | RefusedImage {
  const { url } = image.part;
  const comma = url.indexOf(",");

  if (!url.startsWith("data:") || !url.slice(0, comma).endsWith(";base64")) {
    return { refused: JOURNAL_IMAGE_MOVE_FAILURE.UNSUPPORTED };
  }

  const bytes = new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));

  if (bytes.byteLength > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES) {
    return { refused: JOURNAL_IMAGE_MOVE_FAILURE.TOO_LARGE };
  }

  const contentType = sniffImageType(bytes);
  const dimensions = contentType === undefined ? undefined : imageDimensions(bytes, contentType);

  if (contentType === undefined || dimensions === undefined) {
    return { refused: JOURNAL_IMAGE_MOVE_FAILURE.UNSUPPORTED };
  }

  return { bytes, sha256: sha256Hex(bytes), contentType, ...dimensions };
}

/**
 * Stores each image the conversation does not keep yet, once per distinct
 * hash, and answers the picture each hash is to be named by. Each upload is
 * recorded before it is made, so one that fails partway is still tombstoned.
 */
const storeImages = (
  row: JournalImageRow,
  decoded: readonly DecodedImage[],
  uploads: AttachmentUpload[],
) =>
  Effect.gen(function* () {
    const store = yield* BlobStore;
    const distinct = new Map(decoded.map((image) => [image.sha256, image]));
    const held = yield* readKeptJournalPictures(row.conversationId, [...distinct.keys()]);
    const pictures = new Map<string, HeldJournalPicture | StoredJournalPicture>();

    for (const [sha256, image] of distinct) {
      const heldId = held.get(sha256);

      if (heldId !== undefined) {
        pictures.set(sha256, { id: heldId });
        continue;
      }

      const id = randomUUID();
      const blobKey = attachmentBlobPath(id);

      uploads.push({ id, keys: [blobKey] });
      yield* store.put(blobKey, image.bytes, image.contentType);
      const readBack = yield* store.get(blobKey);

      if (Option.isNone(readBack) || sha256Hex(readBack.value) !== sha256) {
        return yield* new JournalImageReadBackMismatch({ messageId: row.messageId });
      }

      pictures.set(sha256, {
        id,
        blobKey,
        sha256,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        byteCount: image.bytes.byteLength,
      });
    }

    return pictures;
  });

/** Moves one queued row's images, answering how many of its parts were rewritten. */
const moveRow = (messageId: string) =>
  Effect.gen(function* () {
    const found = yield* readJournalImageRow(messageId);

    if (Option.isNone(found) || found.value.images.length === 0) {
      yield* dropJournalImageMove(messageId);

      return 0;
    }

    const row = found.value;
    const images: { image: JournalImagePart; decoded: DecodedImage }[] = [];

    for (const image of row.images) {
      const decoded = decodedImageOf(image);

      if (isRefused(decoded)) {
        yield* failJournalImageMove(messageId, decoded.refused);
        yield* Effect.logWarning(`a journal row's image cannot be kept: ${decoded.refused}`);

        return 0;
      }

      images.push({ image, decoded });
    }

    const uploads: AttachmentUpload[] = [];

    // Note that the tombstones are written after the settle's transaction has ended, whatever it answered.
    return yield* Effect.gen(function* () {
      const pictures = yield* storeImages(
        row,
        images.map((one) => one.decoded),
        uploads,
      );

      const rewrites = images.flatMap(({ image, decoded: one }): JournalImageRewrite[] => {
        const picture = pictures.get(one.sha256);

        return picture === undefined ? [] : [{ ...image, picture }];
      });

      const settlement = yield* settleJournalImageRow(row, rewrites);

      return settlement.rewritten;
    }).pipe(
      Effect.ensuring(Effect.ignore(Effect.suspend(() => tombstoneUnwrittenUploads(uploads)))),
    );
  });

/**
 * Moves a sweep's worth of queued rows, answering how many parts it
 * rewrote. Note that a row a failure stops leaves the rest for the next
 * sweep, and that a deployment with no store stops at the first upload.
 */
export const moveJournalImages = /* @__PURE__ */ Effect.fn("storage/moveJournalImages")(
  function* () {
    const queued = yield* readJournalImageMoves(JOURNAL_IMAGE_MOVE.ROWS_PER_SWEEP);
    let rewritten = 0;

    for (const messageId of queued) {
      const moved = yield* moveRow(messageId).pipe(
        Effect.map(Option.some),
        Effect.catchIf(isUnconfigured, () => Effect.succeed(Option.none<number>())),
      );

      if (Option.isNone(moved)) break;
      rewritten += moved.value;
    }

    return rewritten;
  },
);
