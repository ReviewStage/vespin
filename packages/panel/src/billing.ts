/**
 * billing.ts -- a workspace's billing as the panel reads it: whether billing is on, set up, or blocked, and this month's usage, asked of the service through the host.
 *
 * Billing is on or off for every workspace at once, as the service's
 * deployment says, so the Billing page stands only while the status answers
 * that it is on, read at runtime, for a workspace the reader manages; turning
 * billing on needs no client release.
 */

import type { BillingStatusAnswer } from "@repo/features/billing-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { askAct } from "./act.js";
import { QUERY_ROOT } from "./query-keys.js";

/** The workspace's billing, read as a place drawing it opens and on Try again. */
export function billingStatusQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_BILLING, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_BILLING_STATUS, { workspaceId }),
    retry: false,
    // Note that the shared client turns focus refetches off, but a member returns from Stripe's page to this window, so it reads the status again as it regains focus.
    refetchOnWindowFocus: true,
  });
}

/** Whether billing is on, as a status answers it; off until one is read. */
export function billingIsLive(status: BillingStatusAnswer | undefined): boolean {
  return status?.live === true;
}

/**
 * Whether the Billing page stands for the workspace: the reader is an owner
 * or admin of it and the service answers that billing is on. A member never
 * asks, since the service answers a member only a refusal.
 */
export function useBillingShown(workspace: Workspace | undefined): boolean {
  const manages = workspace !== undefined && managesWorkspace(workspace);

  const status = useQuery({
    ...billingStatusQuery(workspace?.id ?? ""),
    enabled: manages,
  });

  return manages && billingIsLive(status.data);
}
