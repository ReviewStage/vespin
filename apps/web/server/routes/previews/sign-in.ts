import { resolveHostedUserId } from "@repo/service/auth/bearer";
import { previewSignInApp } from "@repo/service/previews/preview-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** A shared preview's sign-in step on the app's host (GET). The logic lives in `packages/service/src/previews/preview-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(previewSignInApp({ resolveUserId: resolveHostedUserId }));
