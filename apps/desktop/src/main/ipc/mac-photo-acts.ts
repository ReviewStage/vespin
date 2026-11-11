/**
 * mac-photo-acts.ts -- the act that writes a photo Chromium cannot decode, HEIC off an iPhone, again as a JPEG, answered on the act port.
 *
 * Only a panel asks, before it decodes a picked, pasted, or dropped HEIC, so
 * the procedure refuses any other window, and a photo `sips` could not
 * convert is refused, which the panel says in words of its own. The
 * conversion itself is main's (`../native/mac-photo.ts`).
 */

import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "@repo/host/act-port";
import { MAC_PHOTO_ACT_KIND } from "@repo/host/contract";
import { Effect, Option } from "effect";
import type { WebContents } from "electron";

type MacPhotoActKind = (typeof MAC_PHOTO_ACT_KIND)[keyof typeof MAC_PHOTO_ACT_KIND];

export interface MacPhotoActsDependencies {
  /** The photo's bytes as a JPEG, or none where it could not be converted; main's `sips`, or a test's. */
  toJpeg: (photo: Uint8Array) => Effect.Effect<Option.Option<Uint8Array>>;
}

const macPhotoPort = actPortFor<WebContents>();

export function macPhotoProcedures(
  dependencies: MacPhotoActsDependencies,
): Pick<PlatformActProcedures<WebContents>, MacPhotoActKind> {
  const { toJpeg } = dependencies;
  return {
    [MAC_PHOTO_ACT_KIND.MAC_PHOTO_TO_JPEG]: macPhotoPort[
      MAC_PHOTO_ACT_KIND.MAC_PHOTO_TO_JPEG
    ].effect(function* ({ context, errors, input }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const jpeg = yield* toJpeg(Buffer.from(input.base64, "base64"));
      if (Option.isNone(jpeg)) return yield* Effect.fail(errors.REFUSED());
      return { base64: Buffer.from(jpeg.value).toString("base64") };
    }),
  };
}
