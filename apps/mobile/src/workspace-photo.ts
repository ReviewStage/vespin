/**
 * workspace-photo.ts -- a workspace's photo picked on the phone: chosen in the system's photo picker, cropped there to a square, drawn at the panel's size as a JPEG within the service's bound by the app's photo-scale module (`modules/photo-scale/`), and handed back as the `data:` URL the photo is set with.
 *
 * The picker reads only what the member picks, so no permission is asked
 * for first. The module is the app's own, autolinked from `modules/`, so it
 * stands in every build of the app; a build without it, such as Expo Go,
 * says the photo could not be read rather than sending one at full size.
 */

import { PHOTO_REFUSAL, WORKSPACE_PHOTO_EDGE } from "@repo/features/workspace-settings-words";
import {
  WORKSPACE_PHOTO_BOUNDS,
  WORKSPACE_PHOTO_TYPE,
  workspacePhotoOfDataUrl,
} from "@repo/features/workspace-wire";
import { launchImageLibraryAsync } from "expo-image-picker";
import { photoScaleModule } from "./photo-scale.js";

/** What a photo the member picked is called where it said no name of its own. */
const UNNAMED_PHOTO = "The photo";

/** How a pick ended: nothing picked, the photo to set, or why it cannot be one. */
export type PhotoPicked =
  | { readonly canceled: true }
  | { readonly photo: string }
  | { readonly refusal: string };

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

  const base64 = await photoScaleModule
    ?.squareJpeg(asset.uri, WORKSPACE_PHOTO_EDGE, WORKSPACE_PHOTO_BOUNDS.MAX_BYTES)
    .catch(() => null);

  if (base64 === undefined || base64 === null) return { refusal: PHOTO_REFUSAL.UNREADABLE(name) };
  const photo = `data:${WORKSPACE_PHOTO_TYPE.JPEG};base64,${base64}`;
  const bytes = workspacePhotoOfDataUrl(photo)?.bytes.length;

  if (bytes === undefined) return { refusal: PHOTO_REFUSAL.UNREADABLE(name) };

  return bytes > WORKSPACE_PHOTO_BOUNDS.MAX_BYTES
    ? { refusal: PHOTO_REFUSAL.TOO_LARGE(name) }
    : { photo };
}
