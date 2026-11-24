// account-button.tsx -- the signed-in account's photo at the leading edge of a tab's bar, the button that opens Settings, and its photo and name at an iPad sidebar's foot, opening the account's menu.

import { Host, HStack, Menu, Section, Button as SwiftUIButton, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
  menuIndicator,
  menuStyle,
} from "@expo/ui/swift-ui/modifiers";
import type { Glyph } from "./glyph.js";
import { menuActContent } from "./glyph-label.js";
import { Avatar } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

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

/** An act an account's menu holds, such as Settings or Sign out. */
export type AccountMenuAction = {
  readonly label: string;
  readonly symbol: Glyph;
  /** Whether it takes something away, such as Sign out, which the system draws red and sets apart. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
};

/**
 * The signed-in account at the foot of an iPad's own sidebar, as the panel's
 * sidebar foot stands it: its photo and name, opening the system's menu of
 * what the account does, such as Settings and Send feedback, with what takes
 * something away, such as Sign out, set apart last.
 */
export function AccountMenuItem({
  name,
  picture,
  actions,
}: {
  readonly name: string;
  readonly picture?: string | undefined;
  readonly actions: readonly AccountMenuAction[];
}) {
  const colors = useColors();
  const kept = actions.filter((action) => action.destructive !== true);
  const away = actions.filter((action) => action.destructive === true);

  const item = (action: AccountMenuAction) => (
    <SwiftUIButton
      key={action.label}
      {...menuActContent(action.label, action.symbol, undefined)}
      onPress={action.onPress}
      {...(action.destructive === true ? { role: "destructive" } : {})}
    />
  );

  return (
    <Menu
      label={
        <HStack spacing={SPACE.TIGHT + 2}>
          <Avatar name={name} picture={picture} size={MARK_SIZE.BAR_FACE} />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT),
              lineLimit(1),
            ]}
          >
            {name}
          </Text>
        </HStack>
      }
      modifiers={[
        menuStyle("button"),
        buttonStyle("plain"),
        menuIndicator("hidden"),
        accessibilityLabel(name),
      ]}
    >
      <Section>{kept.map(item)}</Section>
      {away.length === 0 ? null : <Section>{away.map(item)}</Section>}
    </Menu>
  );
}
