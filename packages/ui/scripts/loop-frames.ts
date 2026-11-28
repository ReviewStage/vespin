// loop-frames.ts -- writes or checks the frames the working mark's lap and a Manager's typing dots play on, as animated PNGs the compositor runs.

import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

/**
 * Note that each loop is an animated image rather than CSS keyframes,
 * because Chromium's compositor ticks a running keyframe animation on every
 * vsync, stepped or not, and wakes the main thread at each of its
 * iterations, where it draws an animated image's next frame only as that
 * frame falls due. With agents working (the `tasks-open` fixture's large
 * stage), the lap as stepped `transform` keyframes cost the renderer 2.8% of
 * a core more than the still mark, and as this image 0.6%; each frame a
 * second costs about 0.1%, so both loops step five times a second. Each
 * image is an alpha mask: a component lays it over `currentColor`, so it
 * draws in its own ink in either theme.
 */

/** Where the frames are written: one stylesheet of custom properties, which the two components' own stylesheets mask with. */
const OUT = fileURLToPath(new URL("../src/components/motion/loop-frames.css", import.meta.url));

/** Points sampled along each side of a pixel, so an edge's coverage is smooth. */
const SUPERSAMPLE = 4;

/** The working mark's lap: its side, cells, and track as `working-mark.tsx` draws them, in CSS pixels. */
const LAP = {
  SIDE: 16,
  CELL: 3,
  PITCH: 5,
  /** Device pixels to a CSS pixel, so the mark stays crisp on a 2x screen and past. */
  SCALE: 4,
  /** How long a pixel stands on a cell before it steps to the next, in milliseconds. */
  STEP_MS: 200,
  /** The track cell's ink, as `opacity-30` draws it. */
  TRACK_INK: 0.3,
} as const;

/** The cells of the track, in the order the chasers lap them. */
const TRACK = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const;

/** Each chaser and the fainter tail one cell behind it: the cell it stands on in the first frame, and its ink. */
const CHASERS = [
  { startsOn: 1, ink: 1 },
  { startsOn: 0, ink: 0.6 },
  { startsOn: 5, ink: 1 },
  { startsOn: 4, ink: 0.6 },
] as const;

/** The typing dots, in shares of the face's side as `manager-face.css` lays them out. */
const TYPING = {
  /** Device pixels to the face's side, so a message's 32px face stays crisp on a 2x screen and past. */
  SIDE: 200,
  DOT: 0.12,
  GAP: 0.075,
  /** How far a dot rises at its top. */
  RISE: 0.075,
  PERIOD_MS: 1200,
  /** How long each frame stands: the lap's own step, so the two move on the same beat. */
  FRAME_MS: 200,
  /** A resting dot's ink, and a lit one's. */
  REST_INK: 0.35,
  LIT_INK: 1,
  /** Where in its period a dot is lit and risen, and where it is back at rest. */
  TOP: 0.3,
  BACK: 0.6,
} as const;

/** How far into its period each dot starts, in milliseconds: each 200ms behind the one before, so the first stands lit at the loop's start. */
const TYPING_LEADS = [360, 160, -40] as const;

/** A PNG chunk: its length, type, data, and the CRC over type and data. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));

  return Buffer.concat([head, body, tail]);
}

/** A big-endian record of the given 32-bit and 16-bit fields, in order. */
function fields(...values: readonly (readonly [number, 2 | 4])[]): Buffer {
  const record = Buffer.alloc(values.reduce((sum, [, size]) => sum + size, 0));
  values.reduce((at, [value, size]) => {
    if (size === 4) record.writeUInt32BE(value, at);
    else record.writeUInt16BE(value, at);

    return at + size;
  }, 0);

  return record;
}

/**
 * An endless animated PNG of white pixels over the given alpha frames, each
 * shown for `frameMs`. Note that it is gray with alpha, the smallest PNG
 * that carries a mask, and that each frame replaces the last outright.
 */
