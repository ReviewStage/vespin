import { androidAssetLinksApp } from "@repo/service/auth/android-asset-links";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The home host's Digital Asset Links, which the web service rewrites `/.well-known/assetlinks.json` onto (`function-rewrites.ts`): the Android app the deployment names, read from its environment on each request. The logic lives in `packages/service/src/auth/android-asset-links.ts`. */
export default routeFromHttpRouter(androidAssetLinksApp());
