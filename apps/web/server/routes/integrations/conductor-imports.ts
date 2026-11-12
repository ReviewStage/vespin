import { conductorImportsHandler } from "@repo/service/integrations/conductor/conductor-import";
import { routeFromWebServices } from "../../route-effect.js";

/**
 * The conductor-imports queue's consumer, a function of its own that the
 * queue alone invokes: its trigger is written into its `.vc-config.json`
 * (`server/build-output.ts`), and it has no rewrite and no public path. The
 * logic lives in `packages/service/src/integrations/conductor/conductor-import.ts`;
 * this file only hands it the runtime's services.
 */
export default routeFromWebServices(conductorImportsHandler);
