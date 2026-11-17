import { posix } from "node:path";
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
import { Effect, Result } from "effect";
import type { InboxImage } from "../../inbox/inbox-store.js";

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
function refused<Type extends string>(
  refusal: string,
  path: string,
): Result.Result<SandboxImage<Type>, string> {
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

    if (stream === null) return refused<Type>(terms.refusals.NO_FILE, path);
    const read = yield* readImageStream(stream, terms.maxBytes, terms.sniff);

    return Result.isFailure(read) ? streamRefused<Type>(read.failure, terms.refusals, path) : read;
  }).pipe(Effect.catch(() => Effect.succeed(refused<Type>(terms.refusals.UNREADABLE, path))));
}

/**
 * The copy a phone plays of the media at the path, made in the sandbox
 * beside the file read from it, resolved from the checkout as the read
 * was: an MP4 of a WebM recording, or an AAC M4A of an Ogg clip; nothing
 * where the file is neither, the door makes none, or making it failed,
 * since the file is kept whole without its copy and the reads answer it.
 */
export function phoneCopyOfSandbox(
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

/** A file a post keeps, as read from the sandbox: the type its bytes were sniffed to be, the bytes, and a recording's or an Ogg clip's copy for a phone. */
export interface SandboxPostedFile<Type extends PostedFileType> extends SandboxImage<Type> {
  readonly mp4Bytes?: Uint8Array | undefined;
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
 * A file a post keeps, at the path, of the types the sniff takes, a
 * recording or an Ogg clip with the copy its sandbox makes of it for a
 * phone, or the one sentence refusing it in the refusals' words: each held
 * to its type's bound, a recording refused where it states no size, as
 * `show_media` refuses one, and an MP4 that holds only sound kept as the
 * M4A it is (`@repo/features/media-signature`). Note that the stream is
 * read to the largest bound and each type is held to its own once it is
 * known, because the type is sniffed from bytes the bound has already let
 * in.
 */
function readSandboxPosted<Type extends PostedFileType>(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
  sniff: (head: Uint8Array) => Type | undefined,
): Effect.Effect<Result.Result<SandboxPostedFile<Type | typeof AUDIO_TYPE.M4A>, string>> {
  const terms = { maxBytes: INBOX_BOUNDS.MAX_VIDEO_BYTES, refusals, sniff };

  const read = Effect.map(
    readSandboxImage(door, path, terms),
    Result.flatMap((file) => {
      if (file.bytes.byteLength > postedBytesOf(file.contentType)) {
        return refused<Type>(refusals.TOO_LARGE, path);
      }

      const settled = settledPosted(file);

      return settled === undefined
        ? refused<Type>(refusals.NOT_IMAGE, path)
        : Result.succeed(settled);
    }),
  );

  return Effect.flatMap(read, (file) =>
    Result.isFailure(file)
      ? Effect.succeed<Result.Result<SandboxPostedFile<Type | typeof AUDIO_TYPE.M4A>, string>>(file)
      : Effect.map(phoneCopyOfSandbox(door, path, file.success.contentType), (mp4Bytes) =>
          Result.succeed({ ...file.success, mp4Bytes }),
        ),
  );
}

/**
 * A picture, a recording, or a sound clip a post draws, at the path, a WebM
 * recording or an Ogg clip with the copy its sandbox makes of it for a
 * phone, or the one sentence refusing it in the refusals' words: a still
 * held to the picture bound, and a recording or a clip to the video bound,
 * a recording refused where it states no size.
 */
export function readSandboxMedia(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<Result.Result<InboxImage, string>> {
  return readSandboxPosted(door, path, refusals, sniffMediaType);
}

/**
 * A file a post's body names, at the path: a picture, a recording, or a
 * clip as `readSandboxMedia` reads one, or a PDF held to a PDF's bound, which the
 * post keeps as a file of its message rather than drawing it; or the one
 * sentence refusing it in the refusals' words.
 */
export function readSandboxBodyFile(
  door: InboxSandboxDoor,
  path: string,
  refusals: SandboxImageRefusals,
): Effect.Effect<Result.Result<SandboxPostedFile<PostedFileType>, string>> {
  return readSandboxPosted(door, path, refusals, sniffPostedFileType);
}
