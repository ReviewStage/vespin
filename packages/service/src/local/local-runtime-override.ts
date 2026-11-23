/**
 * local-runtime-override.ts -- the services a local server may be started with in the deployment's place, never honored where the local server would refuse to start.
 *
 * The web functions build their sandboxes, their native harnesses, and their
 * model catalog from the deployment's own adapters (`apps/web/server/runtime.ts`,
 * `apps/web/server/native-agents.ts`). An end-to-end suite starts the local
 * server (`apps/web/scripts/local-server.ts`) with fakes in their place: it
 * hands them here before any route is imported, and the edge reads them back
 * as it builds. Every function's bundle reaches this module through the edge,
 * so the read holds the local server's own guard
 * (`local-server-guard.ts`): beside any `VERCEL*` variable, or over a
 * database off this machine, it answers no override, and the deployment's
 * adapters are built as they always are.
 */

import type { Sandbox } from "@repo/sandbox";
import type { Layer } from "effect";
import type { AgentImage } from "../agents/coder-host/agent-image.js";
import type { NativeAgentSessions } from "../agents/coder-host/runtime-sessions.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import type { WebServices } from "../runtime.js";
import { localServerRefusal } from "./local-server-guard.js";

/** The services an override stands in the deployment's place, each over what the deployment's own is built over; each one left out is the deployment's own. */
export interface LocalRuntimeOverride {
  readonly sandbox?: Layer.Layer<Sandbox>;
  readonly nativeAgentSessions?: Layer.Layer<NativeAgentSessions, never, WebServices | AgentImage>;
  readonly modelCatalog?: Layer.Layer<ModelCatalog>;
}

const NONE: LocalRuntimeOverride = {};

/** The override handed for this process, which the edge reads once as it builds. */
let handed: LocalRuntimeOverride = NONE;

/**
 * Hands the local server the services to build in the deployment's place,
 * before any route is imported, since the edge reads them as it builds.
 * @public
 */
export function overrideLocalRuntime(override: LocalRuntimeOverride): void {
  handed = override;
}

/**
 * The override handed for this process, or none wherever the local server
 * would refuse to start over the variables given, so no deployment ever
 * builds one.
 */
export function localRuntimeOverride(
  variables: Readonly<Record<string, string | undefined>>,
): LocalRuntimeOverride {
  return localServerRefusal(variables) === undefined ? handed : NONE;
}
