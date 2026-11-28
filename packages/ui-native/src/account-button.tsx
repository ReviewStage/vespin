// account-button.tsx -- the signed-in account's photo at the leading edge of a tab's bar, the button that opens Settings.

import { Host, Button as SwiftUIButton } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle } from "@expo/ui/swift-ui/modifiers";
import { Avatar } from "./marks.js";
import { MARK_SIZE } from "./tokens/space.js";

/** The account a bar's photo button draws, and where pressing it goes. */
export type BarAccount = {
  /** The account's name, whose letters stand in for a photo it has none of, or one still loading or failed. */
  readonly name: string;
  /** The account's sign-in picture, where it has one. */
  readonly picture?: string | undefined;
  /** What the button is heard as: where it goes, such as Settings, rather than whose photo it is. */
  readonly label: string;
  readonly onPress: () => void;
};

/**
 * The photo as a bar item's button, for a bar SwiftUI draws, such as a
 * split view's sidebar. Note that it draws no glass of its own: the bar
 * stands it in the system's round glass, as it stands the bar's other
 * buttons, and the photo sits clipped to its circle inside.
 */
export function AccountBarItem({ name, picture, label, onPress }: BarAccount) {
  return (
    <SwiftUIButton onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
      <Avatar name={name} picture={picture} size={MARK_SIZE.BAR_FACE} />
    </SwiftUIButton>
  );
}

/**
 * The photo button for a screen's own navigation bar, the stack's header,
 * which holds React Native views: the same button in a SwiftUI host the
 * size of the photo, which the header stands in its round glass.
 */
export function AccountButton(account: BarAccount) {
  return (
    <Host matchContents>
      <AccountBarItem {...account} />
    </Host>
  );
}
