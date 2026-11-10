import assert from "node:assert/strict";
import { test } from "vitest";
import { AUDIO_TYPE, sniffAudioType } from "./audio-signature.js";

/**
 * audio-signature.test.ts -- a clip's type read from the opening bytes each
 * format writes, as its specification lays them out, and an MPEG frame's
 * layer telling an MP3 from an AAC stream.
 */

const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0));

test.each([
  ["a RIFF WAVE", [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVE")], AUDIO_TYPE.WAV],
  ["an ID3-tagged MP3", [...ascii("ID3"), 4, 0, 0, 0, 0, 0, 0], AUDIO_TYPE.MP3],
  ["a bare MPEG layer III frame", [0xff, 0xfb, 0x90, 0x64], AUDIO_TYPE.MP3],
  ["an ADTS AAC frame", [0xff, 0xf1, 0x50, 0x80], AUDIO_TYPE.AAC],
  ["an M4A", [0, 0, 0, 0x20, ...ascii("ftypM4A ")], AUDIO_TYPE.M4A],
  ["an Ogg page", [...ascii("OggS"), 0, 2], AUDIO_TYPE.OGG],
  ["a RIFF WebP", [...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP")], undefined],
  ["a PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], undefined],
])("%s reads as its type", (_name, head, type) => {
  assert.equal(sniffAudioType(new Uint8Array(head)), type);
});
