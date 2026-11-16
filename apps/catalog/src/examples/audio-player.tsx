/**
 * audio-player.tsx -- a sound clip played in place of a picture, with its
 * Expand, and as the file viewer plays it, both on a short WAV the page
 * writes as it opens, since the catalog fetches nothing: a tone that swells
 * and fades twice, so its waveform has a shape to draw.
 */

import {
  AUDIO_PLAYER_PLACE,
  AudioPlayer,
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useMemo, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** The stand-in clip: its rate, its length in seconds, its pitch in hertz, and how many times it swells. */
const CLIP = { RATE: 8_000, SECONDS: 3, PITCH_HZ: 440, SWELLS: 2 } as const;

/** The bytes of a WAV's header before its samples, for mono 16-bit PCM. */
const WAV_HEADER_BYTES = 44;

/** The loudest a 16-bit sample stands. */
const SAMPLE_MAX = 0x7fff;

/** The stand-in clip as a 16-bit mono WAV's `data:` URL: a tone whose loudness swells and fades. */
function standInWav(): string {
  const count = CLIP.RATE * CLIP.SECONDS;
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES + count * 2));

  const text = (at: number, word: string) => {
    for (const [index, char] of [...word].entries()) view.setUint8(at + index, char.charCodeAt(0));
  };

  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CLIP.RATE, true);
  view.setUint32(28, CLIP.RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);

  for (let at = 0; at < count; at += 1) {
    const loudness = Math.abs(Math.sin((Math.PI * CLIP.SWELLS * at) / count));
    const tone = Math.sin((2 * Math.PI * CLIP.PITCH_HZ * at) / CLIP.RATE);
    view.setInt16(WAV_HEADER_BYTES + at * 2, Math.round(tone * loudness * SAMPLE_MAX), true);
  }

  const bytes = new Uint8Array(view.buffer);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function AudioPlayers(): React.JSX.Element {
  const url = useMemo(standInWav, []);
  const [expanded, setExpanded] = useState(0);

  return (
    <>
      <CatalogSection id="audio-player-inline" title="In place of a picture">
        <Stack gap={GAP.ICON}>
          <AudioPlayer
            dataUrl={url}
            label="A tone that swells twice"
            onExpand={() => setExpanded((was) => was + 1)}
          />
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`Expanded ${String(expanded)} ${expanded === 1 ? "time" : "times"}`}
          </Text>
        </Stack>
      </CatalogSection>
      <CatalogSection id="audio-player-viewer" title="In the viewer">
        <AudioPlayer
          dataUrl={url}
          label="A tone that swells twice"
          place={AUDIO_PLAYER_PLACE.VIEWER}
        />
      </CatalogSection>
    </>
  );
}

export const AUDIO_PLAYER_EXAMPLE: Example = {
  id: "audio-player",
  title: "Audio player",
  Render: AudioPlayers,
};
