import { runnerPicturesApp } from "@repo/service/agents/native-events/runner-pictures-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a native harness's runner keeps a picture its harness's tool answered (POST), admitted by the runner's own bearer rather than an account's. The logic lives in `packages/service/src/agents/native-events/runner-pictures-app.ts`; this file only mounts it. */
export default routeFromHttpRouter(runnerPicturesApp());
