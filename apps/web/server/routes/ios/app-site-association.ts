import { appleAppSiteAssociationApp } from "@repo/service/auth/apple-app-site-association";
import { routeFromHttpRouter } from "../../route-effect.js";

/** The home host's Apple App Site Association, which the web service rewrites `/.well-known/apple-app-site-association` onto (`function-rewrites.ts`): the iPhone app the deployment names, read from its environment on each request. The logic lives in `packages/service/src/auth/apple-app-site-association.ts`. */
export default routeFromHttpRouter(appleAppSiteAssociationApp());
