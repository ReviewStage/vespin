/**
 * e2e-server.ts -- the web app's local server as the suite starts it: the deployment's sandboxes, native harnesses, and model catalog replaced by the suite's fakes.
 *
 * It hands the fakes to the local runtime override
 * (`@repo/service/local/local-runtime-override`) and only then imports the
 * local server (`apps/web/scripts/local-server.ts`), which runs as it loads
 * and imports no route until its guard has passed, so every function's edge
 * reads the fakes as it builds. The override is honored only where the local
 * server itself would start: beside no `VERCEL*` variable and over a
 * database on this machine's loopback. The command line is the local
 * server's own (`--port`).
 */

import { memorySandbox } from "@repo/sandbox/testing";
import { overrideLocalRuntime } from "@repo/service/local/local-runtime-override";
import { fakeModelCatalogLayer } from "@repo/service/testing/model-catalog-fake";
import {
  E2E_AGENT_SCRIPTS,
  scriptedAgentSessionsLayer,
} from "@repo/service/testing/scripted-agent-sessions";

/**
 * The local server, imported by its address rather than a literal path, so
 * this workspace's typecheck stops here instead of reading the web app's
 * server again; `apps/web` checks it.
 */
const LOCAL_SERVER = new URL("../../web/scripts/local-server.ts", import.meta.url);

// Note that anything that must stand before a route loads, such as the no-network guard, starts here, ahead of the override and the import.

overrideLocalRuntime({
  sandbox: memorySandbox().layer,
  nativeAgentSessions: scriptedAgentSessionsLayer(E2E_AGENT_SCRIPTS),
  modelCatalog: fakeModelCatalogLayer,
});

await import(LOCAL_SERVER.href);
