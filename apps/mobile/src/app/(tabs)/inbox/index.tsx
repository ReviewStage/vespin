// index.tsx -- the Inbox list: every item waiting on the developer, read from the host's document.

import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../../../host/app-state-query.js";
import { EMPTY_INBOX, selectInboxCollection } from "../../../host/inbox-rows.js";
import { CollectionListScreen } from "../../../screens/collection-screens.js";

export default function InboxScreen() {
  const { data } = useQuery({ ...appStateQuery, select: selectInboxCollection });
  return <CollectionListScreen collection={data ?? EMPTY_INBOX} />;
}
