// brand-mark.tsx -- the Keel mark in the brand's copper, as the app's asset catalog holds it in the light appearance and the dark.

import { Image } from "@expo/ui/swift-ui";
import { accessibilityLabel, frame, resizable } from "@expo/ui/swift-ui/modifiers";
import { PRODUCT_NAME } from "@repo/features/product-name";

/**
 * The image set the mark is drawn from. The app's config writes it into the
 * asset catalog (`apps/mobile/app.config.ts`'s `withImageSets`) from the
 * brand's copper SVGs, light and dark, so SwiftUI picks the appearance's own
 * and the mark is never redrawn in JavaScript.
 */
export const BRAND_MARK_ASSET = "BrandMark";

/** The mark at `size` points square, named for the product to VoiceOver. */
export function BrandMark({ size }: { readonly size: number }) {
  return (
    <Image
      assetName={BRAND_MARK_ASSET}
      modifiers={[
        resizable(),
        frame({ width: size, height: size }),
        accessibilityLabel(PRODUCT_NAME),
      ]}
    />
  );
}
