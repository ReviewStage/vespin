import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
} from "./conversation-picture-wire.js";
import { imageDimensions, sniffImageType } from "./image-signature.js";
import { INBOX_FILE_TYPE } from "./inbox-wire.js";
import { mp4Dimensions, startsLikeMp4, startsLikeWebm, webmDimensions } from "./video-signature.js";

/**
 * media-signature.ts -- what a shown or posted file's first bytes say it is: one of the three pictures, a recording an agent made (a WebM or an H.264 MP4), or a PDF an agent posts, and the size a picture or a recording states.
 *
 * An agent may show the developer a recording of what it did wherever it
 * may show a picture: in its transcript (`show_image`), and in the
 * developer's inbox. Each reads the file from the agent's sandbox and sniffs
 * it here, so the one rule for what a file is holds in both. A WebM's opening bytes say only that it is Matroska; its
 * doctype and size are read off the whole file (`mediaDimensions`), and one
 * that states neither is no video a reader can hold the place of. An MP4's
 * say only that it is ISO media; it is held to an H.264 one whose index
 * stands before its media, which every player streams, and to the size its
 * track states, the same way. A post
 * may name a PDF as well, which every PDF's opening `%PDF-` says it is,
 * and which is kept as a file rather than drawn.
 */

/** The bytes every PDF opens with: `%PDF-`. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/** What a file a post names may be: a picture, a recording, or a PDF. */
export type PostedFileType = ConversationMediaType | typeof INBOX_FILE_TYPE.PDF;

/** Whether a file's first bytes say it is a PDF. */
export function startsLikePdf(head: Uint8Array): boolean {
  return PDF_SIGNATURE.every((byte, index) => head[index] === byte);
}

/** The type a file's first bytes say it is: a picture's, or a recording's, which `mediaDimensions` then holds to its doctype or its codec. */
export function sniffMediaType(head: Uint8Array): ConversationMediaType | undefined {
  if (startsLikeWebm(head)) return CONVERSATION_MEDIA_TYPE.WEBM;

  if (startsLikeMp4(head)) return CONVERSATION_MEDIA_TYPE.MP4;

  return sniffImageType(head);
}

/** The type a file a post names says it is: a picture's or a recording's as `sniffMediaType` reads it, or a PDF's. */
export function sniffPostedFileType(head: Uint8Array): PostedFileType | undefined {
  return sniffMediaType(head) ?? (startsLikePdf(head) ? INBOX_FILE_TYPE.PDF : undefined);
}

/** The size a file of the given type states: a recording's video track's, or a picture's header's; nothing where it states none. */
export function mediaDimensions(bytes: Uint8Array, type: ConversationMediaType) {
  if (type === CONVERSATION_MEDIA_TYPE.WEBM) return webmDimensions(bytes);

  if (type === CONVERSATION_MEDIA_TYPE.MP4) return mp4Dimensions(bytes);

  return imageDimensions(bytes, type);
}
