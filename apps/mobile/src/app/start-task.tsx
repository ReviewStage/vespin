// start-task.tsx -- New task, Home's composer as a sheet, which the tab bar's round + opens.

import { NewTaskScreen } from "../screens/start-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function StartTaskRoute() {
  return <NewTaskScreen />;
}
