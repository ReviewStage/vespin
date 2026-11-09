/**
 * video-signature.ts -- what a video's first bytes say it is: a WebM, or not, and the size in pixels its video track states; and whether an MP4 copy of one is one iOS's player streams.
 *
 * An agent records what it did in its sandbox as a WebM, the one format the
 * encoder already in its sandbox writes (Playwright's `recordVideo`, or the
 * browser's screencast piped through that encoder), and shows it as it
 * shows a picture (`coder-host/show-image.ts`). As with a picture, the
 * file's name says nothing of what it holds and the type is what it is
 * served under, so the bytes are sniffed: an EBML header opens every
 * Matroska file, and its doctype says which is a WebM. The size is read off
 * the first video track's entry, which stands before the first cluster of
 * frames, so a reader can hold the video's place before its bytes arrive.
 *
 * EBML, in short: every element is an ID and a size, each a variable-length
 * integer whose leading zero bits say how many more bytes it takes; a size
 * of all ones is unknown, as a muxer writing a live stream leaves the
 * segment's, and such an element runs to the end of its parent.
 */

import { Schema } from "effect";

/** The media type a WebM is kept and served under. */
export const WEBM_TYPE = "video/webm";

/** The media type a recording's MP4 copy is served under. */
export const MP4_TYPE = "video/mp4";

/**
 * The video a reader plays, as it asks an attachment read for one
 * (`Accept`): a WebM, as the web and the desktop play, or an MP4, as
 * iOS's player plays, which a recording kept with an MP4 copy is answered
 * as and one kept without it answers its WebM.
 */
export const PLAYABLE_VIDEO_TYPE = { WEBM: WEBM_TYPE, MP4: MP4_TYPE } as const;

export type PlayableVideoType = (typeof PLAYABLE_VIDEO_TYPE)[keyof typeof PLAYABLE_VIDEO_TYPE];

/** A playable video type as a request or an act carries it. */
export const playableVideoTypeSchema = Schema.Literals(Object.values(PLAYABLE_VIDEO_TYPE));

/**
 * The bound on a recording's MP4 copy, which the service keeps beside its
 * WebM for a player that plays no WebM (iOS's AVPlayer): the most bytes a
 * function answers whole, as the WebM's own bound is, so the read serves
 * either. It is counted in no owner's bound, which count the WebM alone.
 */
export const PHONE_VIDEO_BOUNDS = {
  MAX_BYTES: 4_000_000,
} as const;

/** The four bytes every EBML file opens with: the EBML header's ID. */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;

/** The IDs read on the way to the size: the containers walked into, and the elements read. */
const EBML_ID = {
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  VIDEO: 0xe0,
  PIXEL_WIDTH: 0xb0,
  PIXEL_HEIGHT: 0xba,
  CLUSTER: 0x1f43b675,
} as const;

/** The doctype a WebM's header names. */
const WEBM_DOC_TYPE = "webm";

/** The containers walked into on the way from the segment to a video track's size. */
const WALKED: ReadonlySet<number> = new Set([
  EBML_ID.SEGMENT,
  EBML_ID.TRACKS,
  EBML_ID.TRACK_ENTRY,
  EBML_ID.VIDEO,
]);

/** One variable-length integer: its value, and how many bytes it took; an all-ones size reads as unknown. */
interface Vint {
  readonly value: number;
  readonly length: number;
  readonly unknown: boolean;
}

