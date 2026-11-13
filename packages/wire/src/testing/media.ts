/**
 * media.ts -- synthetic picture and video files for tests: the bytes a reader sniffs and measures, and nothing more.
 *
 * A picture is a PNG's signature and header chunk, which states its size; a
 * WebM is a Matroska file's EBML header, naming its doctype, and one video
 * track that states its size, with no frames, since every reader of one
 * reads no further than the track; an MP4 is its file type, then its index
 * holding one H.264 track whose header states its size, then its media.
 */

/** A PNG's signature and header chunk, stating the size given, its last byte marked so two of one size differ. */
export function pngBytes(width: number, height: number, mark = 0): Uint8Array {
  const header = new Uint8Array(33);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(header.buffer).setUint32(16, width);
  new DataView(header.buffer).setUint32(20, height);
  header[32] = mark;

  return header;
}

/** One EBML element: its ID's bytes, its size in one byte, and its body. */
function ebml(id: readonly number[], body: readonly number[]): number[] {
  return [...id, 0x80 | body.length, ...body];
}

/** A Matroska file of the doctype given, a WebM's by default, whose one video track states the size, with no frames. */
export function webmBytes(width: number, height: number, docType = "webm"): Uint8Array {
  const video = ebml(
    [0xe0],
    [...ebml([0xb0], [width >> 8, width & 0xff]), ...ebml([0xba], [height >> 8, height & 0xff])],
  );

  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], ebml([0xae], video));

  return new Uint8Array([
    ...ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], [...new TextEncoder().encode(docType)])),
    ...ebml([0x18, 0x53, 0x80, 0x67], tracks),
  ]);
}

/** One MP4 box: its 32-bit size, its type, and what it holds. */
function mp4Box(type: string, payload: readonly number[]): number[] {
  const size = 8 + payload.length;

  return [
    size >>> 24,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...ascii(type),
    ...payload,
  ];
}

function ascii(word: string): number[] {
  return [...word].map((letter) => letter.charCodeAt(0));
}

/**
 * An H.264 MP4 whose one track's header states the size given, its index
 * ahead of its media as a player streams it, or behind it where
 * `mediaFirst`; no frames, since every reader of one reads no further than
 * the index.
 */
export function mp4Bytes(width: number, height: number, mediaFirst = false): Uint8Array {
  // A version 0 track header: its version and flags, then 72 bytes of times, ids, layer, volume, and matrix, then the size in 16.16 fixed point.
  const header = new Uint8Array(84);
  new DataView(header.buffer).setUint32(76, width * 0x10000);
  new DataView(header.buffer).setUint32(80, height * 0x10000);

  const track = mp4Box("trak", [
    ...mp4Box("tkhd", [...header]),
    ...mp4Box("stsd", mp4Box("avc1", [])),
  ]);

  const index = mp4Box("moov", track);
  const media = mp4Box("mdat", [0, 0, 0, 0]);

  return new Uint8Array([
    ...mp4Box("ftyp", ascii("isom")),
    ...(mediaFirst ? [...media, ...index] : [...index, ...media]),
  ]);
}

/** The bytes given, padded with zeros to the length given, so a test reaches a bound with a file a reader still sniffs. */
export function paddedTo(bytes: Uint8Array, length: number): Uint8Array {
  const padded = new Uint8Array(length);
  padded.set(bytes);

  return padded;
}
