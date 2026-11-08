// signed-out.tsx -- the placeholder a signed-out app shows; the sign-in flow replaces its button.

import { PRODUCT_NAME } from "@repo/features/product-name";
import { EmptyState, Screen } from "@repo/ui-native";
import { useRouter } from "expo-router";

export default function SignedOutScreen() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        title={`Signed out of ${PRODUCT_NAME}`}
        symbol="person.crop.circle.badge.xmark"
        description="Sign in to see your Inbox and tasks."
        action={{ label: "Sign in", onPress: () => router.replace("/inbox") }}
      />
    </Screen>
  );
}
