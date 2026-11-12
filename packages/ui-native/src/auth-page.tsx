// auth-page.tsx -- a page a person signs in on: the Keel mark, the page's title, its ways in, and what went wrong, as the web's sign-in card lays them out.

import { Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark.js";
import { Spacer } from "./screen.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The mark's size over the title, in points. */
const AUTH_MARK_SIZE = 56;

/** How wide the column stands at most, so a wide window keeps the buttons a phone's width. */
const AUTH_COLUMN_WIDTH = 360;

type AuthPageProps = {
  readonly title: string;
  /** The ways in, each a `ProviderButton`. */
  readonly children: ReactNode;
  /** Why the last attempt did not finish, in the danger color under the buttons. */
  readonly error?: string | undefined;
  /** A quiet line at the foot of the column. */
  readonly footnote?: string | undefined;
};

/**
 * The column centered on the screen's ground, a phone's width at most on a
 * wider window, such as an iPad's, and centered there too: the mark, the title in the
 * system's title type, the buttons a person signs in with, and a line under
 * them where the last attempt went wrong. It stands inside a `Screen`.
 */
export function AuthPage({ title, children, error, footnote }: AuthPageProps) {
  const colors = useColors();

  return (
    <VStack
      spacing={SPACE.PAGE}
      modifiers={[
        frame({ maxWidth: AUTH_COLUMN_WIDTH }),
        padding({ horizontal: SPACE.PAGE }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
      ]}
    >
      <Spacer />
      <BrandMark size={AUTH_MARK_SIZE} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          multilineTextAlignment("center"),
        ]}
      >
        {title}
      </Text>
      <VStack spacing={SPACE.TIGHT * 2}>{children}</VStack>
      {error === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.DANGER_TEXT),
            multilineTextAlignment("center"),
          ]}
        >
          {error}
        </Text>
      )}
      <Spacer />
      {footnote === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            multilineTextAlignment("center"),
          ]}
        >
          {footnote}
        </Text>
      )}
    </VStack>
  );
}
