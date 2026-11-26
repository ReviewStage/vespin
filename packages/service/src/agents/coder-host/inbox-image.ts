import { posix } from "node:path";
import type { StoredAttachment, StoredPhoneCopy } from "@repo/database/models/attachment-body";
import { AGENT_BOUNDS } from "@repo/features/agent-wire";
import type { AUDIO_TYPE } from "@repo/features/audio-signature";
import { CONVERSATION_MEDIA_TYPE, isPlayedType } from "@repo/features/conversation-picture-wire";
import { SIGNATURE_BYTES } from "@repo/features/image-signature";
import { INBOX_BOUNDS, INBOX_FILE_TYPE, type InboxImageType } from "@repo/features/inbox-wire";
import {
  measuredMedia,
  type PostedFileType,
  sniffMediaType,
  sniffPostedFileType,
} from "@repo/features/media-signature";
import { Effect, Option, Result } from "effect";
import type { StoredInboxImage } from "../../inbox/inbox-store.js";
import {
  type AttachmentUploads,
  phoneCopyType,
  type ReservedUpload,
  readBackUpload,
  reserveAttachmentUpload,
  SANDBOX_UPLOAD_SECONDS,
  storeSandboxPhoneCopy,
} from "../../storage/attachment-uploads.js";
import { BlobStore, type BlobStoreFailure } from "../../storage/blob-store.js";
import { PHONE_COPY, type PhoneCopyKind } from "../machine/agent-machine.js";
import type { FileProbe, SandboxUpload } from "../machine/sandbox-upload.js";

/**
 * inbox-image.ts -- a picture read from the agent's sandbox, an image block's or one `show_media` shows: the file at the path the agent named, bounded, and sniffed for what it is.
 *
 * The agent names a file in its sandbox, a screenshot it took of what it
 * rendered, a WebM it recorded of a flow, or a sound clip it made, and
 * nothing else of it: no address, no type. The file is read here through
 * the same door the agent's own file tools reach the sandbox by, as a
 * stream: its first bytes are read for a PNG, JPEG, or WebP signature, or
 * a WebM's, an MP4's, or a clip's where the read takes one, as soon as
 * they are in, since the name a file
 * carries says nothing about what it holds and the type is what the
 * picture is served to the desktop under, so a file that is no image is
 * refused at its first chunk, and one past the bound is refused at the
 * bound, neither read whole into the function's memory. A path is resolved
 * from the checkout as the file tools resolve one, so the agent spells it
 * as it spelled it to them. Each refusal is one sentence the model reads,
 * naming the path, so the agent mends the block rather than the item. A
 * post's body may name a PDF the same way (`readSandboxBodyFile`), sniffed
 * by its `%PDF-` and held to a PDF's bound, which the post keeps as a file
 * of its message rather than drawing it.
 *
 * A file that is to be kept as an attachment is put in the Blob store as it
 * is read (`storeSandboxImage`, `storePhoneCopy`). Where the sandbox uploads
 * itself, as a cloud sandbox does, it is probed for its size and first
 * bytes, sniffed and held to its bound before anything moves, uploaded by
 * the sandbox to one presigned URL (`../machine/sandbox-upload.ts`), and
 * read back from the store, where it is sniffed again, so what is kept is
 * what the store holds, never what the sandbox said it sent; a file whose
 * bytes changed between the probe and the upload is refused. Where it does
 * not, as a Mac does not, it is read as before and put by the service.
 */

/**
 * The sandbox as the inbox reaches it: one file read as a stream of bytes,
 * or nothing where there is no file; and, where the door can, an MP4 made
 * of a WebM recording there, or an AAC M4A of an Ogg clip there
 * (`../machine/phone-video.ts`), or nothing where it made none, and one
 * file written under its attachments folder at the
 * relative path given, answering where it stands
 * (`../machine/agent-machine.ts`'s `writeFile`).
 */
interface InboxSandbox {
  /** Where the agent's checkout stands in it, which a relative path is resolved from. */
  readonly checkout: string;
  readonly readFile: (options: {
    readonly path: string;
  }) => PromiseLike<ReadableStream<Uint8Array> | null>;
  readonly phoneVideo?: (options: { readonly path: string }) => PromiseLike<Uint8Array | null>;
  readonly phoneAudio?: (options: { readonly path: string }) => PromiseLike<Uint8Array | null>;
  readonly writeFile?: (file: {
    readonly name: string;
    readonly contents: Uint8Array;
  }) => PromiseLike<string>;
  readonly selfUpload?: SandboxSelfUpload | undefined;
}

