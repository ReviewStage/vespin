// host-failed.tsx -- what the app shows in place of its screens when the host could not start, with Retry.

import { Button, ContentUnavailableView, Host } from "@expo/ui/swift-ui";
import { buttonStyle } from "@expo/ui/swift-ui/modifiers";
import { PRODUCT_NAME } from "@repo/features/product-name";

export function HostFailedScreen({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Host style={{ flex: 1 }}>
      <ContentUnavailableView
        title={`${PRODUCT_NAME} could not start`}
        systemImage="exclamationmark.triangle"
        description="Something went wrong as the app started. Try again."
        actions={<Button label="Retry" onPress={onRetry} modifiers={[buttonStyle("bordered")]} />}
      />
    </Host>
  );
}
