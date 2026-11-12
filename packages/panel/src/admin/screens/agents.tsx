/**
 * agents.tsx -- the Agents screen: the coding agents' runs, failures, and list-price cost by the harness that ran them, Claude Code or Codex.
 *
 * It reads nothing of its own: the Cost and Reliability reads already
 * answer each split by harness, so the page joins the two answers by the
 * harness each names, over the one window both offer. A run is a coding
 * agent's turn, as Reliability counts it; a Start that never got a turn has
 * no harness yet, so it counts on Reliability alone. A worker's tokens count
 * toward its parent agent's harness, since the worker runs inside it.
 */

import type { AdminHarnessReliability } from "@repo/features/admin-answer-wire";
import type { AdminCost, AdminCostHarness } from "@repo/features/admin-cost-wire";
import { ADMIN_RELIABILITY_WINDOWS, type AdminMetricsWindow } from "@repo/features/admin-wire";
import { AGENT_RUNTIME, type AgentRuntime } from "@repo/features/agent-wire";
import { formatCompact, formatCount, formatPercent, formatUsd } from "@repo/features/number-format";
import { readFailedWords } from "@repo/features/words";
import { QuietWords } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { useQuery } from "@tanstack/react-query";
import { useAdminDoors } from "../admin-doors.js";
import { adminAgentsQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { AGENT_FAILURES_SERIES, agentFailureRows } from "../charts/agent-failures.js";
import { BreakdownChart, BreakdownChartSkeleton } from "../charts/breakdown-chart.js";
import { CHART_PAIR_EVEN } from "../charts/chart-frame.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { PageNote } from "../chrome/notes.js";
import { AdminPage, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { reliabilityWindow, windowedReadQuery } from "../routing.js";

const AGENTS_ERROR = readFailedWords("agents");

/** What the page holds, said once over it. */
const AGENTS_NOTE =
  "Coding agents' runs, failures, and list-price cost by the harness that ran them. A run is one turn of an agent's own; a worker's tokens count toward the agent it ran inside.";

/** A harness by name; a conversation from before the column records none. */
const RUNTIME_LABEL = {
  [AGENT_RUNTIME.CLAUDE_CODE]: "Claude Code",
  [AGENT_RUNTIME.CODEX]: "Codex",
  [AGENT_RUNTIME.RETIRED]: "Retired runtime",
} as const satisfies Record<AgentRuntime, string>;

const NO_RUNTIME_LABEL = "Not recorded";

/** How many harnesses the table's skeleton stands a row for: the two live ones. */
const HARNESS_SKELETON_ROWS = 2;

const NO_FIGURE = "—";

/** The two answers the page joins. */
interface AgentsRead {
  cost: AdminCost;
  harnesses: readonly AdminHarnessReliability[];
}

/** One harness's row: its runs and failures where Reliability counted any, and its spend where Cost priced any. */
interface HarnessRow {
  runtime: AgentRuntime | null;
  reliability: AdminHarnessReliability | undefined;
  cost: AdminCostHarness | undefined;
}

function runtimeLabel(runtime: AgentRuntime | null): string {
  return runtime === null ? NO_RUNTIME_LABEL : RUNTIME_LABEL[runtime];
}

/** Every harness either answer names, the most runs first, then the most spent. */
function harnessRows(read: AgentsRead): HarnessRow[] {
  const runtimes = new Set<AgentRuntime | null>([
    ...read.harnesses.map((harness) => harness.runtime),
    ...read.cost.byHarness.map((harness) => harness.runtime),
  ]);
  return [...runtimes]
    .map((runtime) => ({
      runtime,
      reliability: read.harnesses.find((harness) => harness.runtime === runtime),
      cost: read.cost.byHarness.find((harness) => harness.runtime === runtime),
    }))
    .sort(
      (left, right) =>
        (right.reliability?.runs.total ?? 0) - (left.reliability?.runs.total ?? 0) ||
        (right.cost?.spendUsd ?? 0) - (left.cost?.spendUsd ?? 0),
    );
}

function failedShare(row: HarnessRow): number | null {
  const runs = row.reliability?.runs;
  return runs === undefined || runs.total === 0 ? null : runs.failed / runs.total;
}

const HARNESS_COLUMN = {
  HARNESS: "harness",
  RUNS: "runs",
  FAILED: "failed",
  SPEND: "spend",
  PER_RUN: "per-run",
  TOKENS: "tokens",
} as const;

const column = createDataTableColumnHelper<HarnessRow>();

const HARNESS_COLUMNS = column.columns([
  column.display({
    id: HARNESS_COLUMN.HARNESS,
    header: "Harness",
    cell: ({ row: { original: row } }) => runtimeLabel(row.runtime),
  }),
  column.display({
    id: HARNESS_COLUMN.RUNS,
    header: "Runs",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => formatCount(row.reliability?.runs.total ?? 0),
  }),
  column.display({
    id: HARNESS_COLUMN.FAILED,
    header: "Failed",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => formatPercent(failedShare(row), 1),
  }),
  column.display({
    id: HARNESS_COLUMN.SPEND,
    header: "List-price cost",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) =>
      row.cost === undefined || row.cost.spendUsd === null ? (
        <QuietWords>Unpriced</QuietWords>
      ) : (
        formatUsd(row.cost.spendUsd)
      ),
  }),
  column.display({
    id: HARNESS_COLUMN.PER_RUN,
    header: "Per run",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) => {
      const runs = row.reliability?.runs.total ?? 0;
      const spend = row.cost?.spendUsd ?? null;
      return runs === 0 || spend === null ? NO_FIGURE : formatUsd(spend / runs);
    },
  }),
  column.display({
    id: HARNESS_COLUMN.TOKENS,
    header: "Tokens",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: row } }) =>
      formatCompact((row.cost?.pricedTokens ?? 0) + (row.cost?.unpricedTokens ?? 0)),
  }),
]);

