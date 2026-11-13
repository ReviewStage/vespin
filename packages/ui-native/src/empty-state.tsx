// empty-state.tsx -- what a screen or a column says when it has nothing to show, in the system's own ContentUnavailableView, or the system's spinner over its words while what it shows is still read.

import { ContentUnavailableView, ProgressView, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, tint } from "@expo/ui/swift-ui/modifiers";
import { BUTTON_LOOK, Button, type ButtonLook } from "./button.js";
import { type Glyph, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

export type EmptyStateProps = {
  readonly title: string;
  readonly symbol: Glyph;
  readonly description?: string | undefined;
  /** The one act that fills the screen, such as Sign in, filled unless it names a quieter look, as a failure's Try again does. */
  readonly action?:
    | { readonly label: string; readonly onPress: () => void; readonly look?: ButtonLook }
    | undefined;
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
 * An empty screen's glyph, title, line, and the act that fills it, in the
 * system's own ContentUnavailableView, as Mail and Notes say a list is empty;
 * or, while it reads, the spinner and its title. Note that the view takes the
 * panel's own Lucide glyph from the asset catalog, and its title and line in
 * the brand's inks, through the app's `@expo/ui` patch
 * (`patches/@expo__ui@58.0.27.patch`).
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
  const image = glyphImage(symbol);

  return (
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
}