/** How a sandbox uploads a file to the Blob store itself (`../machine/agent-machine.ts`'s `SelfUpload`), as the door reaches it. */
export interface SandboxSelfUpload {
  readonly probe: (path: string, headBytes: number) => PromiseLike<FileProbe | null>;
  readonly upload: (path: string, upload: SandboxUpload) => PromiseLike<void>;
  readonly uploadPhoneCopy: (
    path: string,
    kind: PhoneCopyKind,
    upload: SandboxUpload,
  ) => PromiseLike<boolean>;
}

/** The door to the session's sandbox, opened on first use, or a test's double. */
export type InboxSandboxDoor = () => Promise<InboxSandbox>;

/** Why a picture was not read, in the words the model reads; each is followed by the path. */
export interface SandboxImageRefusals {
  readonly NO_FILE: string;
  readonly NOT_IMAGE: string;
  readonly TOO_LARGE: string;
  readonly UNREADABLE: string;
}

/**
 * What one tool's read of a picture holds it to: the most bytes it may be,
 * the sentence each refusal opens with, which names the tool's own act, and
 * the types its first bytes may be sniffed as, which `show_media` widens to
 * a recording or a sound clip it plays.
 */
export interface SandboxImageTerms<Type extends string = InboxImageType> {
  readonly maxBytes: number;
  readonly refusals: SandboxImageRefusals;
  readonly sniff: (head: Uint8Array) => Type | undefined;
}

/** A file read from the sandbox: the type its bytes were sniffed to be, and the bytes. */
export interface SandboxImage<Type extends string> {
  readonly contentType: Type;
  readonly bytes: Uint8Array;
}

/** The chunks as one array. */
function joined(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let at = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }

  return bytes;
}

/** Why a stream was not read whole: it is no image, or it ran past the bound. */
const STREAM_REFUSAL = {
  NOT_IMAGE: "not-image",
  TOO_LARGE: "too-large",
} as const;

type StreamRefusal = (typeof STREAM_REFUSAL)[keyof typeof STREAM_REFUSAL];

/**
 * The stream read whole as one picture: sniffed once its signature is in,
 * and stopped where it is no image or runs past the bound. The reader is
 * canceled however the read ends, so a stream refused, or one that failed
 * mid-way, holds nothing open behind it.
 */
const readImageStream = Effect.fnUntraced(function* <Type extends string>(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  sniff: (head: Uint8Array) => Type | undefined,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let contentType: Type | undefined;

  return yield* Effect.gen(function* () {
    while (true) {
      const next = yield* Effect.tryPromise(() => reader.read());

      if (next.done) break;
      chunks.push(next.value);
      length += next.value.byteLength;

      if (length > maxBytes) return Result.fail(STREAM_REFUSAL.TOO_LARGE);

      if (contentType === undefined && length >= SIGNATURE_BYTES) {
        contentType = sniff(joined(chunks, length).subarray(0, SIGNATURE_BYTES));

        if (contentType === undefined) return Result.fail(STREAM_REFUSAL.NOT_IMAGE);
      }
    }

    const bytes = joined(chunks, length);
    // A file shorter than the longest signature is sniffed whole, since a JPEG's is three bytes.
    contentType ??= sniff(bytes);

    if (contentType === undefined) return Result.fail(STREAM_REFUSAL.NOT_IMAGE);
    const image: SandboxImage<Type> = { contentType, bytes };

    return Result.succeed(image);
  }).pipe(Effect.ensuring(Effect.promise(() => reader.cancel().catch(() => undefined))));
});

/** A refusal of the picture at the path, in the words the model reads. */
function refused(refusal: string, path: string): Result.Result<never, string> {
  return Result.fail(`${refusal} ${path}`);
}

/** The stream's refusal in the words the model reads. */
function streamRefused<Type extends string>(
  refusal: StreamRefusal,
  refusals: SandboxImageRefusals,
  path: string,
): Result.Result<SandboxImage<Type>, string> {
  return refused(
    refusal === STREAM_REFUSAL.TOO_LARGE ? refusals.TOO_LARGE : refusals.NOT_IMAGE,
    path,
  );
}

/**
 * The picture at the path, read from the sandbox and held to the terms'
 * bound and the three types, or the one sentence refusing it in the terms'
 * words. A path is resolved from the sandbox's checkout: inside it when
 * relative, as written when absolute.
 */
