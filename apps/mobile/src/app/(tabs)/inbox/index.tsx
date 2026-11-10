// index.tsx -- the Inbox list: the account's threads under the panel's scopes, read from the host's document, with Settings in its bar.

import { useRouter } from "expo-router";
import { InboxListScreen } from "../../../screens/inbox-screens.js";

// Settings opens from the Inbox's bar, as a sheet over the tabs.
export default function InboxScreen() {
  const router = useRouter();
  return (
    <InboxListScreen
      barAction={{
        label: "Settings",
        symbol: "gearshape",
        onPress: () => router.push("/settings"),
      }}
    />
  );
}
