// picture-fit.ts -- how a picture attached on the phone is sized and compressed to stand within the service's bound for one picture, as the panel's feedback form fits a screenshot.

import { base64Bytes } from "./agent-wire.js";

/**
 * The longest edge a picture is drawn at, in pixels: a camera photo's
 * 4032 by 3024 comes down to 2048 by 1536, as Messages sends a photo, which
 * still reads sharp on any screen the panel draws it on.
 */
const PICTURE_LONG_EDGE = 2048;

/** How far each try lowers a picture's JPEG quality, and the least it goes to before it stops trying. */
const QUALITY_STEP = 0.15;
const LEAST_QUALITY = 0.3;

/** A picture's size, in pixels. */
export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/** The qualities a picture is tried at, from `first` down by a step to the least, `first` alone where it is already under it. */
function qualityLadder(first: number): readonly number[] {
  const ladder = [first];

  for (
    let quality = first - QUALITY_STEP;
    quality >= LEAST_QUALITY - 1e-9;
    quality -= QUALITY_STEP
  ) {
    ladder.push(Math.round(quality * 100) / 100);
  }

  return ladder;
}

/** The size a picture is drawn at so its longest edge stands within `longEdge`, its shape kept; none where it already does. */
export function fitWithin(
  size: PictureSize,
  longEdge = PICTURE_LONG_EDGE,
): PictureSize | undefined {
  const longest = Math.max(size.width, size.height);

  if (longest <= longEdge) return undefined;
  const scale = longEdge / longest;

  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * A picture encoded at the first quality on its ladder whose bytes stand
 * within `maxBytes`, as base64; the last tried where none does, so the
 * holder's bound still says it is too large rather than the picture going
 * missing. Note that each try encodes anew, since a JPEG's size can only be
 * known by writing it.
 */
export async function encodeWithin(
  encode: (quality: number) => Promise<string>,
  maxBytes: number,
  first: number,
): Promise<string> {
  let last = "";

  for (const quality of qualityLadder(first)) {
    last = await encode(quality);

    if (base64Bytes(last) <= maxBytes) return last;
  }

  return last;
}
