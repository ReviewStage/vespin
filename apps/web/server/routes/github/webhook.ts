import { githubWebhookApp } from "@repo/service/github/github-webhook-app";
import { agentImage, nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";
import { runWeb } from "../../runtime.js";

/**
 * Our GitHub App's webhook, which GitHub delivers pull request and
 * check events to. The logic lives in `packages/service/src/github/github-webhook-app.ts`; this
 * file only hands the group to the route adaptor.
 */
export default routeFromHttpRouter(
  githubWebhookApp({ drives: { run: runWeb, image: agentImage } }),
  nativeAgents,
);
