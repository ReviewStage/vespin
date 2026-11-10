import { agentWakeupsHandler } from "@repo/service/agents/coder-host/agent-wakeups";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The agent-wakeups queue's consumer, a function of its own that the queue
 * alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/agents/coder-host/agent-wakeups.ts`;
 * this file only hands it the runtime's services.
 */
export default routeFromWebServices(agentWakeupsHandler);
