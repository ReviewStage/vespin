/**
 * billing.tsx -- the Billing screen: each workspace's sandbox usage in a UTC month, and what it would be billed past the allowance.
 *
 * The figures are the usage ledger's (`admin-billing-wire.ts`), the rows the
 * start gate reads, so the screen answers while billing is switched off and
 * before the invoicing provider is connected. Only admins read it; members
 * see none of it.
 */

import type { AdminBilling, AdminBillingWorkspace } from "@repo/features/admin-billing-wire";
import { formatCount, formatUsd } from "@repo/features/number-format";
import { formatMonth } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import { Badge, GAP, Inline, QuietWords, STATUS_TONE, TEXT_TONE, Text } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAdminDoors } from "../admin-doors.js";
import { adminBillingQuery, useAdminSignOut } from "../admin-queries.js";
import { type AdminScreenShell, adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions } from "../chrome/controls.js";
import { PageNote } from "../chrome/notes.js";
import { AdminPage } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { billingReadQuery } from "../routing.js";
import { WorkspaceCell } from "../workspace-cell.js";

const BILLING_ERROR = readFailedWords("billing");

const BILLING_TITLE = "Billing";

/** What every figure on the screen is, said once at the top of the page. */
const BILLING_DESCRIPTION =
  "Each workspace's sandbox usage from the usage ledger, at what Vercel charges us, and what it would be billed past its monthly allowance. Nothing here is charged while billing is switched off.";

/** How many workspaces the table's skeleton stands a row for. */
const WORKSPACE_SKELETON_ROWS = 5;

const WORKSPACES_LABEL = "Workspaces by sandbox usage";

/** The table's column keys. */
const WORKSPACE_COLUMN = {
  WORKSPACE: "workspace",
  USAGE: "usage",
  INCLUDED: "included",
  BILLABLE: "billable",
  GATE: "gate",
} as const;

/** The headline cards, in the order they stand. */
const BILLING_STATS: readonly StatSpec<AdminBilling>[] = [
  {
    key: "usage",
    label: () => "Sandbox usage",
    value: (billing) => formatUsd(billing.totals.usageUsd),
    hint: (billing) => `${formatCount(billing.workspaces.length)} workspaces with usage`,
  },
  {
    key: "billable",
    label: () => "Would bill",
    value: (billing) => formatUsd(billing.totals.billableUsd),
    hint: (billing) => `each workspace's usage past its ${formatUsd(billing.includedUsd)}`,
  },
  {
    key: "over",
    label: (billing) => `Workspaces over ${formatUsd(billing.includedUsd)}`,
    value: (billing) => formatCount(billing.totals.workspacesOver),
  },
];

const workspaceColumn = createDataTableColumnHelper<AdminBillingWorkspace>();

function workspaceColumns(
  onOpenWorkspace: (id: string) => void,
): DataTableColumns<AdminBillingWorkspace> {
  return workspaceColumn.columns([
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.WORKSPACE,
      header: "Workspace",
      cell: ({ row: { original: row } }) => (
        <Inline gap={GAP.ICON}>
          <WorkspaceCell workspace={row} onOpen={onOpenWorkspace} />
          {row.personal ? <Badge tone={STATUS_TONE.NEUTRAL}>Personal</Badge> : null}
        </Inline>
      ),
    }),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.USAGE,
      header: "Usage",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatUsd(row.usageUsd),
    }),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.INCLUDED,
      header: "Included",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatUsd(row.includedUsd),
    }),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.BILLABLE,
      header: "Would bill",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatUsd(row.billableUsd),
    }),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.GATE,
      header: "Cloud starts",
      cell: ({ row: { original: row } }) =>
        row.wouldRefuse ? (
          <Badge tone={STATUS_TONE.DANGER}>Would refuse</Badge>
        ) : (
          <QuietWords>Allowed</QuietWords>
        ),
    }),
  ]);
}

/** What the gate column means, under the table. */
function GateNote(): React.JSX.Element {
  return (
    <Text tone={TEXT_TONE.MUTED}>
      Cloud starts says whether the gate would refuse the workspace a new cloud agent now: past its
      allowance this month with no billing set up. No workspace can set billing up yet, and a past
      month refuses nothing. The ledger is written once a day, so this month's figures trail by up
      to a day.
    </Text>
  );
}

/** The screen's sections, drawn from `billing` once it is read and as their skeletons until then. */
function BillingSections({
  billing,
  onOpenWorkspace,
}: {
  billing: AdminBilling | undefined;
  onOpenWorkspace: (id: string) => void;
}): React.JSX.Element {
  const columns = useMemo(() => workspaceColumns(onOpenWorkspace), [onOpenWorkspace]);

  return (
    <>
      <AdminSection>
        <PageNote>{BILLING_DESCRIPTION}</PageNote>
        <StatCards layout={STAT_LAYOUT.GROUP} stats={BILLING_STATS} data={billing} />
      </AdminSection>

      <AdminSection title={WORKSPACES_LABEL}>
        {billing === undefined ? (
          <DataTableSkeleton
            label={WORKSPACES_LABEL}
            columns={columns}
            rows={WORKSPACE_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        ) : (
          <>
            <DataTable
              label={WORKSPACES_LABEL}
              columns={columns}
              rows={billing.workspaces}
              getRowId={(row) => row.id}
              empty="No sandbox usage recorded in this month."
              minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
              onRowPress={(row) => onOpenWorkspace(row.id)}
            />
            <GateNote />
          </>
        )}
      </AdminSection>
    </>
  );
}

export function BillingScreen({
  account,
  onSignOut,
  onOpenWorkspace,
  frame,
}: AdminScreenShell & { onOpenWorkspace: (id: string) => void }): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  // Note that no month chosen reads the current one, which the service names, since a client's clock may disagree on the month.
  const [month, setMonth] = useState<string | undefined>(undefined);

  const read = useQuery({
    ...adminBillingQuery(reads, billingReadQuery(month)),
    enabled: !gate.heldAtGate(),
  });

  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const answered = read.data;

  const controls =
    answered === undefined ? null : (
      <AdminViewOptions month={answered.month} months={answered.months} onMonthChange={setMonth} />
    );

  const note = answered === undefined ? undefined : formatMonth(answered.month);

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: BILLING_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={BILLING_TITLE} note={note} controls={controls}>
          <BillingSections billing={undefined} onOpenWorkspace={onOpenWorkspace} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={BILLING_TITLE} note={note} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (billing, refreshed) =>
      frame(
        <AdminPage title={BILLING_TITLE} note={formatMonth(billing.month)} controls={controls}>
          {refreshed(<BillingSections billing={billing} onOpenWorkspace={onOpenWorkspace} />)}
        </AdminPage>,
      ),
  });
}
