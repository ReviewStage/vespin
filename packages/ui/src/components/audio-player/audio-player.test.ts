// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AUDIO_PLAYER_PLACE, AudioPlayer, type AudioPlayerPlace } from "../../index.js";

/**
 * audio-player.test.ts -- a sound clip drawn again, as Expand draws it in
 * the viewer, starts where it was left, at the speed it was left at, rather
 * than at its start at 1×; and > and
 * its speed button step it along a voice message's speeds. The browser's
 * media element is the boundary, so a stand-in seeks and changes its speed
 * as one does, telling its events, and the player is read by the time and
 * the speed it shows.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Clips' bytes as a picture read answers them, one to each case, since a clip's place outlives its player; the stand-in element never decodes them. */
const CLIP_URL = {
  EXPANDED: "data:audio/wav;base64,UklGRg==",
  STEPPED: "data:audio/wav;base64,UklGRh==",
} as const;

/** How long the stand-in runs, in seconds. */
const LENGTH_S = 20;

/** Makes the page's clip a stand-in that seeks as a browser's does, telling its events. */
function standInMedia(audio: HTMLAudioElement): void {
  let at = 0;
  let rate = 1;
  Object.defineProperties(audio, {
    playbackRate: {
      get: () => rate,
      set: (next: number) => {
        rate = next;
        audio.dispatchEvent(new Event("ratechange"));
      },
    },
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
function mountPlayer(dataUrl: string, place: AudioPlayerPlace, onExpand?: () => void) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clip");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(AudioPlayer, { dataUrl, label: "A chime", place, onExpand })),
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
    speed: () =>
      container.querySelector('button[aria-label^="Playback speed"]')?.getAttribute("aria-label"),
  };
}

test("a clip opened in the viewer starts where it was left, at the speed it was left at", () => {
  const inline = mountPlayer(CLIP_URL.EXPANDED, AUDIO_PLAYER_PLACE.INLINE, () => undefined);
  inline.press("ArrowRight");
  inline.press("ArrowRight");
  inline.press(">");
  inline.pressButton("Expand");
  const viewer = mountPlayer(CLIP_URL.EXPANDED, AUDIO_PLAYER_PLACE.VIEWER);
  expect(viewer.time()).toBe("0:10 / 0:20");
  expect(viewer.speed()).toBe("Playback speed: 1.5×");
});

test("> steps a clip's speed and its speed button walks on from there, back to 1× after 2×", () => {
  const player = mountPlayer(CLIP_URL.STEPPED, AUDIO_PLAYER_PLACE.INLINE);
  player.press(">");
  expect(player.speed()).toBe("Playback speed: 1.5×");
  player.pressButton("Playback speed: 1.5×");
  expect(player.speed()).toBe("Playback speed: 2×");
  player.pressButton("Playback speed: 2×");
  expect(player.speed()).toBe("Playback speed: 1×");
});
