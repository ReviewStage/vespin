// _layout.tsx -- the automation editor's own stack (`sheet-stack.tsx`), so its bar takes the sheet's light or dark, with the door its pushed pages pick through.

import { EditorPickProvider } from "../../automations/editor-pick.js";
import { SheetStack } from "../../sheet-stack.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function AutomationEditorLayout() {
  return (
    <EditorPickProvider>
      <SheetStack />
    </EditorPickProvider>
  );
}