export function readSandboxImage<Type extends string>(
  door: InboxSandboxDoor,
  path: string,
  terms: SandboxImageTerms<Type>,
): Effect.Effect<Result.Result<SandboxImage<Type>, string>> {
  return Effect.gen(function* () {
    const sandbox = yield* Effect.tryPromise(() => door());
    const resolved = posix.resolve(sandbox.checkout, path);
    const stream = yield* Effect.tryPromise(() => sandbox.readFile({ path: resolved }));

    if (stream === null) return refused(terms.refusals.NO_FILE, path);
    const read = yield* readImageStream(stream, terms.maxBytes, terms.sniff);

    return Result.isFailure(read) ? streamRefused<Type>(read.failure, terms.refusals, path) : read;
  }).pipe(Effect.catch(() => Effect.succeed(refused(terms.refusals.UNREADABLE, path))));
}

/**
 * The copy a phone plays of the media at the path, made in the sandbox
 * beside the file read from it, resolved from the checkout as the read
 * was: an MP4 of a WebM recording, or an AAC M4A of an Ogg clip; nothing
 * where the file is neither, the door makes none, or making it failed,
 * since the file is kept whole without its copy and the reads answer it.
 */
function phoneCopyOfSandbox(
  door: InboxSandboxDoor,
  path: string,
  contentType: PostedFileType,
): Effect.Effect<Uint8Array | undefined> {
  const video = contentType === CONVERSATION_MEDIA_TYPE.WEBM;

  if (!video && contentType !== CONVERSATION_MEDIA_TYPE.OGG) return Effect.succeed(undefined);

  return Effect.tryPromise(async () => {
    const sandbox = await door();
    const made = video ? sandbox.phoneVideo : sandbox.phoneAudio;

    return (await made?.({ path: posix.resolve(sandbox.checkout, path) })) ?? undefined;
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));
}

/** The most bytes a posted file of the type may be: a still's bound, a recording's or a clip's, or a PDF's. */
function postedBytesOf(type: PostedFileType): number {
  if (type === INBOX_FILE_TYPE.PDF) return AGENT_BOUNDS.MAX_PDF_BYTES;

  return isPlayedType(type) ? INBOX_BOUNDS.MAX_VIDEO_BYTES : INBOX_BOUNDS.MAX_IMAGE_BYTES;
}

/** A file a post keeps, as read from the sandbox and kept in the Blob store: the type its bytes were sniffed to be, the bytes, and where they stand, with a recording's or an Ogg clip's copy for a phone. */
export interface SandboxPostedFile<Type extends PostedFileType> extends SandboxImage<Type> {
  readonly stored: StoredAttachment;
}

/**
 * A posted file with its type settled from all of its bytes: a recording
 * held to the size it states, and an MP4 that holds sound and no video
 * kept as the M4A clip it is (`measuredMedia`); a still and a PDF as they
 * were sniffed. Nothing where a recording states no size and holds no clip.
 */
function settledPosted<Type extends PostedFileType>(
  file: SandboxImage<Type>,
): SandboxImage<Type | typeof AUDIO_TYPE.M4A> | undefined {
  const { contentType, bytes } = file;

  if (contentType === INBOX_FILE_TYPE.PDF || !isPlayedType(contentType)) return file;
  const measured = measuredMedia(bytes, contentType);

  return measured === undefined ? undefined : { ...file, contentType: measured.contentType };
}

/**
 * The stored object put again under the type its bytes were settled as,
 * where that is not the type it was sniffed and uploaded as: an MP4 of
 * sound alone kept as an M4A. Note that the store serves an object under
 * its own type to a reader it redirects, so the object's type follows the
 * row's.
 */
export function retypedStored(
  image: StoredSandboxImage<string>,
  contentType: string,
): Effect.Effect<void, BlobStoreFailure> {
  if (image.contentType === contentType) return Effect.void;

  return Effect.gen(function* () {
    const store = yield* BlobStore;
    yield* store.put(image.stored.blobKey, image.bytes, contentType);
  });
}

/**
 * A file a post keeps, at the path, of the types the sniff takes, kept in
 * the store with the copy its sandbox makes for a phone of a recording or
 * an Ogg clip, or the one sentence refusing it in the refusals' words: each
 * held to its type's bound, a recording refused where it states no size,
 * as `show_media` refuses one, and an MP4 that holds only sound kept as the
 * M4A it is (`@repo/features/media-signature`). Note that the file is held
 * to the largest bound as it is read and each type to its own once it is
 * known, because the type is sniffed from bytes the bound has already let
 * in.
 */
function storeSandboxPosted<Type extends PostedFileType>(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
  sniff: (head: Uint8Array) => Type | undefined,
): Effect.Effect<
  Result.Result<SandboxPostedFile<Type | typeof AUDIO_TYPE.M4A>, string>,
  BlobStoreFailure,
  AttachmentUploads