const sumRuns = (read: AgentsRead, part: "failed" | "total") =>
  read.harnesses.reduce((total, harness) => total + harness.runs[part], 0);

const sumSpend = (read: AgentsRead) =>
  read.cost.byHarness.reduce((total, harness) => total + (harness.spendUsd ?? 0), 0);

/** The headline cards, in the order they stand. */
const AGENTS_STATS: readonly StatSpec<AgentsRead>[] = [
  {
    key: "runs",
    label: () => "Runs",
    value: (read) => formatCount(sumRuns(read, "total")),
    hint: (read) => `${read.harnesses.length} harnesses ran agents`,
  },
  {
    key: "failed",
    label: () => "Runs failed",
    value: (read) => {
      const total = sumRuns(read, "total");
      return formatPercent(total === 0 ? null : sumRuns(read, "failed") / total, 1);
    },
    hint: (read) => `${formatCount(sumRuns(read, "failed"))} runs`,
  },
  {
    key: "spend",
    label: () => "List-price cost",
    value: (read) => formatUsd(sumSpend(read)),
    hint: (read) => {
      const runs = sumRuns(read, "total");
      return runs === 0 ? "no runs to divide by" : `${formatUsd(sumSpend(read) / runs)} per run`;
    },
  },
];

/**
 * The page's sections, drawn from `read` once both answers are in and as
 * their skeletons until then, so the loading page is this page with bones
 * where the answer lands.
 */
function AgentsSections({ read }: { read: AgentsRead | undefined }): React.JSX.Element {
  const rows = read === undefined ? [] : harnessRows(read);
  return (
    <>
      <AdminSection>
        <PageNote>{AGENTS_NOTE}</PageNote>
        <StatCards layout={STAT_LAYOUT.GROUP} stats={AGENTS_STATS} data={read} />
      </AdminSection>

      <AdminSection title="By harness">
        {read === undefined ? (
          <DataTableSkeleton
            label="Agents by harness"
            columns={HARNESS_COLUMNS}
            rows={HARNESS_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        ) : (
          <DataTable
            label="Agents by harness"
            columns={HARNESS_COLUMNS}
            rows={rows}
            getRowId={(row) => row.runtime ?? NO_RUNTIME_LABEL}
            empty="No coding agent ran in this window."
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        )}
      </AdminSection>

      <AdminSection title="Why runs failed">
        <div className={CHART_PAIR_EVEN}>
          {read === undefined
            ? Object.values(RUNTIME_LABEL)
                .slice(0, HARNESS_SKELETON_ROWS)
                .map((label) => (
                  <BreakdownChartSkeleton
                    key={label}
                    title={label}
                    series={AGENT_FAILURES_SERIES}
                  />
                ))
            : rows
                .filter((row) => row.reliability !== undefined)
                .map((row) => (
                  <BreakdownChart
                    key={row.runtime ?? NO_RUNTIME_LABEL}
                    title={runtimeLabel(row.runtime)}
                    series={AGENT_FAILURES_SERIES}
                    rows={agentFailureRows(row.reliability?.failures ?? [])}
                    empty="No run failed in this window."
                  />
                ))}
        </div>
      </AdminSection>
    </>
  );
}

export function AgentsScreen({
  hideAdmins,
  onHideAdminsChange,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  frame,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  // Note that the page reads both answers over Reliability's windows, the week or the month, so their figures cover the same days.
  const shownWindow = reliabilityWindow(windowDays);
  const query = windowedReadQuery(hideAdmins, shownWindow);
  const read = useQuery({ ...adminAgentsQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const controls = (
    <AdminViewOptions
      windowDays={shownWindow}
      onWindowDaysChange={onWindowDaysChange}
      windows={ADMIN_RELIABILITY_WINDOWS}
      hideAdmins={hideAdmins}
      onHideAdminsChange={onHideAdminsChange}
    />
  );
  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: AGENTS_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title="Agents" note={windowWords(shownWindow)} controls={controls}>
          <AgentsSections read={undefined} />
        </PageSkeleton>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title="Agents" note={windowWords(shownWindow)} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (data, refreshed) =>
      frame(
        <AdminPage title="Agents" note={windowWords(shownWindow)} controls={controls}>
          {refreshed(<AgentsSections read={data} />)}
        </AdminPage>,
      ),
  });
}
