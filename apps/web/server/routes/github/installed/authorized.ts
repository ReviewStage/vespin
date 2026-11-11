import { resolveBrowserSessionUserId } from "@repo/service/auth/browser-session";
import { githubInstallApp } from "@repo/service/github/github-install-app";
import { agentImage } from "../../../native-agents.js";
import { routeFromHttpRouter } from "../../../route-effect.js";
import { runWeb } from "../../../runtime.js";

/**
 * The callback a workspace's connect returns through after authorizing the
 * App once. The logic lives in `packages/service/src/github/github-install-app.ts`; this file
 * only hands the group the edge's runner and the agents' image, which fill the
 * workspace's base drives once it connects, and the group to the route adaptor.
 */
export default routeFromHttpRouter(
  githubInstallApp({
    resolveSessionUserId: resolveBrowserSessionUserId,
    drives: { run: runWeb, image: agentImage },
  }),
);
