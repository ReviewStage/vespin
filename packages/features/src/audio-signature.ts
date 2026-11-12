/**
 * audio-signature.ts -- what a sound clip's first bytes say it is: a WAV, an MP3, an M4A, an AAC stream, or an Ogg, or none of them.
 *
 * A file's name and a `data:` URL's label say nothing about what the bytes
 * hold, and a clip is served under its type, so a clip an account keeps is
 * sniffed by its signature, as a picture is (`image-signature.ts`): by the
 * Settings row that picks it, before it travels, and by the service that
 * keeps it. Each type is one Chromium decodes, the desktop's and the web
 * tab's alike, so a clip the service keeps is one either can play.
 */

/** The types a sound clip may be, each one Chromium's `decodeAudioData` reads. */
export const AUDIO_TYPE = {
  WAV: "audio/wav",
  MP3: "audio/mpeg",
  M4A: "audio/mp4",
  AAC: "audio/aac",
  OGG: "audio/ogg",
} as const;

export type AudioType = (typeof AUDIO_TYPE)[keyof typeof AUDIO_TYPE];

/** The bytes a signature is read from: WAV's reaches the twelfth. */
export const AUDIO_SIGNATURE_BYTES = 12;

const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WAVE = [0x57, 0x41, 0x56, 0x45] as const;
const ID3 = [0x49, 0x44, 0x33] as const;
const FTYP = [0x66, 0x74, 0x79, 0x70] as const;
const OGGS = [0x4f, 0x67, 0x67, 0x53] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  return signature.every((byte, index) => bytes[at + index] === byte);
}

/**
 * The type an MPEG audio frame's header says: eleven set bits of sync, then
 * the layer, which is zero for an AAC stream's ADTS header and one of the
 * three MPEG layers for an MP3's; nothing where the bytes open on no frame.
 */
function frameType(bytes: Uint8Array): AudioType | undefined {
  const [first, second] = bytes;

  if (first !== 0xff || second === undefined || (second & 0xe0) !== 0xe0) return undefined;

  return (second & 0x06) === 0 ? AUDIO_TYPE.AAC : AUDIO_TYPE.MP3;
}

/** The type the bytes' signature says they are, or nothing for bytes that are none of them. */
export function sniffAudioType(bytes: Uint8Array): AudioType | undefined {
  if (startsWith(bytes, RIFF) && startsWith(bytes, WAVE, 8)) return AUDIO_TYPE.WAV;

  // Note that an ID3 tag opens most MP3s ahead of their first frame.
  if (startsWith(bytes, ID3)) return AUDIO_TYPE.MP3;

  if (startsWith(bytes, FTYP, 4)) return AUDIO_TYPE.M4A;

  if (startsWith(bytes, OGGS)) return AUDIO_TYPE.OGG;

  return frameType(bytes);
}
