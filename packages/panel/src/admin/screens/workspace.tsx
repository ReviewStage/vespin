/**
 * workspace.tsx -- one workspace's page: what its row in the Workspaces
 * table counts, the GitHub accounts it installed the App on, and every
 * member, each opening their account's page.
 *
 * It is the step between a workspace and the people in it: the Workspaces
 * table and an account's own list of workspaces open it, and each member
 * opens their account, so a maintainer walks either way without searching.
 */

import type {
  AdminBillingMemberUsage,
  AdminWorkspaceBillingMonth,
  AdminWorkspaceDetail,
  AdminWorkspaceMember,
} from "@repo/features/admin-answer-wire";
import { formatCount, formatUsd } from "@repo/features/number-format";
import { githubAccountPageUrl } from "@repo/features/tasks-model";
import { formatDate, formatMonth } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  Badge,
  GAP,
  Inline,
  MARK_PROVIDER,
  QuietWords,
  SKELETON_KIND,
  Skeleton,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminWorkspaceQuery, useAdminSignOut } from "../admin-queries.js";
import { type AdminScreenShell, adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { ExternalLink } from "../chrome/external-links.js";
import { AdminPage, type AdminWayBack } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { ADMIN_PAGE, ADMIN_PAGE_WORDS, ADMIN_TAB, workspaceReadQuery } from "../routing.js";
import { INSTALLATION_LABEL, installationMark } from "../status-words.js";

const WORKSPACE_ERROR = readFailedWords("this workspace");

/** What the page is called until its workspace is read, or where it cannot be. */
const WORKSPACE_TITLE = ADMIN_PAGE_WORDS[ADMIN_PAGE.WORKSPACE];

/** The masthead's line bone, about the created line's width. */
const SKELETON_CREATED_WIDTH = "192px";

/** How many members the table's skeleton stands a row for, about a small team's. */
const MEMBERS_SKELETON_ROWS = 3;

/** The members table's columns by key; a fixed set, so a heading never carries a free string. */
const MEMBER_COLUMN = {
  ACCOUNT: "account",
  ROLE: "role",
  JOINED: "joined",
} as const;

/** The week's work, as the Workspaces table counts it, and how many are in it. */
const WORKSPACE_STATS: readonly StatSpec<AdminWorkspaceDetail>[] = [
  {
    key: "members",
    label: () => "Members",
    value: ({ workspace }) => formatCount(workspace.members),
  },
  {
    key: "tasks",
    label: ({ activityDays }) => `Tasks · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.tasksWeek),
  },
  {
    key: "agents",
    label: ({ activityDays }) => `Agents · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.agentsWeek),
  },
  {
    key: "merged",
    label: ({ activityDays }) => `Pull requests merged · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.prsMergedWeek),
    title: () => "Distinct pull requests from the workspace's agents that merged",
  },
];

/** How many months and members the usage tables' skeletons stand a row for. */
const USAGE_SKELETON_ROWS = 2;

const USAGE_MONTHS_LABEL = "Sandbox usage by month";

const USAGE_MEMBERS_LABEL = "This month's sandbox usage by member";

/** The usage tables' columns by key. */
const USAGE_COLUMN = {
  MONTH: "month",
  MEMBER: "member",
  USAGE: "usage",
  INCLUDED: "included",
  BILLABLE: "billable",
} as const;

/** The current month's figures from the usage ledger, and whether the start gate would refuse the workspace now. */
const USAGE_STATS: readonly StatSpec<AdminWorkspaceDetail>[] = [
  {
    key: "usage",
    label: ({ billing }) => `Sandbox usage · ${formatMonth(billing.currentMonth)}`,
    value: ({ billing }) => formatUsd(billing.months[0]?.usageUsd ?? 0),
    hint: ({ billing }) => `${formatUsd(billing.months[0]?.includedUsd ?? 0)} included`,
  },
  {
    key: "billable",
    label: () => "Would bill",
    value: ({ billing }) => formatUsd(billing.months[0]?.billableUsd ?? 0),
    hint: ({ billing }) =>
      billing.wouldRefuse ? "New cloud agents would be refused" : "New cloud agents start",
  },
];

const monthColumn = createDataTableColumnHelper<AdminWorkspaceBillingMonth>();

const MONTH_COLUMNS = monthColumn.columns([
  monthColumn.display({
    id: USAGE_COLUMN.MONTH,
    header: "Month",
    cell: ({ row: { original: row } }) => formatMonth(row.month),
  }),
  monthColumn.display({
    id: USAGE_COLUMN.USAGE,
    header: "Usage",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => formatUsd(row.usageUsd),
  }),
  monthColumn.display({
    id: USAGE_COLUMN.INCLUDED,
    header: "Included",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => formatUsd(row.includedUsd),
  }),
  monthColumn.display({
    id: USAGE_COLUMN.BILLABLE,
    header: "Would bill",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => formatUsd(row.billableUsd),
  }),
]);

const usageMemberColumn = createDataTableColumnHelper<AdminBillingMemberUsage>();

/** A usage row's member: their account, the usage that was no member's, or an account since deleted. */
function UsageMemberCell({
  row,
  onOpenAccount,
}: {
  row: AdminBillingMemberUsage;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  if (row.account !== null) return <AccountCell account={row.account} onOpen={onOpenAccount} />;

  return <QuietWords>{row.userId === null ? "No member" : "Deleted account"}</QuietWords>;
}

function usageMemberColumns(
  onOpenAccount: (id: string) => void,
): DataTableColumns<AdminBillingMemberUsage> {
  return usageMemberColumn.columns([
    usageMemberColumn.display({
      id: USAGE_COLUMN.MEMBER,
      header: "Member",
      cell: ({ row: { original: row } }) => (
        <UsageMemberCell row={row} onOpenAccount={onOpenAccount} />
      ),
    }),
    usageMemberColumn.display({
      id: USAGE_COLUMN.USAGE,
      header: "Usage",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatUsd(row.usageUsd),
    }),
  ]);
}

const memberColumn = createDataTableColumnHelper<AdminWorkspaceMember>();

function memberColumns(
  onOpenAccount: (id: string) => void,
): DataTableColumns<AdminWorkspaceMember> {
  return memberColumn.columns([
    memberColumn.display({
      id: MEMBER_COLUMN.ACCOUNT,
      header: "Member",
      cell: ({ row: { original: member } }) => (
        <AccountCell account={member.account} onOpen={onOpenAccount} />
      ),
    }),
    memberColumn.display({
      id: MEMBER_COLUMN.ROLE,
      header: "Role",
      cell: ({ row: { original: member } }) => member.role,
    }),
    memberColumn.display({
      id: MEMBER_COLUMN.JOINED,
      header: "Joined",
      cell: ({ row: { original: member } }) => formatDate(member.joinedAt),
    }),
  ]);
}

/** The masthead's frame: the badges line over the created line and the workspace's GitHub accounts. */
function MastheadFrame({
  created,
  links,
}: {
  created: React.ReactNode;
  links: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.TIGHT}>
      {created}
      {links}
    </Stack>
  );
}

/** What the workspace is: whether it is someone's personal one, when it was made, and the GitHub accounts it installed the App on. */
function Masthead({ detail }: { detail: AdminWorkspaceDetail }): React.JSX.Element {
  const { workspace } = detail;

  return (
    <MastheadFrame
      created={
        <Inline>
          {workspace.personal ? <Badge tone={STATUS_TONE.NEUTRAL}>Personal</Badge> : null}
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Created {formatDate(workspace.createdAt)}
            {workspace.installations.length === 0 ? " · GitHub App not installed" : ""}
          </Text>
        </Inline>
      }
      links={
        workspace.installations.length === 0 ? null : (
          <Inline gap={GAP.FIELD}>
            {workspace.installations.map((installation) => (
              <Inline key={installation.login} gap={GAP.ICON}>
                <ExternalLink
                  place={{
                    provider: MARK_PROVIDER.GITHUB,
                    label: installation.login,
                    href: githubAccountPageUrl(installation.login),
                  }}
                />
                <QuietWords mark={installationMark(installation.status)}>
                  {INSTALLATION_LABEL[installation.status]}
                </QuietWords>
              </Inline>
            ))}
          </Inline>
        )
      }
    />
  );
}

/** The masthead while the workspace is read: a bone for its created line. */
function MastheadSkeleton(): React.JSX.Element {
  return (
    <MastheadFrame
      created={
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
          <Skeleton kind={SKELETON_KIND.LINE} width={SKELETON_CREATED_WIDTH} />
        </Text>
      }
      links={null}
    />
  );
}

/** The page's sections, drawn from `detail` once it is read and as their skeletons until then. */
function WorkspaceSections({
  detail,
  onOpenAccount,
}: {
  detail: AdminWorkspaceDetail | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const memberTableColumns = useMemo(() => memberColumns(onOpenAccount), [onOpenAccount]);
  const usageMemberTableColumns = useMemo(() => usageMemberColumns(onOpenAccount), [onOpenAccount]);

  return (
    <>
      {detail === undefined ? <MastheadSkeleton /> : <Masthead detail={detail} />}
      <StatCards layout={STAT_LAYOUT.PAIRS} stats={WORKSPACE_STATS} data={detail} />
      <AdminSection title="Members">
        {detail === undefined ? (
          <DataTableSkeleton
            label="Members"
            columns={memberTableColumns}
            rows={MEMBERS_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [MEMBER_COLUMN.ACCOUNT]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label="Members"
            columns={memberTableColumns}
            rows={detail.members}
            getRowId={(member) => member.account.id}
            empty="No members"
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            onRowPress={(member) => onOpenAccount(member.account.id)}
          />
        )}
      </AdminSection>
      <AdminSection title="Sandbox usage">
        <StatCards layout={STAT_LAYOUT.PAIRS} stats={USAGE_STATS} data={detail} />
        {detail === undefined ? (
          <DataTableSkeleton
            label={USAGE_MONTHS_LABEL}
            columns={MONTH_COLUMNS}
            rows={USAGE_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          />
        ) : (
          <DataTable
            label={USAGE_MONTHS_LABEL}
            columns={MONTH_COLUMNS}
            rows={detail.billing.months}
            getRowId={(row) => row.month}
            empty="No sandbox usage recorded"
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          />
        )}
        {detail === undefined ? (
          <DataTableSkeleton
            label={USAGE_MEMBERS_LABEL}
            columns={usageMemberTableColumns}
            rows={USAGE_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
            cells={{ [USAGE_COLUMN.MEMBER]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label={USAGE_MEMBERS_LABEL}
            columns={usageMemberTableColumns}
            rows={detail.billing.members}
            getRowId={(row) => row.userId ?? ""}
            empty="No sandbox usage this month"
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
            onRowPress={(row) => {
              if (row.account !== null) onOpenAccount(row.account.id);
            }}
          />
        )}
      </AdminSection>
    </>
  );
}

export function WorkspaceScreen({
  id,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  frame,
}: AdminScreenShell & {
  id: string;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const query = workspaceReadQuery(id);
  const read = useQuery({ ...adminWorkspaceQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const back: AdminWayBack = { tab: ADMIN_TAB.WORKSPACES, onBack };

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: WORKSPACE_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={WORKSPACE_TITLE} back={back} controls={null}>
          <WorkspaceSections detail={undefined} onOpenAccount={onOpenAccount} />
        </PageSkeleton>,
      ),
    missing: () =>
      frame(
        <AdminPage title={WORKSPACE_TITLE} back={back} controls={null}>
          <NotFound thing={NOT_FOUND_THING.WORKSPACE} />
        </AdminPage>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={WORKSPACE_TITLE} back={back} controls={null}>
          {error}
        </AdminPage>,
      ),
    ready: (detail, refreshed) =>
      frame(
        <AdminPage title={detail.workspace.name} back={back} controls={null}>
          {refreshed(<WorkspaceSections detail={detail} onOpenAccount={onOpenAccount} />)}
        </AdminPage>,
      ),
  });
}
