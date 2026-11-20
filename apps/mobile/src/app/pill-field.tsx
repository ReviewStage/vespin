// pill-field.tsx -- the pill field's scratch page, which a launch opens on (`-pillField true`) so a flow shoots the field.

import { PillFieldScreen } from "../screens/pill-field-screen.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

export default function PillFieldRoute() {
  return <PillFieldScreen />;
}
