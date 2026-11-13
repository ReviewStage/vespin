// task-following.tsx -- the Following sheet over the task the route's `task` names: who follows it, and the reader's own switch, Unfollow, or Follow.

import { useLocalSearchParams } from "expo-router";
import { TaskFollowingScreen } from "../screens/following-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function TaskFollowingRoute() {
  const { task = "" } = useLocalSearchParams<{ task: string }>();

  return <TaskFollowingScreen taskId={task} />;
}
