/**
 * pull-request-opens.ts -- whether a press on a pull request opens its page on GitHub rather than its agent's Pull request tab, as the account chose.
 *
 * The account's choice (`@repo/settings`'s `PULL_REQUEST_OPEN`, Settings ›
 * Account › Links) is read here for every press on a pull request: its row
 * over an agent's box (`agent-published.tsx`), its chip on a row
 * (`pull-request-chip.tsx`), and a written link to its page
 * (`use-open-link.ts`). With GitHub chosen, each opens the page in the
 * browser, and the menus that offered Open on GitHub offer the tab instead.
 * Until the first document arrives, and signed out, a pull request opens in
 * its tab, as it always did.
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import { PULL_REQUEST_OPEN } from "@repo/settings";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { appStateIn, appStateQuery, selectAppSettingsView } from "../use-app-state.js";

/** Whether the account chose to open pull requests on GitHub. */
const selectPullRequestsOnGitHub = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.pullRequestOpen === PULL_REQUEST_OPEN.GITHUB;

/** Whether a press on a pull request opens its page on GitHub, redrawn as the choice moves. */
export function usePullRequestsOnGitHub(): boolean {
  return useQuery({ ...appStateQuery, select: selectPullRequestsOnGitHub }).data === true;
}

/** Whether a press on a pull request opens its page on GitHub, read as the press lands, for a callback that cannot wait a render. */
export function pullRequestsOnGitHubNow(client: QueryClient): boolean {
  const state = appStateIn(client);
  return state !== undefined && selectPullRequestsOnGitHub(state);
}
