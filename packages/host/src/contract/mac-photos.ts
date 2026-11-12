/**
 * mac-photos.ts -- a photo Chromium cannot decode, HEIC off an iPhone, written again as a JPEG by this Mac, as a procedure.
 *
 * The panel asks before it decodes a picked or pasted HEIC
 * (`packages/panel/src/feedback-images.ts`), since Chromium has no HEIC
 * decoder; main answers it with macOS's own `sips`
 * (`apps/desktop/src/main/ipc/mac-photo-acts.ts`), and a browser tab and the
 * iOS app refuse it, the tab then decoding the photo itself where its browser
 * can. The JPEG goes on through the panel's usual re-encode and bounds, so
 * nothing here scales or bounds the picture beyond what the port carries.
 */

import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { MAC_PHOTO_ACT_KIND } from "./kinds.js";

/**
 * The most a photo's bytes in base64 run to, either way: a HEIC off a phone
 * is a few megabytes, and its JPEG at full size several times that, so this
 * leaves room for a large one while keeping one copy off the port's whole
 * budget.
 */
const PHOTO_MAX_CHARS = 64 * 1024 * 1024;

/** A photo's bytes in base64. */
const photoBase64 = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.length > 0),
  EffectSchema.isMaxLength(PHOTO_MAX_CHARS),
  EffectSchema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u),
);

export const macPhotoActsContract = {
  [MAC_PHOTO_ACT_KIND.MAC_PHOTO_TO_JPEG]: actProcedure("Could not convert the photo on this Mac.")
    .input(exactInput(EffectSchema.Struct({ base64: photoBase64 })))
    .output(EffectSchema.Struct({ base64: photoBase64 })),
};
