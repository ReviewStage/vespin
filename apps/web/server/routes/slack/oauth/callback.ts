import { slackInstallApp } from "@repo/service/slack/slack-install-app";
import { routeFromHttpRouter } from "../../../route-effect.js";

/**
 * Our Slack app's Redirect URL, which Slack returns the browser to after an
 * Add to Slack (GET). The logic lives in
 * `packages/service/src/slack/slack-install-app.ts`; this file only hands the
 * route to the adaptor.
 */
export default routeFromHttpRouter(slackInstallApp());
