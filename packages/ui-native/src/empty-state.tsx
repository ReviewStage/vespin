// empty-state.tsx -- what a screen or a column says when it has nothing to show, laid out as the system's own ContentUnavailableView lays it out, or the system's spinner over its words while what it shows is still read.

import { Image, ProgressView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Fragment } from "react";
import { Button } from "./button.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The room between the glyph, the title, the line, and the act, as the system's view stands them. */
const EMPTY_SPACING = 12;

export type EmptyStateProps = {
  readonly title: string;
  readonly symbol: Glyph;
  readonly description?: string | undefined;
  /** The one act that fills the screen, such as Sign in. */
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
  /** Whether what the screen shows is still read, which stands the system's spinner over the title in the symbol's place, so a read under way never looks like nothing to show. */
  readonly loading?: boolean | undefined;
};

/** The system's spinner over a read's words, centered in the space it is given, as Mail and Photos stand one while they read. */
function LoadingState({ title }: { readonly title: string }) {
  const colors = useColors();

  return (
    <ProgressView
      modifiers={[
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
        tint(colors.TEXT_MUTED),
      ]}
    >
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        {title}
      </Text>
    </ProgressView>
  );
}

/**
 * An empty screen's glyph, title, line, and the act that fills it; or, while
 * it reads, the spinner and its title. Note that it stacks them itself, as
 * the system's ContentUnavailableView does (a large muted glyph, a bold
 * title, a muted line), because that view takes only an SF Symbol and the
 * glyph is the panel's own Lucide one. Note too that the stack is drawn anew
 * whenever its title or line changes, keyed by both, because `@expo/ui`'s
 * native text keeps the words it first stood with when only its props change,
 * so Search went on saying what it finds after a query that found nothing.
 */
export function EmptyState({
  title,
  symbol,
  description,
  action,
  loading = false,
}: EmptyStateProps) {
  const colors = useColors();

  if (loading) return <LoadingState title={title} />;
  const centered = multilineTextAlignment("center");

  return (
    <Fragment key={description ?? ""}>
      <VStack
        key={title}
        spacing={EMPTY_SPACING}
        modifiers={[
          padding({ all: EMPTY_SPACING * 2 }),
          frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
        ]}
      >
        <Image
          {...glyphImage(symbol)}
          color={colors.TEXT_MUTED}
          modifiers={[font({ textStyle: "largeTitle", weight: "regular" }), accessibilityHidden()]}
        />
        <Text
          modifiers={[
            font({ textStyle: "title2", weight: "bold" }),
            foregroundStyle(colors.TEXT),
            centered,
          ]}
        >
          {title}
        </Text>
        {description === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: "callout" }),
              foregroundStyle(colors.TEXT_MUTED),
              centered,
            ]}
          >
            {description}
          </Text>
        )}
        {action === undefined ? null : <Button label={action.label} onPress={action.onPress} />}
      </VStack>
    </Fragment>
  );
}

/**
 * What a detail column says before a row is picked: its words alone in the
 * muted ink, centered, as Mail stands "No Message Selected". Note that it
 * draws no glyph and no bold title, because nothing is wrong or empty; the
 * column only waits for a pick.
 */
export function NoSelection({ title }: { readonly title: string }) {
  const colors = useColors();

  return (
    <VStack
      key={title}
      modifiers={[
        padding({ all: EMPTY_SPACING * 2 }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
      ]}
    >
      <Text
        modifiers={[
          font({ textStyle: "title2", weight: "semibold" }),
          foregroundStyle(colors.TEXT_MUTED),
          multilineTextAlignment("center"),
        ]}
      >
        {title}
      </Text>
    </VStack>
  );
}
