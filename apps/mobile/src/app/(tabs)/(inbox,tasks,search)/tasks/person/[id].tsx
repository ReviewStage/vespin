// [id].tsx -- one person's page in the workspace the phone works in, as a person chip or a person's link opens it.

import { PersonScreen } from "../../../../../screens/person-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../../screen-boundary.js";

export default function PersonRoute() {
  return <PersonScreen />;
}
