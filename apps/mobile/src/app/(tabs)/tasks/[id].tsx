// [id].tsx -- one task.

import { TASKS_PLACEHOLDER } from "../../../placeholders.js";
import { CollectionDetailScreen } from "../../../screens/collection-screens.js";

export default function TaskScreen() {
  return <CollectionDetailScreen collection={TASKS_PLACEHOLDER} />;
}
