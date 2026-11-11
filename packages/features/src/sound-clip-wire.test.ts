import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import {
  SOUND_CLIP_BOUNDS,
  SOUND_CLIP_TYPE,
  soundClipDataUrlSchema,
  soundClipOfDataUrl,
} from "./sound-clip-wire.js";

/**
 * sound-clip-wire.test.ts -- a clip is read off its `data:` URL only where
 * its label names the type its own bytes open as, and kept only within its
 * byte bound.
 */

/** A WAV's opening bytes, followed by `padding` bytes of silence. */
const wav = (padding: number) =>
  Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVE", "latin1"), Buffer.alloc(padding)]);

const urlOf = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

test("a clip reads only under the type its bytes open as", () => {
  assert.equal(soundClipOfDataUrl(urlOf(SOUND_CLIP_TYPE.WAV, wav(4)))?.contentType, "audio/wav");
  assert.equal(soundClipOfDataUrl(urlOf(SOUND_CLIP_TYPE.MP3, wav(4))), undefined);
});

test("a clip past its byte bound is no clip to keep", () => {
  const is = Schema.is(soundClipDataUrlSchema);
  assert.ok(is(urlOf(SOUND_CLIP_TYPE.WAV, wav(SOUND_CLIP_BOUNDS.MAX_BYTES - 12))));
  assert.ok(!is(urlOf(SOUND_CLIP_TYPE.WAV, wav(SOUND_CLIP_BOUNDS.MAX_BYTES - 11))));
});
