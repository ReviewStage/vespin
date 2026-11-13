// add-follower.tsx -- the Add a follower sheet over the task the route's `task` names.

import { useLocalSearchParams } from "expo-router";
import { AddFollowerScreen } from "../screens/follower-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function AddFollowerRoute() {
  const { task = "" } = useLocalSearchParams<{ task: string }>();

  return <AddFollowerScreen taskId={task} />;
}
