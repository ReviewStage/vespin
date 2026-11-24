// index.tsx -- the finder as a sheet over the tabs, as an iPad's sidebar Search and ⌘K, ⌘F, and ⌘3 open it.

import { FinderSheetScreen } from "../../screens/search-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function FinderRoute() {
  return <FinderSheetScreen />;
}
