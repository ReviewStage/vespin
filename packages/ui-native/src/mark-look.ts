// mark-look.ts -- the measures the marks are drawn to, which the React Native marks (`marks.tsx`) and the native previews (`row-preview-model.ts`) both read: an avatar's letter, an agent's tile, a harness's mark, and the working mark's grid.

import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";

/** The share of an avatar's width its letter stands at, half of it, as the panel's avatar sets its letter. */
export const LETTER_SCALE = 0.5;

/** The share of an agent's or a workspace's tile its corners round by, a square softened as the panel's tiles are. */
export const TILE_ROUNDING = 0.28;

/** The share of an agent's tile its glyph stands at. */
export const TILE_GLYPH_SCALE = 0.5;

/**
 * The share of an agent's tile its harness's mark stands at. Note that it
 * is larger than a glyph's, because a mark is a picture with its own margins,
 * and at a glyph's share it read as a speck at a row's size.
 */
export const TILE_MARK_SCALE = 0.72;

/**
 * The image sets each harness's mark is drawn from, which the app's config
 * writes into its asset catalog (`apps/mobile/app.config.ts`) from the
 * brand's paths: Claude's spark in its own clay, and OpenAI's blossom and
 * Cursor's cube in the row's ink, each as the panel's `HarnessMark` draws it.
 */
export const HARNESS_MARK_ASSET = {
  [MODEL_PROVIDER.ANTHROPIC]: "ClaudeMark",
  [MODEL_PROVIDER.OPENAI]: "OpenAIMark",
  [MODEL_PROVIDER.CURSOR]: "CursorMark",
} as const satisfies Record<ModelProvider, string>;

/** How round a repository's picture stands, of its size: a tile's, as the panel draws a repository's owner, not a person's circle. */
export const REPOSITORY_CORNER = 0.25;

/** One cell of the working mark's grid, its side, in points: the panel's 3 px. */
export const WORKING_CELL = 3;

/** One step from a cell to the next, cell and gap, in points: the panel's 5 px. */
export const WORKING_PITCH = 5;

/** The working mark's side, in points: the panel's 16 px icon seat. */
export const WORKING_SIDE = 16;

/** Where the grid's first cell stands from the mark's corner, the grid centered in the side. */
export const WORKING_INSET = (WORKING_SIDE - (2 * WORKING_PITCH + WORKING_CELL)) / 2;

/** The cells of the track, column and row, in the order the chasers lap them, as the panel's mark laps them. */
export const WORKING_TRACK = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
] as const;

/** The pixels that move: each chaser and the fainter tail one cell behind it, with the track cell each rests on when still and steps on from, as the panel's are. */
export const WORKING_DOTS = [
  { restsOn: 1, tail: false },
  { restsOn: 0, tail: true },
  { restsOn: 5, tail: false },
  { restsOn: 4, tail: true },
] as const;

/** How faint the track's cells and a chaser's tail stand, as the panel's mark draws them. */
export const WORKING_OPACITY = { TRACK: 0.3, TAIL: 0.6, LEAD: 1 } as const;
