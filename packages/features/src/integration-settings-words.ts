/**
 * integration-settings-words.ts -- what Settings › Integrations says of the account's integrations, on its rows, in its acts, and when one did not go, on the desktop, the web, and the iOS app alike.
 */

import type { SignIn } from "./integration-sign-in.js";
import { SIGN_IN_ACTION } from "./integration-sign-in.js";
import {
  INTEGRATION_NAME,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "./integration-wire.js";
import { VERB } from "./words.js";

/** What the page says while it cannot read its integrations, where none is offered, and what its search asks for. */
export const INTEGRATIONS_PAGE_WORDS = {
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations available",
  SEARCH: "Search integrations",
  /** Where the search finds nothing, quoting what it looked for. */
  NO_MATCH: (query: string) => `No integrations match “${query.trim()}”`,
} as const;

/** What a row says on its line, and what it offers, fixed by the build. */
export const INTEGRATION_ROW_WORDS = {
  CHECKING: "Checking…",
  NOT_OPENED: "Your browser could not be opened to sign in. Try again.",
  GITHUB_SIGN_IN: "Uses your GitHub sign-in",
  CONNECT: "Connect",
  RECONNECT: VERB.RECONNECT,
  DISCONNECT: "Disconnect",
  ADD_ACCOUNT: "Add another account",
  RENAME: "Rename",
} as const;

/** What a row says under it where one of its acts did not go, naming the server. */
export const INTEGRATION_REFUSED = {
  CONNECT: (name: string) => `${name} could not be connected. Try again.`,
  DISCONNECT: (name: string) => `${name} could not be disconnected. Try again.`,
  CANCEL: (name: string) => `The sign-in to ${name} could not be canceled. Try again.`,
  RENAME: (name: string) => `${name} could not be renamed. Try again.`,
} as const;

/**
 * What a row's grant button says: Reconnect over a connection that broke,
 * GitHub's included, else Try again after a sign-in that did not connect,
 * else Connect or Reconnect.
 */
export function grantLabel(
  status: IntegrationStatus | undefined,
  signIn: SignIn | undefined,
): string {
  if (status === INTEGRATION_STATUS.CONNECTED) return INTEGRATION_ROW_WORDS.RECONNECT;

  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;

  return status === INTEGRATION_STATUS.EXPIRED
    ? INTEGRATION_ROW_WORDS.RECONNECT
    : INTEGRATION_ROW_WORDS.CONNECT;
}

/**
 * What Disconnect asks of the server called `name` at `provider`: agents
 * lose the provider, or this one account where the account holds others
 * there (`several`), or GitHub where the server rides the account's GitHub
 * sign-in (`bySignIn`).
 */
export function disconnectQuestion(
  name: string,
  provider: IntegrationProvider,
  { bySignIn, several }: { readonly bySignIn: boolean; readonly several: boolean },
) {
  const providerName = INTEGRATION_NAME[provider];

  return {
    title: `Disconnect ${name}?`,
    body: bySignIn
      ? "Agents lose GitHub until you connect it again."
      : several
        ? `Agents lose this account. Your other ${providerName} accounts stay connected.`
        : `Agents lose ${providerName} until you connect it again.`,
    verb: `Disconnect ${providerName}`,
    running: "Disconnecting",
  } as const;
}