> {
  const terms = { maxBytes: INBOX_BOUNDS.MAX_VIDEO_BYTES, refusals, sniff };

  return Effect.gen(function* () {
    const read = yield* storeSandboxImage(door, path, terms);

    if (Result.isFailure(read)) return Result.fail(read.failure);
    const file = read.success;

    if (file.bytes.byteLength > postedBytesOf(file.contentType)) {
      return refused(refusals.TOO_LARGE, path);
    }

    const settled = settledPosted(file);

    if (settled === undefined) return refused(refusals.NOT_IMAGE, path);
    yield* retypedStored(file, settled.contentType);
    const phone = yield* storePhoneCopy(door, path, settled.contentType, file.reserved);
    const stored = phone === undefined ? file.stored : { ...file.stored, phone };

    return Result.succeed({ contentType: settled.contentType, bytes: file.bytes, stored });
  });
}

/**
 * A picture, a recording, or a sound clip a post draws, at the path, kept
 * in the store, a WebM recording or an Ogg clip with the copy its sandbox
 * makes of it for a phone, or the one sentence refusing it in the
 * refusals' words: a still held to the picture bound, and a recording or a
 * clip to the video bound, a recording refused where it states no size.
 */
export function storeSandboxMedia(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<Result.Result<StoredInboxImage, string>, BlobStoreFailure, AttachmentUploads> {
  return storeSandboxPosted(door, path, refusals, sniffMediaType);
}

/**
 * A file a post's body names, at the path, kept in the store: a picture, a
 * recording, or a clip as `storeSandboxMedia` keeps one, or a PDF held to a
 * PDF's bound, which the post keeps as a file of its message rather than
 * drawing it; or the one sentence refusing it in the refusals' words.
 */
export function storeSandboxBodyFile(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<
  Result.Result<SandboxPostedFile<PostedFileType>, string>,
  BlobStoreFailure,
  AttachmentUploads
> {
  return storeSandboxPosted(door, path, refusals, sniffPostedFileType);
}

/** A file read from the sandbox and kept in the Blob store: the type its bytes were sniffed to be, the bytes as the store holds them, and where they stand. */
export interface StoredSandboxImage<Type extends string> extends SandboxImage<Type> {
  readonly stored: StoredAttachment;
  readonly reserved: ReservedUpload;
}

/** A file kept in the store as read, answered with what it was kept under. */
function keptAs<Type extends string>(
  image: SandboxImage<Type>,
  reserved: ReservedUpload,
): StoredSandboxImage<Type> {
  return {
    ...image,
    reserved,
    stored: { id: reserved.id, blobKey: reserved.blobKey, byteCount: image.bytes.byteLength },
  };
}

/** The file at the path, read as before and put in the store by the service, for a sandbox that uploads nothing itself. */
function readAndPut<Type extends string>(
  door: InboxSandboxDoor,
  path: string,
  terms: SandboxImageTerms<Type>,
): Effect.Effect<
  Result.Result<StoredSandboxImage<Type>, string>,
  BlobStoreFailure,
  AttachmentUploads
> {
  return Effect.gen(function* () {
    const read = yield* readSandboxImage(door, path, terms);

    if (Result.isFailure(read)) return Result.fail(read.failure);
    const reserved = yield* reserveAttachmentUpload;
    const store = yield* BlobStore;
    yield* store.put(reserved.blobKey, read.success.bytes, read.success.contentType);

    return Result.succeed(keptAs(read.success, reserved));
  });
}

/**
 * The file at the path uploaded by the sandbox itself: probed, sniffed, and
 * held to the bound; uploaded to a URL presigned for that type and bound
 * alone; and read back from the store and sniffed again, refused where it
 * no longer sniffs as it did, and read and put by the service where nothing
 * landed. A sandbox that fails is the file unreadable,
 * as a read that fails is; a store that fails fails the call.
 */
function uploadedBySandbox<Type extends string>(
  door: InboxSandboxDoor,
  sandbox: InboxSandbox & { readonly selfUpload: SandboxSelfUpload },
  path: string,
  terms: SandboxImageTerms<Type>,
): Effect.Effect<
  Result.Result<StoredSandboxImage<Type>, string>,
  BlobStoreFailure,
  AttachmentUploads
> {
  return Effect.gen(function* () {
    const resolved = posix.resolve(sandbox.checkout, path);

    const probe = yield* Effect.tryPromise(() =>
      sandbox.selfUpload.probe(resolved, SIGNATURE_BYTES),
    ).pipe(Effect.option);

    if (Option.isNone(probe)) return refused(terms.refusals.UNREADABLE, path);

    if (probe.value === null) return refused(terms.refusals.NO_FILE, path);

    if (probe.value.size > terms.maxBytes) return refused(terms.refusals.TOO_LARGE, path);
    const contentType = terms.sniff(probe.value.head);

    if (contentType === undefined) return refused(terms.refusals.NOT_IMAGE, path);
    const reserved = yield* reserveAttachmentUpload;
    const store = yield* BlobStore;

    const presigned = yield* store.presignPut(reserved.blobKey, {
      contentType,
      maxBytes: terms.maxBytes,
      validForSeconds: SANDBOX_UPLOAD_SECONDS,
    });

    // Note that what the run answers is not read: what landed is read back from the store.
    yield* Effect.tryPromise(() => sandbox.selfUpload.upload(resolved, presigned)).pipe(
      Effect.ignore,
    );

    const landed = yield* readBackUpload(reserved.blobKey, {
      contentType,
      maxBytes: terms.maxBytes,
    });

    // Note that an upload that never landed is read and put by the service, as a Mac's file is, so a sandbox the store refuses still keeps what it shows.
    if (Option.isNone(landed)) {
      yield* Effect.logWarning(
        "A sandbox's upload did not land in the Blob store; the service put it.",
      );

      return yield* readAndPut(door, path, terms);
    }

    if (terms.sniff(landed.value.subarray(0, SIGNATURE_BYTES)) !== contentType) {
      return refused(terms.refusals.NOT_IMAGE, path);
    }

    return Result.succeed(keptAs({ contentType, bytes: landed.value }, reserved));
  });
}

/**
 * The file at the path kept in the Blob store under a fresh id, read and
 * held as `readSandboxImage` holds it, with the bytes the store holds, or
 * the one sentence refusing it in the terms' words. The sandbox uploads it
 * itself where it can; otherwise the service reads and puts it. The upload
 * is recorded with the write standing around the call, which tombstones it
 * unless a row comes to take it.
 */
export function storeSandboxImage<Type extends string>(
  door: InboxSandboxDoor,
  path: string,
  terms: SandboxImageTerms<Type>,
): Effect.Effect<
  Result.Result<StoredSandboxImage<Type>, string>,
  BlobStoreFailure,
  AttachmentUploads
> {
  return Effect.gen(function* () {
    const sandbox = yield* Effect.tryPromise(() => door()).pipe(Effect.option);

    if (Option.isNone(sandbox)) return refused(terms.refusals.UNREADABLE, path);
    const { selfUpload } = sandbox.value;

    return selfUpload === undefined
      ? yield* readAndPut(door, path, terms)
      : yield* uploadedBySandbox(door, { ...sandbox.value, selfUpload }, path, terms);
  });
}

/**
 * The copy a phone plays of the media at the path, kept in the store beside
 * the file under the upload it was kept under: an MP4 of a WebM recording,
 * or an AAC M4A of an Ogg clip, made in the sandbox and uploaded by it where
 * it uploads itself, or read and put by the service where it does not;
 * nothing where the file is neither, no copy was made, or keeping it
 * failed, since the file is kept whole without its copy and the reads
 * answer it.
 */
export function storePhoneCopy(
  door: InboxSandboxDoor,
  path: string,
  contentType: PostedFileType,
  reserved: ReservedUpload,
): Effect.Effect<StoredPhoneCopy | undefined> {
  const copyType = phoneCopyType(contentType);

  if (copyType === undefined) return Effect.succeed(undefined);
  const kind = contentType === CONVERSATION_MEDIA_TYPE.WEBM ? PHONE_COPY.VIDEO : PHONE_COPY.AUDIO;

  return Effect.gen(function* () {
    const sandbox = yield* Effect.tryPromise(() => door());
    const { selfUpload } = sandbox;

    if (selfUpload !== undefined) {
      const resolved = posix.resolve(sandbox.checkout, path);

      return yield* storeSandboxPhoneCopy(copyType, reserved.phoneBlobKey, (presigned) =>
        Effect.tryPromise(() => selfUpload.uploadPhoneCopy(resolved, kind, presigned)),
      );
    }

    const bytes = yield* phoneCopyOfSandbox(door, path, contentType);

    if (bytes === undefined) return undefined;
    const store = yield* BlobStore;
    yield* store.put(reserved.phoneBlobKey, bytes, copyType);

    return { blobKey: reserved.phoneBlobKey, byteCount: bytes.byteLength };
  }).pipe(Effect.orElseSucceed(() => undefined));
}
