// index.tsx -- the Inbox list.

import { INBOX_PLACEHOLDER } from "../../../placeholders.js";
import { CollectionListScreen } from "../../../screens/collection-screens.js";

export default function InboxScreen() {
  return <CollectionListScreen collection={INBOX_PLACEHOLDER} />;
}
