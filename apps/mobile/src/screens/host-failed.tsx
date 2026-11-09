// host-failed.tsx -- what the app shows in place of its screens when the host could not start, with Retry.

import { PRODUCT_NAME } from "@repo/features/product-name";
import { EmptyState, Screen } from "@repo/ui-native";

export function HostFailedScreen({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Screen>
      <EmptyState
        title={`${PRODUCT_NAME} could not start`}
        symbol="exclamationmark.triangle"
        description="Something went wrong as the app started. Try again."
        action={{ label: "Retry", onPress: onRetry }}
      />
    </Screen>
  );
}
