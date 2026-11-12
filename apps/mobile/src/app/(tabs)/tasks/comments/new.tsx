// new.tsx -- a new comment thread on one block of a task's description, which a long press on the block opens, with its comment field.

import { NewCommentScreen } from "../../../../screens/comment-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../screen-boundary.js";

export default function NewCommentRoute() {
  return <NewCommentScreen />;
}
