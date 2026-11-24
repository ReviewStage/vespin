// index.tsx -- the Edit description sheet over the task the route's `task` names.

import { useLocalSearchParams } from "expo-router";
import { DescriptionEditScreen } from "../../../screens/description-edit-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function EditDescriptionRoute() {
  const { task = "" } = useLocalSearchParams<{ task: string }>();

  return <DescriptionEditScreen taskId={task} />;
}
