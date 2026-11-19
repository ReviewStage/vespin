// empty-state.tsx -- what a screen or a column says when it has nothing to show, in the system's own ContentUnavailableView, or the system's bare spinner while what it shows is still read.

import { ContentUnavailableView, ProgressView, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useAccessibilitySize } from "./accessibility.js";
import { BUTTON_LOOK, Button, type ButtonLook } from "./button.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";

/** What a press to read or send again says, as the app says it everywhere: the panel's Retry in the phone's words. */
export const TRY_AGAIN_WORDS = "Try again";

/** The room around a column's words while it waits for a pick, in points. */
const EMPTY_SPACING = 12;

/** The one act an empty screen offers: its own, or the Try again a read that failed offers; never both, since one would stand in the other's place. */
type EmptyStateAct =
  | {
      /** The one act that fills the screen, such as Sign in, filled unless it names a quieter look. */
      readonly action?:
        | { readonly label: string; readonly onPress: () => void; readonly look?: ButtonLook }
        | undefined;
      readonly retry?: undefined;
    }
  | {
      readonly action?: undefined;
      /**
       * Reads what failed again: the bordered Try again in the act's place,
       * quiet rather than filled, since a failure is no screen's main act, as
       * every read that failed offers it.
       */
      readonly retry: () => void;
    };

export type EmptyStateProps = EmptyStateAct & {
  readonly title: string;
  readonly symbol: Glyph;
  readonly description?: string | undefined;
  /** Whether what the screen shows is still read, which stands the system's bare spinner in the state's place, the title heard by VoiceOver alone, so a read under way never looks like nothing to show. */
  readonly loading?: boolean | undefined;
};

/**
 * The system's bare spinner, centered in the space it is given where what
 * is read will stand, as Mail and Photos stand one while they read, with no
 * words beside it (the developer, Nov 18, 2026); VoiceOver hears the read's
 * words as its label.
 */
function LoadingState({ title }: { readonly title: string }) {
  const colors = useColors();

  return (
    <ProgressView
      modifiers={[
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
        tint(colors.TEXT_MUTED),
        accessibilityLabel(title),
      ]}
    />
  );
}

/**
 * An empty screen's glyph, title, line, and the act that fills it, in the
 * system's own ContentUnavailableView, as Mail and Notes say a list is empty;
 * or, while it reads, the bare spinner, heard as its title. Note that the view takes the
 * panel's own Lucide glyph from the asset catalog, and its title and line in
 * the brand's inks, through the app's `@expo/ui` patch
 * (`patches/@expo__ui@58.0.27.patch`).
 */
export function EmptyState({
  title,
  symbol,
  description,
  action: given,
  retry,
  loading = false,
}: EmptyStateProps) {
  const colors = useColors();
  const large = useAccessibilitySize();

  if (loading) return <LoadingState title={title} />;

  const image = glyphImage(symbol);

  const action =
    retry === undefined
      ? given
      : { label: TRY_AGAIN_WORDS, onPress: retry, look: BUTTON_LOOK.BORDERED };

  const view = (
    <ContentUnavailableView
      title={title}
      {...("assetName" in image ? { image: image.assetName } : { systemImage: image.systemName })}
      description={description ?? ""}
      primaryColor={colors.TEXT}
      secondaryColor={colors.TEXT_MUTED}
      modifiers={[
        frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
      ]}
      actions={
        action === undefined ? undefined : (
          <Button
            label={action.label}
            onPress={action.onPress}
            look={action.look ?? BUTTON_LOOK.PROMINENT}
          />
        )
      }
    />
  );

  // Note that at an accessibility size the words outgrow a short screen, such as Search's over its keyboard, so they scroll there rather than stand cut short with "…".
  return large ? (
    <ScrollView modifiers={[scrollDismissesKeyboard("immediately")]}>{view}</ScrollView>
  ) : (
    view
  );
}

/**
 * What a detail column says before a row is picked: its words alone in the
 * muted ink, centered, as Mail stands "No Message Selected". Note that it
 * draws no glyph and no bold title, a step under a column's own title, because nothing is wrong or empty; the
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
          font({ textStyle: "title3" }),
          foregroundStyle(colors.TEXT_MUTED),
          multilineTextAlignment("center"),
        ]}
      >
        {title}
      </Text>
    </VStack>
  );
}