/**
 * The variable-length integer at `at`: an ID keeps its length marker, a
 * size drops it. Nothing where it runs past the bytes or is longer than
 * eight bytes.
 */
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length += 1;
  if (length > 8 || at + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[at + index] ?? 0;
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** One element's header: its ID, where its body starts, and where it ends, the bytes' end for an unknown size. */
interface ElementHeader {
  readonly id: number;
  readonly body: number;
  readonly end: number;
}

function readHeader(bytes: Uint8Array, at: number, limit: number): ElementHeader | undefined {
  const id = readVint(bytes, at, true);
  if (id === undefined) return undefined;
  const size = readVint(bytes, at + id.length, false);
  if (size === undefined) return undefined;
  const body = at + id.length + size.length;
  const end = size.unknown ? limit : Math.min(limit, body + size.value);
  return { id: id.value, body, end };
}

/** An unsigned integer element's value, big-endian over its body. */
function readUint(bytes: Uint8Array, from: number, to: number): number {
  let value = 0;
  for (let at = from; at < to; at += 1) value = value * 256 + (bytes[at] ?? 0);
  return value;
}

/** Whether the bytes open with an EBML header, as every WebM does; enough to sniff a stream's first chunk by, which `webmDimensions` then holds to the doctype. */
export function startsLikeWebm(bytes: Uint8Array): boolean {
  return EBML_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** The doctype the EBML header at the start names, or nothing where there is none. */
function docTypeOf(bytes: Uint8Array): string | undefined {
  if (!startsLikeWebm(bytes)) return undefined;
  const header = readHeader(bytes, 0, bytes.length);
  if (header === undefined) return undefined;
  for (let at = header.body; at < header.end; ) {
    const child = readHeader(bytes, at, header.end);
    if (child === undefined) return undefined;
    if (child.id === EBML_ID.DOC_TYPE) {
      // A string element may be padded with zero bytes, which are no part of it.
      let end = child.end;
      while (end > child.body && bytes[end - 1] === 0) end -= 1;
      return String.fromCharCode(...bytes.subarray(child.body, end));
    }
    at = child.end;
  }
  return undefined;
}

/** A video's size in pixels, as its first video track states it. */
export interface VideoDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * The size a WebM's first video track states; nothing where the bytes are
 * no WebM, or no video track's size stands before its first cluster.
 */
export function webmDimensions(bytes: Uint8Array): VideoDimensions | undefined {
  if (docTypeOf(bytes) !== WEBM_DOC_TYPE) return undefined;
  const header = readHeader(bytes, 0, bytes.length);
  if (header === undefined) return undefined;
  let width = 0;
  let height = 0;
  // A stack of where each container walked into ends, so its siblings are read after it.
  const ends: number[] = [bytes.length];
  let at = header.end;
  while (at < bytes.length) {
    while (ends.length > 1 && at >= (ends.at(-1) ?? bytes.length)) ends.pop();
    const element = readHeader(bytes, at, ends.at(-1) ?? bytes.length);
    if (element === undefined || element.id === EBML_ID.CLUSTER) break;
    if (element.id === EBML_ID.PIXEL_WIDTH) width = readUint(bytes, element.body, element.end);
    if (element.id === EBML_ID.PIXEL_HEIGHT) height = readUint(bytes, element.body, element.end);
    if (width > 0 && height > 0) return { width, height };
    if (WALKED.has(element.id)) {
      ends.push(element.end);
      at = element.body;
    } else {
      at = element.end;
    }
  }
  return undefined;
}

/** The four-character types of the MP4 boxes read: the file type, the movie's index, its media, and an H.264 sample entry. */
const MP4_BOX = { FTYP: "ftyp", MOOV: "moov", MDAT: "mdat", AVC1: "avc1" } as const;

/** The ASCII of the four bytes at `at`. */
function fourCc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/** Whether the bytes hold the ASCII of `word` anywhere between `from` and `to`. */
function holdsWord(bytes: Uint8Array, word: string, from: number, to: number): boolean {
  for (let at = from; at + word.length <= to; at += 1) {
    if (fourCc(bytes, at) === word) return true;
  }
  return false;
}

/**
 * Whether the bytes are an MP4 iOS's player streams as it arrives: an
 * `ftyp` box first, the movie's index (`moov`) before its media
 * (`mdat`), as ffmpeg's `+faststart` moves it, and an H.264 track in the
 * index. Each top-level box is a 32-bit big-endian size and a type; a size
 * of 1 is a 64-bit size after the type, and a size of 0 runs to the end.
 */
export function streamableMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || fourCc(bytes, 4) !== MP4_BOX.FTYP) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 8 <= bytes.length) {
    const short = view.getUint32(at);
    const type = fourCc(bytes, at + 4);
    const size =
      short === 1 && at + 16 <= bytes.length
        ? Number(view.getBigUint64(at + 8))
        : short === 0
          ? bytes.length - at
          : short;
    if (size < 8 || at + size > bytes.length) return false;
    if (type === MP4_BOX.MDAT) return false;
    if (type === MP4_BOX.MOOV) return holdsWord(bytes, MP4_BOX.AVC1, at + 8, at + size);
    at += size;
  }
  return false;
}
