// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { afterEach, test, vi } from "vitest";
import { encodeImage } from "./feedback-images.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";

/**
 * A picked image's re-encode as its pixels come out: a workspace photo drawn
 * with a transparent ground keeps it, so the tile shows the surface around it
 * in the light and the dark rather than a fill the encoder put there. The
 * platform's decoder and canvas, which jsdom has not got, stand in at the
 * browser's edge over a pixel buffer, as Chromium's do: a canvas starts
 * transparent unless asked for no alpha, drawing composites over what is
 * there, and WebP writes the alpha channel. Note that the stand-in canvas
 * answers drawImage alone, so an encoder that painted a ground first would
 * be refused and answer nothing.
 */

/** A pixel's red, green, blue, and alpha, each 0 to 255. */
type Pixel = readonly [number, number, number, number];

const CLEAR: Pixel = [0, 0, 0, 0];
const STRIPE: Pixel = [47, 157, 68, 255];

/** A decoded picture: its size and its pixels, row by row. */
interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly Pixel[];
  close(): void;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `top` over `under`, as a canvas composites a drawn pixel over what it covers. */
function over(top: Pixel, under: Pixel): Pixel {
  const alpha = top[3] / 255 + (under[3] / 255) * (1 - top[3] / 255);

  if (alpha === 0) return CLEAR;

  const channel = (index: 0 | 1 | 2) =>
    Math.round(
      (top[index] * (top[3] / 255) + under[index] * (under[3] / 255) * (1 - top[3] / 255)) / alpha,
    );

  return [channel(0), channel(1), channel(2), Math.round(alpha * 255)];
}

/**
 * Stands the platform's decoder and canvas in: every file decodes to
 * `picture`, a canvas holds pixels drawn nearest-neighbor, and its WebP is
 * those pixels' bytes as they stand, alpha and all.
 */
function stubPlatform(picture: Omit<Bitmap, "close">): void {
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ ...picture, close: () => {} }));
  const buffers = new WeakMap<HTMLCanvasElement, Pixel[]>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    _kind: string,
    options?: { alpha?: boolean },
  ) {
    const ground: Pixel = options?.alpha === false ? [0, 0, 0, 255] : CLEAR;
    const pixels = Array.from({ length: this.width * this.height }, () => ground);
    buffers.set(this, pixels);
    const width = this.width;

    // SAFETY: the stand-in answers drawImage alone, its nine-argument form the encoder uses.
    return {
      drawImage: (bitmap: Bitmap, ...at: number[]) => {
        const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] = at;

        for (let y = 0; y < dh; y += 1) {
          for (let x = 0; x < dw; x += 1) {
            const from = Math.floor(sy + ((y + 0.5) * sh) / dh) * bitmap.width;
            const source = bitmap.pixels[from + Math.floor(sx + ((x + 0.5) * sw) / dw)] ?? CLEAR;
            const to = (dy + y) * width + dx + x;
            pixels[to] = over(source, pixels[to] ?? CLEAR);
          }
        }
      },
    } as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    const bytes = new Uint8Array((buffers.get(this) ?? []).flat());
    callback(new Blob([bytes], type === undefined ? {} : { type }));
  });
}

/** The pixels of an encoded image's bytes, as the stand-in canvas wrote them. */
function pixelsOf(base64: string): Pixel[] {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const pixels: Pixel[] = [];

  for (let at = 0; at < bytes.length; at += 4) {
    pixels.push([bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0]);
  }

  return pixels;
}

test("a workspace photo drawn square keeps its transparent pixels transparent and its opaque ones as they were", async () => {
  stubPlatform({ width: 2, height: 2, pixels: [CLEAR, STRIPE, STRIPE, CLEAR] });
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

  const read = await encodeImage(file, Number.POSITIVE_INFINITY, 2);

  assert.ok("image" in read);
  assert.equal(read.image.mediaType, "image/webp");
  assert.deepEqual(pixelsOf(read.image.base64), [CLEAR, STRIPE, STRIPE, CLEAR]);
});

/** A decoder that, as Chromium's, has no HEIC: it refuses every file. */
function stubNoHeicDecoder(): void {
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new DOMException("unreadable")));
}

test("a HEIC photo comes as the JPEG the Mac wrote of it, never handed to a decoder that cannot read it", async () => {
  stubNoHeicDecoder();
  const asked: string[] = [];
  fakeActPort({
    [ACT_KIND.MAC_PHOTO_TO_JPEG]: ({ base64 }) => {
      asked.push(base64);

      return Promise.resolve({ base64: "/9j/2wBD" });
    },
  });
  const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.HEIC", { type: "image/heic" });

  const read = await encodeImage(file);

  assert.deepEqual(asked, ["AQID"]);
  assert.deepEqual(read, {
    image: { name: "IMG_0001.jpg", mediaType: "image/jpeg", base64: "/9j/2wBD" },
  });
});

test("a HEIC photo neither the shell nor the browser can read is said as one to export as JPEG", async () => {
  stubNoHeicDecoder();
  fakeActPort({
    [ACT_KIND.MAC_PHOTO_TO_JPEG]: () => Promise.reject(refusedOnPort("Not here.")),
  });
  // Note that a system may give a HEIC no type, so it is known by its name.
  const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.heic", { type: "" });

  assert.deepEqual(await encodeImage(file), {
    unreadable:
      "IMG_0001.heic is a HEIC photo, which this browser can't read. Export it as JPEG and attach that.",
  });
});
