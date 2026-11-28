// page-threads.tsx -- the comment threads on a page an agent showed, as a list in the comment sheet over the page, each opening its thread in the same sheet.

import { PageThreadsScreen } from "../../../screens/page-comment-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function PageThreadsRoute() {
  return <PageThreadsScreen />;
}
