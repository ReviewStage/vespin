// index.tsx -- one comment thread on a task's description, in the comment sheet over the task, with its reply field.

import { CommentThreadScreen } from "../../../screens/comment-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function CommentThreadRoute() {
  return <CommentThreadScreen />;
}
