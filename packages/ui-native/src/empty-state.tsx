// empty-state.tsx -- what a screen or a column says when it has nothing to show, as the system's own ContentUnavailableView.

import { ContentUnavailableView } from "@expo/ui/swift-ui";
import { Button } from "./button.js";
import type { SfSymbol } from "./sf-symbol.js";

type EmptyStateProps = {
  readonly title: string;
  readonly symbol: SfSymbol;
  readonly description?: string | undefined;
  /** The one act that fills the screen, such as Sign in. */
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
};

/** An empty screen's symbol, title, line, and the act that fills it. */
export function EmptyState({ title, symbol, description, action }: EmptyStateProps) {
  return (
    <ContentUnavailableView
      title={title}
      systemImage={symbol}
      {...(description === undefined ? {} : { description })}
      {...(action === undefined
        ? {}
        : { actions: <Button label={action.label} onPress={action.onPress} /> })}
    />
  );
}
