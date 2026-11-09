// [id].tsx -- one Inbox thread, read from the host's document.

import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../../../host/app-state-query.js";
import { EMPTY_INBOX, selectInboxCollection } from "../../../host/inbox-rows.js";
import { CollectionDetailScreen } from "../../../screens/collection-screens.js";

export default function InboxThreadScreen() {
  const { data } = useQuery({ ...appStateQuery, select: selectInboxCollection });
  return <CollectionDetailScreen collection={data ?? EMPTY_INBOX} />;
}
