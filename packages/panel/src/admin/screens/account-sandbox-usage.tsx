/**
 * account-sandbox-usage.tsx -- an account's page's sandbox usage this UTC month, by the workspace each sandbox was charged to, each opening its workspace's page.
 *
 * Read from the usage ledger, as the Billing screen is: a workspace the
 * account has since left still stands here for what its sandboxes used.
 */

import type {
  AdminAccountSandboxUsage,
  AdminAccountWorkspaceUsage,
} from "@repo/features/admin-answer-wire";
import { formatUsd } from "@repo/features/number-format";
import { Badge, GAP, Inline, STATUS_TONE } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { useMemo } from "react";
import { AdminSection } from "../charts/stat-card.js";
import { WorkspaceCell } from "../workspace-cell.js";

/** The section's heading, loading or loaded alike: the month is the current UTC one. */
const USAGE_TITLE = "Sandbox usage this month";

/** How many workspaces the table's skeleton stands a row for, about an account's few. */
const USAGE_SKELETON_ROWS = 2;

const USAGE_COLUMN = { WORKSPACE: "workspace", USAGE: "usage" } as const;

const usageColumn = createDataTableColumnHelper<AdminAccountWorkspaceUsage>();

function usageColumns(
  onOpenWorkspace: (id: string) => void,
): DataTableColumns<AdminAccountWorkspaceUsage> {
  return usageColumn.columns([
    usageColumn.display({
      id: USAGE_COLUMN.WORKSPACE,
      header: "Workspace",
      cell: ({ row: { original: row } }) => (
        <Inline gap={GAP.ICON}>
          <WorkspaceCell workspace={row} onOpen={onOpenWorkspace} />
          {row.personal ? <Badge tone={STATUS_TONE.NEUTRAL}>Personal</Badge> : null}
        </Inline>
      ),
    }),
    usageColumn.display({
      id: USAGE_COLUMN.USAGE,
      header: "Usage",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatUsd(row.usageUsd),
    }),
  ]);
}

/** The section, drawn from `usage` once it is read and as its skeleton until then. */
export function AccountSandboxUsageSection({
  usage,
  onOpenWorkspace,
}: {
  usage: AdminAccountSandboxUsage | undefined;
  onOpenWorkspace: (id: string) => void;
}): React.JSX.Element {
  const columns = useMemo(() => usageColumns(onOpenWorkspace), [onOpenWorkspace]);

  return (
    <AdminSection title={USAGE_TITLE}>
      {usage === undefined ? (
        <DataTableSkeleton
          label={USAGE_TITLE}
          columns={columns}
          rows={USAGE_SKELETON_ROWS}
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
        />
      ) : (
        <DataTable
          label={USAGE_TITLE}
          columns={columns}
          rows={usage.workspaces}
          getRowId={(row) => row.id}
          empty="No sandbox usage this month"
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          onRowPress={(row) => onOpenWorkspace(row.id)}
        />
      )}
    </AdminSection>
  );
}
