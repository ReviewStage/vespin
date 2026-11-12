/**
 * mcp-clients-words.ts -- what Settings says of the apps the account allowed to use the service over MCP: their names, where each signs in from, and Disconnect, on the desktop, the web, and the iOS app alike.
 */

import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "./mcp-client-wire.js";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "./oauth-client-ids.js";
import { ON_THIS_COMPUTER, oauthRedirectDestination } from "./oauth-consent.js";
import { PRODUCT_NAME } from "./product-name.js";

/** What the section and its rows say. */
export const MCP_CLIENTS_WORDS = {
  TITLE: "MCP",
  CAPTION: `Use ${PRODUCT_NAME} from Claude Code, Cursor, ChatGPT, and other AI apps.`,
  READ_FAILED: "The connected apps could not be read.",
  NONE: "No apps connected yet.",
  UNNAMED: "Unnamed app",
  DISCONNECT: "Disconnect",
  REVOKED: `Disconnected. Its access ends within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
  THIS_COMPUTER: "This computer",
} as const;

/** An app's name as it registered it, or the page's own words for one that gave none. */
export function mcpClientName(client: McpClient): string {
  return client.name ?? MCP_CLIENTS_WORDS.UNNAMED;
}

/**
 * Where an app's sign-in returns to, each place once: the host the consent
 * page named, or This computer where it named an app on this computer, since
 * the row's line opens on it as a bare fact.
 */
export function mcpClientDestinations(client: McpClient): string {
  const places = new Set(client.redirectUris.map(oauthRedirectDestination));

  return [...places]
    .map((place) => (place === ON_THIS_COMPUTER ? MCP_CLIENTS_WORDS.THIS_COMPUTER : place))
    .join(", ");
}

/** What Disconnect asks of the app called `name`. */
export function mcpClientRevokeQuestion(name: string) {
  return {
    title: `Disconnect ${name}?`,
    body: `${name} can no longer use your ${PRODUCT_NAME} account. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
    verb: "Disconnect agent",
    running: "Disconnecting",
  } as const;
}

/** What a Disconnect that did not go says of the app called `name`. */
export function mcpClientRevokeRefused(name: string): string {
  return `Revoking ${name} didn't finish. Try again.`;
}

/** The apps the account allowed, never the `vespin` command, whose own Sign in section signs it out. */
export function listedMcpClients(clients: readonly McpClient[]): readonly McpClient[] {
  return clients.filter((client) => client.clientId !== FIRST_PARTY_OAUTH_CLIENT_ID.CLI);
}
