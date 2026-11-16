import { AUDIO_TYPE, sniffAudioType } from "./audio-signature.js";
import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
  isAudioType,
} from "./conversation-picture-wire.js";
import { imageDimensions, sniffImageType } from "./image-signature.js";
import { INBOX_FILE_TYPE } from "./inbox-wire.js";
import {
  mp4Dimensions,
  mp4IsSoundOnly,
  startsLikeMp4,
  startsLikeWebm,
  webmDimensions,
} from "./video-signature.js";

/**
 * media-signature.ts -- what a shown or posted file's bytes say it is: one of the three pictures, a recording an agent made (a WebM or an H.264 MP4), a sound clip it made (a WAV, an MP3, an M4A, an AAC stream, or an Ogg), or a PDF an agent posts, and the size a picture or a recording states.
 *
 * An agent may show the developer a recording of what it did, or a sound
 * clip it made, wherever it may show a picture: in its transcript
 * (`show_media`), in the developer's inbox, and in its task's description.
 * Each reads the file from the agent's sandbox and sniffs it here, so the
 * one rule for what a file is holds in all of them. A WebM's opening bytes
 * say only that it is Matroska; its doctype and size are read off the whole
 * file (`measuredMedia`), and one that states neither is no video a reader
 * can hold the place of. An MP4's say only that it is ISO media, which a
 * video and an M4A clip both are: it is a video where it is an H.264 one
 * whose index stands before its media, which every player streams, at the
 * size its track states, and a clip where its index names a sound track and
 * no video; so its type is settled only once the whole file is read. A
 * clip's other types are told by their opening bytes alone
 * (`audio-signature.ts`), and a clip states no size. A post may name a PDF
 * as well, which every PDF's opening `%PDF-` says it is, and which is kept
 * as a file rather than drawn.
 */

/** The bytes every PDF opens with: `%PDF-`. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/** What a file a post names may be: a picture, a recording, or a PDF. */
export type PostedFileType = ConversationMediaType | typeof INBOX_FILE_TYPE.PDF;

/** Whether a file's first bytes say it is a PDF. */
export function startsLikePdf(head: Uint8Array): boolean {
  return PDF_SIGNATURE.every((byte, index) => head[index] === byte);
}

/**
 * The type a file's first bytes say it is: a picture's, a recording's, or a
 * sound clip's, which `measuredMedia` then holds to its doctype or its
 * codec. Note that an `ftyp` box opens an M4A as it opens an MP4, so it is
 * sniffed as an MP4 here and settled by `measuredMedia`.
 */
export function sniffMediaType(head: Uint8Array): ConversationMediaType | undefined {
  if (startsLikeWebm(head)) return CONVERSATION_MEDIA_TYPE.WEBM;

  if (startsLikeMp4(head)) return CONVERSATION_MEDIA_TYPE.MP4;

  return sniffImageType(head) ?? sniffAudioType(head);
}

/** The type a file a post names says it is: a picture's, a recording's, or a clip's as `sniffMediaType` reads it, or a PDF's. */
export function sniffPostedFileType(head: Uint8Array): PostedFileType | undefined {
  return sniffMediaType(head) ?? (startsLikePdf(head) ? INBOX_FILE_TYPE.PDF : undefined);
}

/** A whole file's type, settled from all of its bytes, and the size it states in pixels; zero by zero for a sound clip, which states none. */
export interface MeasuredMedia<Type extends ConversationMediaType = ConversationMediaType> {
  readonly contentType: Type;
  readonly width: number;
  readonly height: number;
}

/** A sound clip's type, with no size. */
function clip<Type extends ConversationMediaType>(contentType: Type): MeasuredMedia<Type> {
  return { contentType, width: 0, height: 0 };
}

/** The size a picture or a recording of the type states; nothing for a clip, which states none, or where it states no size. */
function sizeOf(bytes: Uint8Array, type: ConversationMediaType) {
  if (isAudioType(type)) return undefined;

  if (type === CONVERSATION_MEDIA_TYPE.WEBM) return webmDimensions(bytes);

  if (type === CONVERSATION_MEDIA_TYPE.MP4) return mp4Dimensions(bytes);

  return imageDimensions(bytes, type);
}

/**
 * The whole file's type and size, from the type its first bytes were
 * sniffed as: a WebM's video track's size, an MP4 that is an H.264 video a
 * player streams at its track's size or else an M4A clip where its index
 * names sound and no video, a clip's type with no size, or a picture's
 * header's size; nothing where it is none of these, such as a WebM or an
 * MP4 that states no size and holds no clip.
 */
export function measuredMedia<Type extends ConversationMediaType>(
  bytes: Uint8Array,
  sniffed: Type,
): MeasuredMedia<Type | typeof AUDIO_TYPE.M4A> | undefined {
  if (isAudioType(sniffed)) return clip(sniffed);
  const size = sizeOf(bytes, sniffed);

  if (size !== undefined) return { contentType: sniffed, ...size };

  return sniffed === CONVERSATION_MEDIA_TYPE.MP4 && mp4IsSoundOnly(bytes)
    ? clip(AUDIO_TYPE.M4A)
    : undefined;
}
