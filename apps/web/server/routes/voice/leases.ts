import { voiceCallLeasesHandler } from "@repo/service/voice/voice-call-lease";
import { nativeAgents } from "../../native-agents.js";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The voice-calls queue's consumer, a function of its own that the queue
 * alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. Each
 * delivery holds one lease on a voice call's GPT-Live session for as long as
 * the function may run. The logic lives in
 * `packages/service/src/voice/voice-call-lease.ts`; this file only hands it
 * the runtime's services, the native harnesses beside them, which a
 * delegation the call sends the agent may launch a runner on.
 */
export default routeFromWebServices(voiceCallLeasesHandler, nativeAgents);
