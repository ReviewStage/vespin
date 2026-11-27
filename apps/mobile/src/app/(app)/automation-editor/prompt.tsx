// prompt.tsx -- an automation's prompt, edited whole over the editor in its sheet, its mentions drawn as pills and offered from an `@`.

import { PromptScreen } from "../../../screens/automation-editor-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function PromptRoute() {
  return <PromptScreen />;
}
