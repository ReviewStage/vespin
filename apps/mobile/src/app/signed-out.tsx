// signed-out.tsx -- the placeholder a signed-out app shows; the sign-in flow replaces its button.

import { Button, ContentUnavailableView, Host } from "@expo/ui/swift-ui";
import { buttonStyle } from "@expo/ui/swift-ui/modifiers";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { useRouter } from "expo-router";

export default function SignedOutScreen() {
  const router = useRouter();
  return (
    <Host style={{ flex: 1 }}>
      <ContentUnavailableView
        title={`Signed out of ${PRODUCT_NAME}`}
        systemImage="person.crop.circle.badge.xmark"
        description="Sign in to see your Inbox and tasks."
        actions={
          <Button
            label="Sign in"
            onPress={() => router.replace("/inbox")}
            modifiers={[buttonStyle("borderedProminent")]}
          />
        }
      />
    </Host>
  );
}
