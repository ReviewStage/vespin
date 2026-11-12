/**
 * use-integration-tools.ts -- what each connected integration's server answered when asked for its tools, on the phone: the panel's reads (`@repo/panel`'s `integration-tools.ts`) for Settings › Integrations.
 *
 * Each connected server's tools are followed while the page stands
 * (`INTEGRATIONS_TOOLS_FOLLOW`), as the panel holds one query per server,
 * and read off the document the host writes them into. A read stands until
 * the next one answers, so a row doesn't blink back to checking; one our
 * own service couldn't answer reads as unanswered, and Try again asks that
 * server again (`INTEGRATIONS_TOOLS_RETRY`), which stands it back at
 * checking until it answers. What a read means for the row is
 * `@repo/features/integration-health`'s to say.
 */

import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationProviderParams,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollows } from "../host/live-follow.js";

/** The integration server whose tools are read: its provider, and its account where the server isn't the provider's own. */
type IntegrationServer = Pick<IntegrationProviderParams, "provider" | "connection">;

const UNANSWERED: IntegrationToolsView = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

/** The integration server a connection's name stands for, as its tools are followed and asked again; none for a name this build can't read. */
function serverOf(name: string): IntegrationServer | undefined {
  const provider = integrationConnectionOf(name)?.provider;

  if (provider === undefined) return undefined;

  return name === provider ? { provider } : { provider, connection: name };
}

/** Every server's tools read as the host holds it, by its connection's name. */
function selectTools(
  state: AppStateSnapshot,
): AppStateSnapshot[typeof LIVE_READ.INTEGRATION_TOOLS] {
  return state[LIVE_READ.INTEGRATION_TOOLS];
}

/** The reads of the connected servers, and the way to ask one again. */
export interface IntegrationToolReads {
  /** What a server's tools read answered so far; none while it hasn't answered. */
  readonly readOf: (server: string) => IntegrationToolsView | undefined;
  /** Asks one server for its tools again. */
  readonly retry: (server: string) => void;
}

/** The tools read of every server in `connected` (an account by its connection's name, or a provider), followed while the caller is drawn. */
export function useIntegrationTools(connected: readonly string[]): IntegrationToolReads {
  const acts = useHostActs();
  const names = connected.filter((name) => serverOf(name) !== undefined);
  useLiveFollows(names, (name) => {
    const server = serverOf(name);

    return server === undefined
      ? Promise.reject(new Error(`No integration server is named ${name}.`))
      : acts[ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW](server);
  });
  const held = useQuery({ ...appStateQuery, select: selectTools }).data;

  return {
    readOf: (server) => {
      const read = held?.[server];

      if (read?.rows !== undefined) return read.rows;

      return read?.failed === true ? UNANSWERED : undefined;
    },
    retry: (server) => {
      const asked = serverOf(server);

      if (asked === undefined) return;

      void acts[ACT_KIND.INTEGRATIONS_TOOLS_RETRY](asked).catch((cause: unknown) =>
        console.error("Reading the integration's tools again did not go.", cause),
      );
    },
  };
}
