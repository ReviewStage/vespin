// start-task.tsx -- New task, Home's composer as a sheet, which the tab bar's round + opens, and a task's New sub-task opens as a sub-task of the task the route's `parent` names.

import { useLocalSearchParams } from "expo-router";
import { NewTaskScreen } from "../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function StartTaskRoute() {
  const { parent } = useLocalSearchParams<{ parent?: string }>();
  return <NewTaskScreen parent={parent === "" ? undefined : parent} />;
}
