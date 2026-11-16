// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AUDIO_PLAYER_PLACE, AudioPlayer, type AudioPlayerPlace } from "../../index.js";

/**
 * audio-player.test.ts -- a sound clip drawn again, as Expand draws it in
 * the viewer, starts where it was left rather than at its start. The
 * browser's media element is the boundary, so a stand-in seeks as one does,
 * telling its events, and the player is read by the time it shows.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A clip's bytes as a picture read answers them; the stand-in element never decodes them. */
const CLIP_URL = "data:audio/wav;base64,UklGRg==";

/** How long the stand-in runs, in seconds. */
const LENGTH_S = 20;

/** Makes the page's clip a stand-in that seeks as a browser's does, telling its events. */
function standInMedia(audio: HTMLAudioElement): void {
  let at = 0;
  Object.defineProperties(audio, {
    paused: { get: () => true },
    duration: { get: () => LENGTH_S },
    currentTime: {
      get: () => at,
      set: (next: number) => {
        at = next;
        audio.dispatchEvent(new Event("timeupdate"));
      },
    },
  });
  act(() => audio.dispatchEvent(new Event("loadedmetadata")));
}

/** Draws a player of the clip, its element a stand-in, and answers its keys, its buttons, and the time it shows. */
function mountPlayer(place: AudioPlayerPlace, onExpand?: () => void) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clip");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AudioPlayer, { dataUrl: CLIP_URL, label: "A chime", place, onExpand }),
    ),
  );
  const audio = container.querySelector("audio");
  const frame = container.querySelector<HTMLElement>("[role=group]");

  if (audio === null || frame === null) throw new Error("the player draws its clip");
  standInMedia(audio);

  return {
    press: (key: string) =>
      act(() => frame.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))),
    pressButton: (label: string) =>
      act(() => container.querySelector<HTMLElement>(`button[aria-label="${label}"]`)?.click()),
    time: () => container.querySelector(".ui-audio-player-time")?.textContent,
  };
}

test("a clip opened in the viewer starts where it was left", () => {
  const inline = mountPlayer(AUDIO_PLAYER_PLACE.INLINE, () => undefined);
  inline.press("ArrowRight");
  inline.press("ArrowRight");
  inline.pressButton("Expand");
  const viewer = mountPlayer(AUDIO_PLAYER_PLACE.VIEWER);
  expect(viewer.time()).toBe("0:10 / 0:20");
});
