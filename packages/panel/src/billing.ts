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
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { askAct } from "./act.js";
import { QUERY_ROOT } from "./query-keys.js";
import { useTaskWorkspaceOf } from "./tasks/use-task-relation-writes.js";

/** The workspace's billing, read as a place drawing it opens and on Try again. */
export function billingStatusQuery(workspaceId: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_BILLING, workspaceId],
    queryFn: () => askAct(ACT_KIND.WORKSPACE_BILLING_STATUS, { workspaceId }),
    retry: false,
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

/**
 * Opens Stripe's page for the workspace a task belongs to, as a refused
 * cloud Start's press does: Checkout to set billing up, or the Customer
 * Portal to manage it. Where the host could not open it, or the task's
 * workspace is not held, Settings › Billing opens instead, which says why
 * and offers the same press.
 */
export function useOpenTaskBilling(
  onOpenSettings: (link: SettingsLink) => void,
): (taskId: string, manage: boolean) => void {
  const workspaceOf = useTaskWorkspaceOf();

  return useCallback(
    (taskId: string, manage: boolean) => {
      const workspaceId = workspaceOf(taskId);

      const settings = () =>
        onOpenSettings({
          page: SETTINGS_VIEW.BILLING,
          ...(workspaceId === undefined ? undefined : { workspaceId }),
        });

      if (workspaceId === undefined) return settings();

      const kind = manage ? ACT_KIND.WORKSPACE_BILLING_PORTAL : ACT_KIND.WORKSPACE_BILLING_SETUP;

      void askAct(kind, { workspaceId }).catch(settings);
    },
    [workspaceOf, onOpenSettings],
  );
}
