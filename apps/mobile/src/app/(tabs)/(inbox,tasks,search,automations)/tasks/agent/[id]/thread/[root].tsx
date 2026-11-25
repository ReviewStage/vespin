// [root].tsx -- one thread of a Manager's chat, pushed from the chat.

import { ManagerThreadScreen } from "../../../../../../../screens/manager-thread-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../../../screen-boundary.js";

export default function ManagerThreadRoute() {
  return <ManagerThreadScreen />;
}