function animatedPng(
  width: number,
  height: number,
  frames: readonly Uint8Array[],
  frameMs: number,
): Buffer {
  const header = Buffer.concat([fields([width, 4], [height, 4]), Buffer.from([8, 4, 0, 0, 0])]);
  const chunks = [pngChunk("IHDR", header), pngChunk("acTL", fields([frames.length, 4], [0, 4]))];
  let sequence = 0;

  frames.forEach((alpha, index) => {
    const rows = Buffer.alloc(height * (1 + width * 2));

    for (let y = 0; y < height; y++) {
      const row = y * (1 + width * 2);

      for (let x = 0; x < width; x++) {
        rows[row + 1 + x * 2] = 255;
        rows[row + 2 + x * 2] = alpha[y * width + x] ?? 0;
      }
    }

    const control = Buffer.concat([
      fields([sequence++, 4], [width, 4], [height, 4], [0, 4], [0, 4], [frameMs, 2], [1000, 2]),
      Buffer.from([0, 0]),
    ]);

    chunks.push(pngChunk("fcTL", control));
    const data = deflateSync(rows, { level: 9 });
    chunks.push(
      index === 0
        ? pngChunk("IDAT", data)
        : pngChunk("fdAT", Buffer.concat([fields([sequence++, 4]), data])),
    );
  });
  chunks.push(pngChunk("IEND", new Uint8Array()));

  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

/** How much of the device pixel at `x`, `y` lies inside `inside`, sampled on a grid. */
function coverage(x: number, y: number, inside: (px: number, py: number) => boolean): number {
  let hits = 0;

  for (let i = 0; i < SUPERSAMPLE; i++) {
    for (let j = 0; j < SUPERSAMPLE; j++) {
      if (inside(x + (i + 0.5) / SUPERSAMPLE, y + (j + 0.5) / SUPERSAMPLE)) hits++;
    }
  }

  return hits / SUPERSAMPLE ** 2;
}

/** Whether a point lies in the square of `side` at `left`, `top`, its corners rounded by `radius`. */
function inRoundedSquare(
  px: number,
  py: number,
  left: number,
  top: number,
  side: number,
  radius: number,
): boolean {
  const x = px - left;
  const y = py - top;

  if (x < 0 || y < 0 || x > side || y > side) return false;
  const nearestX = Math.min(Math.max(x, radius), side - radius);
  const nearestY = Math.min(Math.max(y, radius), side - radius);

  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

/** One frame of the lap: each track cell's ink, with the chasers `step` cells on from where they start. */
function lapFrame(step: number): Uint8Array {
  const side = LAP.SIDE * LAP.SCALE;
  const cell = LAP.CELL * LAP.SCALE;
  const inset = ((LAP.SIDE - (2 * LAP.PITCH + LAP.CELL)) / 2) * LAP.SCALE;

  // Note that a chaser lies over its track cell, so the two inks stack as the DOM's layers do.
  const inks = TRACK.map((_, index) => {
    const lit = CHASERS.find(({ startsOn }) => (startsOn + step) % TRACK.length === index);

    return lit === undefined ? LAP.TRACK_INK : 1 - (1 - LAP.TRACK_INK) * (1 - lit.ink);
  });

  const alpha = new Uint8Array(side * side);

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const ink = TRACK.reduce((most, [column, row], index) => {
        const left = inset + column * LAP.PITCH * LAP.SCALE;
        const top = inset + row * LAP.PITCH * LAP.SCALE;

        const covered = coverage(x, y, (px, py) =>
          inRoundedSquare(px, py, left, top, cell, cell / 4),
        );

        return Math.max(most, covered * (inks[index] ?? 0));
      }, 0);

      alpha[y * side + x] = Math.round(ink * 255);
    }
  }

  return alpha;
}

