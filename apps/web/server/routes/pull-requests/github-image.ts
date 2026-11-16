import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { pullRequestsApp } from "@repo/service/github/pull-requests-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** One image a pull request's overview names (GET), by the pull request's repository and the workspace that reaches it. The logic lives in `packages/service/src/github/pull-requests-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(pullRequestsApp({ resolveUserId: resolveHostedUserId }));
