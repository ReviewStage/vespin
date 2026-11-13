// move-task.tsx -- the Move to workspace sheet over the task the route's `task` names.

import { useLocalSearchParams } from "expo-router";
import { MoveTaskScreen } from "../../screens/move-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function MoveTaskRoute() {
  const { task = "" } = useLocalSearchParams<{ task: string }>();

  return <MoveTaskScreen taskId={task} />;
}
