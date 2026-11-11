// provider-button.tsx -- a way to sign in through a provider: a quiet capsule across its column, the provider's mark beside its words, as the web's sign-in buttons carry it.

import { HStack, Image, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  background,
  buttonStyle,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  opacity,
  padding,
  resizable,
  shapes,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/**
 * The image sets the providers' marks are drawn from, which the app's config
 * writes into its asset catalog (`apps/mobile/app.config.ts`'s
 * `withImageSets`) from the brand's own paths: GitHub's a template drawn
 * in the button's ink, Google's in its own colors.
 */
export const PROVIDER_MARK_ASSET = {
  GOOGLE: "GoogleMark",
  GITHUB: "GitHubMark",
} as const;

export type ProviderMarkAsset = (typeof PROVIDER_MARK_ASSET)[keyof typeof PROVIDER_MARK_ASSET];

/** The mark's size beside the words, in points. */
const PROVIDER_MARK_SIZE = 18;

type ProviderButtonProps = {
  readonly label: string;
  readonly mark: ProviderMarkAsset;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/** A way in's height inside its edge, beside its words. */
const WAY_IN_PADDING = 13;

/** How thick its edge is drawn. */
const HAIRLINE = 0.5;

/**
 * One provider's way in, quiet as the denser look's buttons stand: a capsule
 * across its column on the surface inside a hairline, its words in the ink
 * with GitHub's mark, so the provider's mark is what tells the two apart and
 * no copper is spent on a choice the page itself is for.
 */
export function ProviderButton({ label, mark, disabled = false, onPress }: ProviderButtonProps) {
  const colors = useColors();
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[buttonStyle("plain"), disabledModifier(disabled), opacity(disabled ? 0.5 : 1)]}
    >
      <HStack
        spacing={SPACE.ROW}
        modifiers={[
          frame({ maxWidth: Number.POSITIVE_INFINITY }),
          padding({ vertical: WAY_IN_PADDING }),
          foregroundStyle(colors.TEXT),
          background(colors.SURFACE, shapes.capsule()),
          strokeBorder({
            content: colors.CHIP_EDGE,
            shape: "capsule",
            style: { lineWidth: HAIRLINE },
          }),
        ]}
      >
        <Image
          assetName={mark}
          modifiers={[
            resizable(),
            frame({ width: PROVIDER_MARK_SIZE, height: PROVIDER_MARK_SIZE }),
            accessibilityHidden(),
          ]}
        />
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" })]}>
          {label}
        </Text>
      </HStack>
    </SwiftUIButton>
  );
}
