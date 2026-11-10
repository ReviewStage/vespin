import type { CallCredential } from "./account-call.js";
import { hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import { MCP_CLIENT_QUERY } from "./mcp-client-wire.js";

/**
 * mcp-clients-client.ts -- the outside MCP clients the account allowed, as the host asks the service for them and revokes one.
 *
 * Both calls are procedures of the hosted contract (`contract/mcp-clients.ts`)
 * over the account call (`hosted-link.ts`), both carrying the account's
 * credential. Each answers the clients as the
 * service then holds them or why there is no answer (`hostedCall`), never a
 * failure, since every caller does the same with one: says so, and offers
 * it again.
 */

export interface HostedMcpClientsClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

export class HostedMcpClientsClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedMcpClientsClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The clients the account allowed, newest allowed first, with the server's address. */
  list() {
    return hostedCall(this.#hosted.mcpClients.list, undefined);
  }

  /** One client revoked, answering the clients as they then stand; the client rides in the query, since a DELETE carries no body. */
  revoke(clientId: string) {
    return hostedCall(this.#hosted.mcpClients.revoke, {
      query: { [MCP_CLIENT_QUERY.CLIENT_ID]: clientId },
    });
  }
}
