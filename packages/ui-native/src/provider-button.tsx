// provider-button.tsx -- a way to sign in through a provider: the system's bordered button across its column, the provider's mark beside its words, as the web's sign-in buttons carry it.

import { HStack, Image, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  frame,
  resizable,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { BUTTON_LOOK, BUTTON_SIZE } from "./button.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/**
 * The image sets the providers' marks are drawn from, which the app's config
 * writes into its asset catalog (`apps/mobile/app.config.ts`'s
 * `withProviderMarks`) from the brand's own paths: GitHub's a template drawn
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
 * One provider's way in. Note that it stands bordered in the ink rather than
 * the accent, as the web's ways in stand outlined on the card, so the
 * provider's mark, not the brand's copper, is what tells the two apart.
 */
export function ProviderButton({ label, mark, disabled = false, onPress }: ProviderButtonProps) {
  const colors = useColors();
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle(BUTTON_LOOK.BORDERED),
        controlSize(BUTTON_SIZE.LARGE),
        tint(colors.TEXT),
        disabledModifier(disabled),
      ]}
    >
      <HStack spacing={SPACE.ROW} modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY })]}>
        <Image
          assetName={mark}
          modifiers={[
            resizable(),
            frame({ width: PROVIDER_MARK_SIZE, height: PROVIDER_MARK_SIZE }),
            accessibilityHidden(),
          ]}
        />
        <Text>{label}</Text>
      </HStack>
    </SwiftUIButton>
  );
}
