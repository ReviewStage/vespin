// page.tsx -- a new comment thread on words selected in a page an agent showed, or on the page whole, in the comment sheet over the page, with its comment field.

import { NewPageCommentScreen } from "../../../screens/page-comment-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function NewPageCommentRoute() {
  return <NewPageCommentScreen />;
}
