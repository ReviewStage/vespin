/**
 * integration-account-seams.ts -- the account's integrations' seams over this deployment's real database and clock, for any door that already resolved its caller.
 *
 * The hosted procedures add the bearer resolver beside these
 * (`integration-seams.ts`); the member MCP server, whose caller its token
 * admitted, reads and writes through them alone, so it reaches no auth
 * session of its own.
 */

import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationAccount,
  endIntegrationSignIn,
  fillIntegrationLabel,
  readIntegrationConnections,
  readIntegrationSignIn,
  renameIntegrationConnection,
} from "./integration-store.js";
import type { IntegrationAccountSeams } from "./integrations-app.js";
import { mintIntegrationState, mintIntegrationSubject } from "./integrations-app.js";

/** The real store and clock, without the caller's resolver. */
export function integrationAccountSeams(): IntegrationAccountSeams {
  return {
    readConnections: readIntegrationConnections,
    readSignIn: readIntegrationSignIn,
    beginSignIn: beginIntegrationSignIn,
    completeSignIn: completeIntegrationSignIn,
    endSignIn: endIntegrationSignIn,
    deleteAccount: deleteIntegrationAccount,
    fillLabel: fillIntegrationLabel,
    renameConnection: renameIntegrationConnection,
    mintState: mintIntegrationState,
    mintSubject: mintIntegrationSubject,
    now: () => Date.now(),
  };
}
