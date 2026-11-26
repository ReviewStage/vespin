// repositories.tsx -- every repository a Manager works in, pushed over its Settings in their sheet.

import { ManagerRepositoriesScreen } from "../../screens/manager-sheets.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function ManagerRepositoriesRoute() {
  return <ManagerRepositoriesScreen />;
}
