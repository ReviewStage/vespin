// [id].tsx -- one comment thread on a task's description, which the task's Overview lists, with its reply field.

import { CommentThreadScreen } from "../../../../screens/comment-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../screen-boundary.js";

export default function CommentThreadRoute() {
  return <CommentThreadScreen />;
}
