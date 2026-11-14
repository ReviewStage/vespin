// auth-page.tsx -- a page a person signs in on: the Keel mark, the page's title and what the product is, then its ways in at the foot and what went wrong, as Apple's own first screens lay them out.

import { ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useAccessibilitySize, useAnnounced } from "./accessibility.js";
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
  /** What the product is, in one line under the title, as Apple's own first screens say it. */
  readonly description?: string | undefined;
  /** The ways in, each a `ProviderButton`. */
  readonly children: ReactNode;
  /** Why the last attempt did not finish, in the danger color under the buttons, said aloud by VoiceOver as it comes. */
  readonly error?: string | undefined;
  /** A quiet line at the foot of the column. */
  readonly footnote?: string | undefined;
};

/** The mark, the title, and the line under it, which head the page. */
function AuthHead({ title, description }: Pick<AuthPageProps, "title" | "description">) {
  const colors = useColors();
  const centered = multilineTextAlignment("center");

  return (
    <VStack spacing={SPACE.TIGHT * 2}>
      <BrandMark size={AUTH_MARK_SIZE} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          centered,
          accessibilityAddTraits(["isHeader"]),
        ]}
      >
        {title}
      </Text>
      {description === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            centered,
          ]}
        >
          {description}
        </Text>
      )}
    </VStack>
  );
}

/** The ways in, what went wrong, and the footnote, which stand at the foot of the page. */
function AuthFoot({
  children,
  error,
  footnote,
}: Pick<AuthPageProps, "children" | "error" | "footnote">) {
  const colors = useColors();
  const centered = multilineTextAlignment("center");

  return (
    <VStack spacing={SPACE.PAGE}>
      <VStack spacing={SPACE.TIGHT * 2}>{children}</VStack>
      {error === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.DANGER_TEXT),
            centered,
          ]}
        >
          {error}
        </Text>
      )}
      {footnote === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            centered,
          ]}
        >
          {footnote}
        </Text>
      )}
    </VStack>
  );
}

/**
 * A page a person signs in on, on the screen's ground, a phone's width at
 * most on a wider window, such as an iPad's, and centered there: the mark,
 * the title in the system's title type and the line under it in the middle,
 * and the buttons a person signs in with at the foot, in the thumb's reach,
 * as Apple's own first screens stand them, with a line under them where the
 * last attempt went wrong. At an accessibility size the page scrolls, its
 * parts one after another, so nothing is cut off on a short window. It stands
 * inside a `Screen`.
 */
export function AuthPage({ title, description, children, error, footnote }: AuthPageProps) {
  const large = useAccessibilitySize();
  useAnnounced(error);

  const column = [
    frame({ maxWidth: AUTH_COLUMN_WIDTH }),
    padding({ horizontal: SPACE.PAGE, vertical: SPACE.PAGE }),
    frame({ maxWidth: Number.POSITIVE_INFINITY }),
  ];

  const head = <AuthHead title={title} description={description} />;

  const foot = (
    <AuthFoot error={error} footnote={footnote}>
      {children}
    </AuthFoot>
  );

  if (large) {
    return (
      <ScrollView>
        <VStack spacing={SPACE.PAGE * 2} modifiers={column}>
          {head}
          {foot}
        </VStack>
      </ScrollView>
    );
  }

  return (
    <VStack
      spacing={SPACE.PAGE}
      modifiers={[...column, frame({ maxHeight: Number.POSITIVE_INFINITY })]}
    >
      <Spacer />
      {head}
      <Spacer />
      {foot}
    </VStack>
  );
}
