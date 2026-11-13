/**
 * tools.tsx -- the Tools screen: our own tools as a coding agent is offered them, each with its definition's size and whether it loads on the first turn or only on search.
 *
 * Every figure is the deploy's code (the catalog read), never use: a tool
 * listed from the first turn costs its definition on every turn, so its size
 * is what an agent pays for it whether or not it calls it.
 */

import {
  ADMIN_TOOL_LOADING,
  type AdminCatalog,
  type AdminCatalogTool,
  type AdminToolLoading,
} from "@repo/features/admin-catalog-wire";
import { formatCount } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { QuietWords, TEXT_FONT, Text } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { PageNote } from "../chrome/notes.js";
import type { ViewerAccount } from "../chrome/page-header.js";
import {
  type CatalogDetail,
  CatalogDetailDialog,
  CatalogPage,
  useCatalogDetail,
} from "./catalog-page.js";

/** What the page holds, said once over it. */
const TOOLS_NOTE = `${PRODUCT_NAME}'s own tools as a coding agent is offered them, in the order its tool list names them; press one for what the agent is told. A tool loaded on the first turn costs its definition on every turn; one found on search costs a search step the first time it is called. A gated tool is offered only where its gate opens.`;

/** What the tools table is titled and named by. */
const TOOLS_TITLE = `${PRODUCT_NAME}'s tools`;

const LOADING_LABEL = {
  [ADMIN_TOOL_LOADING.FIRST_TURN]: "First turn",
  [ADMIN_TOOL_LOADING.SEARCH]: "On search",
} as const satisfies Record<AdminToolLoading, string>;

/** How many rows the table's skeleton stands. */
const SKELETON_ROWS = 8;

const characters = (count: number) => `${formatCount(count)} characters`;

const firstTurn = (tools: readonly AdminCatalogTool[]) =>
  tools.filter((tool) => tool.loading === ADMIN_TOOL_LOADING.FIRST_TURN);

const definitionChars = (tools: readonly AdminCatalogTool[]) =>
  tools.reduce((total, tool) => total + tool.definitionChars, 0);

const column = createDataTableColumnHelper<AdminCatalogTool>();

const TOOL_COLUMNS = column.columns([
  column.display({
    id: "name",
    header: "Tool",
    cell: ({ row: { original: tool } }) => <Text font={TEXT_FONT.MONO}>{tool.name}</Text>,
  }),
  column.display({
    id: "loading",
    header: "Loads",
    cell: ({ row: { original: tool } }) => LOADING_LABEL[tool.loading],
  }),
  column.display({
    id: "gate",
    header: "Gate",
    cell: ({ row: { original: tool } }) =>
      tool.gate === null ? <QuietWords>Every agent</QuietWords> : tool.gate,
  }),
  column.display({
    id: "definition",
    header: "Definition",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: tool } }) => characters(tool.definitionChars),
  }),
]);

/** The headline cards, in the order they stand. */
const TOOL_STATS: readonly StatSpec<AdminCatalog>[] = [
  {
    key: "tools",
    label: () => "Tools",
    value: (catalog) => formatCount(catalog.tools.length),
    hint: (catalog) => `${characters(definitionChars(catalog.tools))} in all`,
  },
  {
    key: "first-turn",
    label: () => "Loaded on the first turn",
    value: (catalog) => formatCount(firstTurn(catalog.tools).length),
    // Note that we say "up to", because a gated tool among them is offered only where its gate opens.
    hint: (catalog) =>
      `up to ${characters(definitionChars(firstTurn(catalog.tools)))} on every turn`,
  },
];

/** A tool's detail as its dialog shows it: where it loads, its gate, its size, then what the agent is told. */
function toolDetail(tool: AdminCatalogTool): CatalogDetail {
  return {
    title: tool.name,
    facts: [
      { label: "Loads", value: LOADING_LABEL[tool.loading] },
      { label: "Gate", value: tool.gate ?? "Every agent" },
      { label: "Definition", value: characters(tool.definitionChars) },
    ],
    prose: tool.description,
    blocks: [{ title: "Input schema", code: tool.inputSchema }],
  };
}

function ToolSections({ catalog }: { catalog: AdminCatalog | undefined }): React.JSX.Element {
  const detail = useCatalogDetail<AdminCatalogTool>();

  return (
    <>
      <AdminSection>
        <PageNote>{TOOLS_NOTE}</PageNote>
        <StatCards layout={STAT_LAYOUT.GROUP} stats={TOOL_STATS} data={catalog} />
      </AdminSection>

      <AdminSection title={TOOLS_TITLE}>
        {catalog === undefined ? (
          <DataTableSkeleton
            label={TOOLS_TITLE}
            columns={TOOL_COLUMNS}
            rows={SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        ) : (
          <DataTable
            label={TOOLS_TITLE}
            columns={TOOL_COLUMNS}
            rows={catalog.tools}
            getRowId={(tool) => tool.name}
            onRowPress={detail.show}
            empty="This deploy offers no tools."
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        )}
      </AdminSection>

      <CatalogDetailDialog
        detail={detail.shown === undefined ? undefined : toolDetail(detail.shown)}
        open={detail.open}
        onClose={detail.close}
        onExited={detail.exited}
      />
    </>
  );
}

export function ToolsScreen({
  account,
  onSignOut,
  frame,
}: {
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <CatalogPage
      title="Tools"
      account={account}
      onSignOut={onSignOut}
      frame={frame}
      sections={(catalog) => <ToolSections catalog={catalog} />}
    />
  );
}
