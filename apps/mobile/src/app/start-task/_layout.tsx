// _layout.tsx -- New task's own stack inside its sheet, so the sheet's bar is a navigation bar of the sheet's own, which takes the system's light or dark from the sheet, as Settings' does.

import { Stack } from "expo-router";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function StartTaskLayout() {
  return <Stack />;
}
