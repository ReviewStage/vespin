// share-page.tsx -- the share page's scratch page, which a launch opens on (`-sharePage true`) so a flow shoots it.

import { SharePageScreen } from "../../screens/share-page-screen.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

export default function SharePageRoute() {
  return <SharePageScreen />;
}
