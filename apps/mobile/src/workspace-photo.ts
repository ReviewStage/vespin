/**
 * workspace-photo.ts -- a workspace's photo picked on the phone: chosen in the system's photo picker, cropped there to a square, drawn at the panel's size as a JPEG within the service's bound by `expo-image-manipulator`, and handed back as the `data:` URL the photo is set with.
 *
 * The picker reads only what the member picks, so no permission is asked
 * for first. The manipulator decodes the photo, HEIC among the kinds the
 * library holds, at the size it is drawn at rather than whole, turns it
 * upright, and writes a JPEG that keeps none of the original's metadata,
 * its place among it, as the photos a message carries are read
 * (`use-attached-pictures.ts`).
 */

import { encodeWithin } from "@repo/features/picture-fit";
import { PHOTO_REFUSAL, WORKSPACE_PHOTO_EDGE } from "@repo/features/workspace-settings-words";
import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  workspacePhotoOfDataUrl,
} from "@repo/features/workspace-wire";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { deleteSaved } from "./use-attached-pictures.js";

/** What a photo the member picked is called where it said no name of its own. */
const UNNAMED_PHOTO = "The photo";

/** The JPEG quality a photo is first written at, stepped down only until it fits the service's bound. */
const FIRST_QUALITY = 0.85;

/** How a pick ended: nothing picked, the photo to set, or why it cannot be one. */
export type PhotoPicked =
  | { readonly canceled: true }
  | { readonly photo: string }
  | { readonly refusal: string };

/**
 * The photo at `uri`, `width` by `height` pixels, as JPEG base64 of its
 * center square, `WORKSPACE_PHOTO_EDGE` pixels a side and never drawn
 * larger than it is, at the first quality that stands within the service's
 * bound; the last tried where none does, which the caller refuses as too
 * large. Note that it is decoded at the size that draws its shorter side at
 * the edge, so a camera's full size never stands in memory.
 */
async function squareJpeg(uri: string, width: number, height: number): Promise<string> {
  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  const side = Math.min(longer, Math.ceil((WORKSPACE_PHOTO_EDGE * longer) / shorter));
  const decoded = ImageManipulator.manipulate(uri, { maxWidth: side, maxHeight: side });

  try {
    const scaled = await decoded.renderAsync();
    const cut = Math.min(scaled.width, scaled.height);
    const edge = Math.min(cut, WORKSPACE_PHOTO_EDGE);

    const square = ImageManipulator.manipulate(scaled)
      .crop({
        originX: Math.floor((scaled.width - cut) / 2),
        originY: Math.floor((scaled.height - cut) / 2),
        width: cut,
        height: cut,
      })
      .resize({ width: edge, height: edge });

    try {
      const image = await square.renderAsync();

      return await encodeWithin(
        async (quality) => {
          const saved = await image.saveAsync({
            compress: quality,
            format: SaveFormat.JPEG,
            base64: true,
          });

          deleteSaved(saved.uri);

          if (saved.base64 === undefined) throw new Error("The photo was saved without its bytes.");

          return saved.base64;
        },
        WORKSPACE_PHOTO_BOUNDS.MAX_BYTES,
        FIRST_QUALITY,
      );
    } finally {
      square.release();
    }
  } finally {
    decoded.release();
  }
}

/** A photo picked from the library for a workspace, as the `data:` URL its photo is set with, or why it cannot be one. */
export async function pickWorkspacePhoto(): Promise<PhotoPicked> {
  const picked = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  const asset = picked.canceled ? undefined : picked.assets[0];

  if (asset === undefined) return { canceled: true };
  const name = asset.fileName ?? UNNAMED_PHOTO;

  const base64 = await squareJpeg(asset.uri, asset.width, asset.height).catch(() => undefined);

  if (base64 === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(name) };
  const photo = `data:${WORKSPACE_PHOTO_TYPE.JPEG};base64,${base64}`;
  const bytes = workspacePhotoOfDataUrl(photo)?.bytes.length;

  if (bytes === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(name) };

  return bytes > WORKSPACE_PHOTO_BOUNDS.MAX_BYTES
    ? { refusal: PHOTO_REFUSAL.TOO_LARGE(name) }
    : { photo };
}
