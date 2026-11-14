// host-failed.tsx -- what the app shows in place of its screens while the host starts, the brand's ground alone, and when it could not start, with Try again.

import { PRODUCT_NAME } from "@repo/features/product-name";
import { VERB } from "@repo/features/words";
import { BUTTON_LOOK, EmptyState, GLYPH, Screen, Spacer } from "@repo/ui-native";

export function HostFailedScreen({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Screen>
      <EmptyState
        title={`${PRODUCT_NAME} could not start`}
        symbol={GLYPH.FAILED}
        description="Something went wrong as the app started."
        action={{ label: VERB.TRY_AGAIN, look: BUTTON_LOOK.BORDERED, onPress: onRetry }}
      />
    </Screen>
  );
}

/** The brand's ground alone, standing under the splash while the host starts, so nothing of the window's own black shows should the splash come down first. */
export function HostStartingScreen() {
  return (
    <Screen>
      <Spacer />
    </Screen>
  );
}
