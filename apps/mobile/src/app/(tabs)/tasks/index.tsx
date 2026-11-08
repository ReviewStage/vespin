// index.tsx -- the Tasks list.

import { TASKS_PLACEHOLDER } from "../../../placeholders.js";
import { CollectionListScreen } from "../../../screens/collection-screens.js";

export default function TasksScreen() {
  return <CollectionListScreen collection={TASKS_PLACEHOLDER} />;
}
