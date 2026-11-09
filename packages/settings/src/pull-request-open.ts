/**
 * pull-request-open.ts -- where a press on a pull request opens: its Pull request tab in the app, or its page on GitHub.
 *
 * A pull request's chip, its row over an agent's box, and a written link to
 * its page open its agent's Pull request tab, as they always did, unless the
 * account chose GitHub, where they open its page in the browser and their
 * menus offer the tab instead (`@repo/panel`'s `pull-request-opens.ts`).
 * The account's, carried to every Mac and the web.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

/** Where the account opens a pull request. */
export const PULL_REQUEST_OPEN = {
  /** Its agent's Pull request tab: how every pull request opened before the choice. */
  APP: "app",
  /** Its page on GitHub, in the browser. */
  GITHUB: "github",
} as const;

export type PullRequestOpen = (typeof PULL_REQUEST_OPEN)[keyof typeof PULL_REQUEST_OPEN];

/** Every choice, in the order a control offers them. */
export const PULL_REQUEST_OPEN_LIST: readonly PullRequestOpen[] = [
  PULL_REQUEST_OPEN.APP,
  PULL_REQUEST_OPEN.GITHUB,
];

/** The choice an account that never chose reads as. */
export const PULL_REQUEST_OPEN_DEFAULT = PULL_REQUEST_OPEN.APP;

/** How each choice reads on its control. */
export const PULL_REQUEST_OPEN_LABEL = {
  [PULL_REQUEST_OPEN.APP]: PRODUCT_NAME,
  [PULL_REQUEST_OPEN.GITHUB]: "GitHub",
} as const satisfies Record<PullRequestOpen, string>;

const readsPullRequestOpen = Schema.is(Schema.Literals(PULL_REQUEST_OPEN_LIST));

/** Guards a choice arriving from storage or the wire. */
export function isPullRequestOpen(value: UnparsedWireValue): value is PullRequestOpen {
  return readsPullRequestOpen(value);
}
