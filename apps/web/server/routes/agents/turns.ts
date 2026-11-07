import { agentTurnsHandler } from "@repo/service/agents/coder-host/turn-delivery";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The agent-turns queue's consumer, a function of its own that the queue
 * alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/agents/coder-host/turn-delivery.ts`;
 * this file only hands it the runtime's services, the native harnesses
 * beside them, which launch the runner a queued turn is handed to.
 */
export default routeFromWebServices(agentTurnsHandler, nativeAgents);
