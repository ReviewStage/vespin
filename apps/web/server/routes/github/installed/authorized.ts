import { resolveBrowserSessionUserId } from "@repo/service/auth/browser-session";
import { githubInstallApp } from "@repo/service/github/github-install-app";
import { nativeAgents } from "../../../native-agents.js";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * The callback a workspace's connect returns through after authorizing the
 * App once. The logic lives in `packages/service/src/github/github-install-app.ts`; this file
 * only hands the group to the route adaptor, beside the native agents, whose
 * workspace drive fills regenerate the workspace's drive once it connects.
 */
export default routeFromHttpRouter(
  githubInstallApp({ resolveSessionUserId: resolveBrowserSessionUserId }),
  nativeAgents,
);
