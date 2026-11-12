// provider-button.tsx -- a way to sign in through a provider: the system's bordered capsule across its column, the provider's mark beside its words, as the web's sign-in buttons carry it.

import { HStack, Image, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  resizable,
  tint,
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

/**
 * One provider's way in, quiet as the denser look's buttons stand: the
 * system's large bordered capsule across its column, its words in the ink
 * with GitHub's mark, so the provider's mark is what tells the two apart and
 * no copper is spent on a choice the page itself is for. The system draws
 * its press and its dimming while a sign-in is under way.
 */
export function ProviderButton({ label, mark, disabled = false, onPress }: ProviderButtonProps) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle("bordered"),
        buttonBorderShape("capsule"),
        controlSize("large"),
        tint(colors.TEXT),
        disabledModifier(disabled),
      ]}
    >
      <HStack
        spacing={SPACE.ROW}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY }), foregroundStyle(colors.TEXT)]}
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
