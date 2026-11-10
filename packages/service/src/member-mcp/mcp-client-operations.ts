/**
 * mcp-client-operations.ts -- the outside MCP clients a member allowed read, and one revoked, as the hosted procedures and the member MCP tools make them.
 *
 * Each is the one operation its doors run: `mcpClients.list` and
 * `mcpClients.revoke` (`clients-procedures.ts`) for Settings › MCP on the
 * desktop and the web app and for the command-line tool, under the account's
 * OAuth token, and `list_mcp_clients` and `revoke_mcp_client`
 * (`integrations.ts`) for an outside agent acting for a member. A client a member allowed holds their consent
 * and the tokens minted on it, in the OAuth provider's own tables. The read
 * lists the member's consents for every client but the desktop's, and the
 * command-line tool, which skips consent, by the live token it holds,
 * through Drizzle (`oauth-grants.ts`), since every endpoint of the
 * provider's that lists them takes a session. The revoke deletes the
 * client's tokens for the member and then the member's consent, in one
 * transaction, through the same store, since the provider's own
 * `delete-consent` takes a session too: a refresh after it is refused, and
 * the client's next sign-in asks again. A revoke of a client the member
 * never allowed, or of the desktop's or the iPhone's, deletes nothing, and every revoke
 * answers the clients as they then stand.
 */

import { listOAuthGrants, revokeOAuthClient } from "@repo/database/models/oauth-grants";
import type { McpClient, McpClientsAnswer } from "@repo/features/mcp-client-wire";
import { Effect } from "effect";
import { CLI_OAUTH_CLIENT, DESKTOP_OAUTH_CLIENT, IOS_OAUTH_CLIENT } from "../auth/oauth-clients.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";

/** The clients no member revokes here: the desktop's and the iPhone's own, which sign the Mac and the phone in. */
const FIRST_PARTY_CLIENTS: readonly string[] = [DESKTOP_OAUTH_CLIENT.id, IOS_OAUTH_CLIENT.id];

/**
 * The clients that skip consent and are listed by the live token they hold:
 * the command-line tool alone, named rather than every skip-consent client
 * but the desktop's, so a first-party client nobody meant to show never does.
 */
const TOKEN_LISTED_CLIENTS: readonly string[] = [CLI_OAUTH_CLIENT.id];

/** The member's clients as the wire carries them, with the member MCP server's address on this deployment. */
export const mcpClientsRead = Effect.fn("web/mcpClientsRead")(function* (
  userId: string,
  serverUrl: string,
) {
  const grants = yield* hostedStoreOrUnavailable(
    listOAuthGrants(userId, { except: FIRST_PARTY_CLIENTS, tokenOnly: TOKEN_LISTED_CLIENTS }),
  );
  return {
    serverUrl,
    clients: grants.map(
      (grant): McpClient => ({
        clientId: grant.clientId,
        name: grant.name,
        redirectUris: grant.redirectUris,
        allowedAt: grant.allowedAt?.getTime() ?? null,
        lastRefreshedAt: grant.lastRefreshedAt?.getTime() ?? null,
      }),
    ),
  } satisfies McpClientsAnswer;
});

/** The member's tokens and Allow of one client deleted, the desktop's and the iPhone's left as they are, answered with the clients as they then stand. */
export const mcpClientRevoke = Effect.fn("web/mcpClientRevoke")(function* (
  userId: string,
  clientId: string,
  serverUrl: string,
) {
  if (!FIRST_PARTY_CLIENTS.includes(clientId)) {
    yield* hostedStoreOrUnavailable(revokeOAuthClient(userId, clientId));
  }
  return yield* mcpClientsRead(userId, serverUrl);
});
