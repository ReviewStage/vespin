// [id].tsx -- one Inbox thread.

import { INBOX_PLACEHOLDER } from "../../../placeholders.js";
import { CollectionDetailScreen } from "../../../screens/collection-screens.js";

export default function InboxThreadScreen() {
  return <CollectionDetailScreen collection={INBOX_PLACEHOLDER} />;
}
