/**
 * gif-frames.ts -- whether a GIF's bytes hold one frame, the still picture every model takes, or an animation, which OpenAI's take only as a still.
 *
 * A message may carry a GIF (`AGENT_ATTACHMENT_TYPE.GIF`), handed to each
 * harness as an image block as it came. Claude reads an animation's first
 * frame, and OpenAI's models, which Codex and some of Cursor's run, take a
 * GIF only where it is no animation, so a message carries a still GIF alone,
 * and the wire refuses an animation.
 * The frames are counted by walking the file's blocks, never by a decoder,
 * so the wire reads it alike in a window and in the service. Kept free of
 * every other import, because `agent-wire.ts` reads it.
 */

/** A GIF's first bytes, either version's. */
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;

/** The bytes the header and the logical screen descriptor take, before any color table. */
const SCREEN_END = 13;

/** The byte opening each block that follows the screen. */
const BLOCK = {
  EXTENSION: 0x21,
  IMAGE: 0x2c,
  TRAILER: 0x3b,
} as const;

/** The bytes an image descriptor takes after its opening byte, through its packed field. */
const IMAGE_DESCRIPTOR_BYTES = 9;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The bytes a color table takes, as a packed field states it: present by its top bit, sized by its low three. */
function colorTableBytes(packed: number): number {
  return (packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1);
}

/** Where a run of data sub-blocks ends, past its empty closing one; past the end where it is cut short. */
function pastSubBlocks(bytes: Uint8Array, at: number): number {
  let next = at;

  while (next < bytes.length) {
    const size = bytes[next] ?? 0;
    next += 1 + size;

    if (size === 0) return next;
  }

  return bytes.length + 1;
}

/** Whether the bytes are a GIF, of either version, by their signature. */
export function isGif(bytes: Uint8Array): boolean {
  return startsWith(bytes, GIF87A) || startsWith(bytes, GIF89A);
}

/**
 * How many frames a GIF holds, counted by its image descriptors, stopping
 * at a second since only one or more matters; nothing where the bytes are
 * no GIF or a block is no GIF's.
 */
function framesUpToTwo(bytes: Uint8Array): number | undefined {
  if (!isGif(bytes) || bytes.length < SCREEN_END) return undefined;
  let at = SCREEN_END + colorTableBytes(bytes[10] ?? 0);
  let frames = 0;

  while (at < bytes.length && frames < 2) {
    const block = bytes[at];

    if (block === BLOCK.TRAILER) break;

    if (block === BLOCK.EXTENSION) {
      // Note that an extension's label byte comes before its sub-blocks.
      at = pastSubBlocks(bytes, at + 2);
      continue;
    }

    if (block !== BLOCK.IMAGE) return undefined;
    frames += 1;
    const packed = bytes[at + IMAGE_DESCRIPTOR_BYTES] ?? 0;
    // Note that the image's LZW code size byte comes before its sub-blocks.
    at = pastSubBlocks(bytes, at + 1 + IMAGE_DESCRIPTOR_BYTES + colorTableBytes(packed) + 1);
  }

  return frames;
}

/** Whether the bytes are a GIF of one frame; an animation, a GIF with none, and any other bytes are not. */
export function isStillGif(bytes: Uint8Array): boolean {
  return framesUpToTwo(bytes) === 1;
}