/** CSS's `ease-in-out`, `cubic-bezier(0.42, 0, 0.58, 1)`, at `progress`, solved for its x by bisection. */
function easeInOut(progress: number): number {
  const bezier = (t: number, p1: number, p2: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;

  let low = 0;
  let high = 1;

  for (let round = 0; round < 40; round++) {
    const middle = (low + high) / 2;

    if (bezier(middle, 0.42, 0.58) < progress) low = middle;
    else high = middle;
  }

  return bezier((low + high) / 2, 0, 1);
}

/** How lit and risen a dot is at `phase` of its period, 0 at rest and 1 at its top. */
function typingLift(phase: number): number {
  if (phase >= TYPING.BACK) return 0;

  if (phase <= TYPING.TOP) return easeInOut(phase / TYPING.TOP);

  return 1 - easeInOut((phase - TYPING.TOP) / (TYPING.BACK - TYPING.TOP));
}

/** The typing frame's size in device pixels: the three dots in a row, with room above for a dot's rise. */
function typingSize() {
  return {
    width: Math.round((3 * TYPING.DOT + 2 * TYPING.GAP) * TYPING.SIDE),
    height: Math.round((TYPING.DOT + TYPING.RISE) * TYPING.SIDE),
  };
}

/** One frame of the typing dots, `atMs` into the loop. */
function typingFrame(atMs: number): Uint8Array {
  const { width, height } = typingSize();
  const dot = TYPING.DOT * TYPING.SIDE;
  const rise = TYPING.RISE * TYPING.SIDE;

  const dots = TYPING_LEADS.map((lead, index) => {
    const phase =
      ((((atMs + lead) % TYPING.PERIOD_MS) + TYPING.PERIOD_MS) % TYPING.PERIOD_MS) /
      TYPING.PERIOD_MS;

    const lift = typingLift(phase);

    return {
      left: index * (TYPING.DOT + TYPING.GAP) * TYPING.SIDE,
      top: rise * (1 - lift),
      ink: TYPING.REST_INK + (TYPING.LIT_INK - TYPING.REST_INK) * lift,
    };
  });

  const alpha = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = dots.reduce(
        (most, { left, top, ink: dotInk }) =>
          Math.max(
            most,
            dotInk * coverage(x, y, (px, py) => inRoundedSquare(px, py, left, top, dot, dot / 2)),
          ),
        0,
      );

      alpha[y * width + x] = Math.round(ink * 255);
    }
  }

  return alpha;
}

/** The stylesheet: each loop's frames as a custom property a component masks with. */
function stylesheet(): string {
  const lapSide = LAP.SIDE * LAP.SCALE;

  const lap = animatedPng(
    lapSide,
    lapSide,
    TRACK.map((_, step) => lapFrame(step)),
    LAP.STEP_MS,
  );

  const { width, height } = typingSize();

  const typing = animatedPng(
    width,
    height,
    Array.from({ length: TYPING.PERIOD_MS / TYPING.FRAME_MS }, (_, index) =>
      typingFrame(index * TYPING.FRAME_MS),
    ),
    TYPING.FRAME_MS,
  );

  const url = (png: Buffer) => `url("data:image/png;base64,${png.toString("base64")}")`;

  return `/* loop-frames.css -- generated by packages/ui/scripts/loop-frames.ts; do not edit.

   The frames the working mark's lap and a Manager's typing dots play on,
   each an endless animated PNG of white over alpha, for a mask over
   currentColor. */

:root {
  --ui-working-lap-frames: ${url(lap)};
  --ui-typing-dots-frames: ${url(typing)};
}
`;
}

const written = stylesheet();

if (argv.includes("--check")) {
  const standing = await readFile(OUT, "utf8").catch(() => "");

  if (standing !== written) {
    console.error(
      `${OUT} is stale: run \`pnpm --dir packages/ui exec tsx scripts/loop-frames.ts\``,
    );
    exit(1);
  }
} else {
  await writeFile(OUT, written);
}
