import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AppThisMacHost } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { thisMacHostQuery } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

/**
 * machine-name.ts -- This Mac as the host holds it, which every list of the member's machines names it by (`@repo/features/machine-name`).
 *
 * This Mac is the host's: it reads it as it starts and every few seconds
 * after, and lays it on app state where it moved
 * (`LIVE_READ.THIS_MAC_HOST`), so a surface draws it in its first frame and
 * asks nothing. A browser tab has no This Mac, so its host lays none.
 */

/** This Mac as the host holds it for the account signed in; none before the host first reads it, while nobody is signed in, and in a browser tab. */
export function useThisMac(): AppThisMacHost | undefined {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);

  return useQuery(thisMacHostQuery(accountId)).data;
}
