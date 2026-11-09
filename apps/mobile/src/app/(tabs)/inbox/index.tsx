// index.tsx -- the Inbox list: every item waiting on the developer, read from the host's document, with Settings in its bar.

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { appStateQuery } from "../../../host/app-state-query.js";
import { EMPTY_INBOX, selectInboxCollection } from "../../../host/inbox-rows.js";
import { CollectionListScreen } from "../../../screens/collection-screens.js";

// Settings opens from the Inbox's bar, as a sheet over the tabs.
export default function InboxScreen() {
  const router = useRouter();
  const { data } = useQuery({ ...appStateQuery, select: selectInboxCollection });
  return (
    <CollectionListScreen
      collection={data ?? EMPTY_INBOX}
      barAction={{
        label: "Settings",
        symbol: "gearshape",
        onPress: () => router.push("/settings"),
      }}
    />
  );
}
