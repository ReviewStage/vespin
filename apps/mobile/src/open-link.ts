// open-link.ts -- a link the app draws opened where it goes: on the app's own screen where it draws one, and in Safari otherwise.

import {
  type AgentPullRequestLink,
  iosAppRouteOfAddress,
  iosHostConnectCode,
} from "@repo/features/ios-app-links";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectTasks } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import { useRouter } from "expo-router";
import { appStateQuery } from "./host/app-state-query.js";
import { handHostConnect } from "./host-connect-link.js";

/** No pull request of the member's agents read yet. */
const NO_PULL_REQUESTS: readonly AgentPullRequestLink[] = [];

/** The pull requests the member's agents opened, as the document lists them. */
function selectAgentPullRequests(state: AppStateSnapshot): readonly AgentPullRequestLink[] {
  return selectTasks(state).agentPullRequests ?? NO_PULL_REQUESTS;
}

/** Opens an address in Safari, saying on the console where it could not. */
export function openInSafari(address: string): void {
  openURL(address).catch((cause: unknown) => console.error("The address did not open.", cause));
}

/**
 * Opens an address a link, a chip, or a row names: a vespin.dev place the
 * app draws, or a pull request one of the member's agents opened, on the
 * app's own screen (`@repo/features/ios-app-links`); anything else, a pull
 * request's diff among it, in Safari. A machine's pairing link opens
 * Settings › Machines on its code, which asks before anything is sent.
 */
export function useOpenLink(): (address: string) => void {
  const router = useRouter();

  const { data: pullRequests = NO_PULL_REQUESTS } = useQuery({
    ...appStateQuery,
    select: selectAgentPullRequests,
  });

  return (address) => {
    const code = iosHostConnectCode(address);

    if (code !== undefined) {
      handHostConnect(code);

      return;
    }

    const route = iosAppRouteOfAddress(address, pullRequests);

    if (route === undefined) openInSafari(address);
    else router.push(route);
  };
}
