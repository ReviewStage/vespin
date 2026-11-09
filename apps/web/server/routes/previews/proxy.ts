import { agentSandboxLayer } from "@repo/service/agents/terminal/agent-sandbox";
import { previewProxyApp } from "@repo/service/previews/preview-app";
import { Layer } from "effect";
import { agentImage } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Every request to a shared preview's host, in a function of its own (`function-durations.ts`). The logic lives in `packages/service/src/previews/preview-app.ts`; this file only hands it the deployment's real seams. */
export default routeFromHttpRouter(
  previewProxyApp({ sandbox: agentSandboxLayer.pipe(Layer.provide(agentImage)) }),
);
