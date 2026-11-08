import { titleNativeAgent } from "@repo/service/agents/native-events/native-title";
import {
  runnerEventsApp,
  sandboxAtRunnerEnd,
  sandboxAtRunnerIdle,
  sandboxTouched,
} from "@repo/service/agents/native-events/runner-events-app";
import type { WebServices } from "@repo/service/runtime";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner posts its events (POST), admitted by the runner's own bearer rather than an account's; a running turn touches its sandbox, a Mac's launch's IDLE retires its runner where its host waits to update, a launch's end hands its waiting lines on, and a turn's start or end names an untitled agent; a turn's end hands on the agent's queue through the settled-turn listener, as every settle does. The logic lives in `packages/service/src/agents/native-events/runner-events-app.ts`. */
export default routeFromHttpRouter(
  runnerEventsApp<WebServices>({
    ended: sandboxAtRunnerEnd,
    idled: sandboxAtRunnerIdle,
    alive: sandboxTouched,
    title: titleNativeAgent,
  }),
  // Off Vercel, a turn the batch queues, or a launch's end publishes again, is delivered in this process, by these harnesses.
  nativeAgents,
);
