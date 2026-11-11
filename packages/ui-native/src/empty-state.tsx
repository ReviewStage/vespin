// empty-state.tsx -- what a screen or a column says when it has nothing to show, as the system's own ContentUnavailableView, or the system's spinner over its words while what it shows is still read.

import { ContentUnavailableView, ProgressView, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, tint } from "@expo/ui/swift-ui/modifiers";
import { Fragment } from "react";
import { Button } from "./button.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { TYPE_ROLE } from "./tokens/type.js";

export type EmptyStateProps = {
  readonly title: string;
  readonly symbol: SfSymbol;
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
 * An empty screen's symbol, title, line, and the act that fills it; or,
 * while it reads, the spinner and its title. Note that the system's view is
 * drawn anew whenever its title or line changes, keyed by each, because
 * `@expo/ui`'s native view keeps the words it first stood with when only its
 * props change, so Search went on saying what it finds after a query that
 * found nothing.
 */
export function EmptyState({
  title,
  symbol,
  description,
  action,
  loading = false,
}: EmptyStateProps) {
  if (loading) return <LoadingState title={title} />;
  return (
    <Fragment key={description ?? ""}>
      <ContentUnavailableView
        key={title}
        title={title}
        systemImage={symbol}
        {...(description === undefined ? {} : { description })}
        {...(action === undefined
          ? {}
          : { actions: <Button label={action.label} onPress={action.onPress} /> })}
      />
    </Fragment>
  );
}
