/**
 * prompts.tsx -- the Prompts screen: the prompts this deploy hands a model, each with its size and its sections' sizes.
 *
 * Every figure is the deploy's code (the catalog read). The coding agent's
 * instructions are measured as a sandbox agent on a repository is handed
 * them, every workspace experiment off and a placeholder repository and task
 * in place of a member's, so the size is the template's. Prompts stay in git
 * and go through review; nothing here edits one.
 */

import type {
  AdminCatalog,
  AdminCatalogPrompt,
  AdminPromptSection,
} from "@repo/features/admin-catalog-wire";
import { formatCount } from "@repo/features/number-format";
import { QuietWords, TEXT_FONT, Text } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { AdminSection } from "../charts/stat-card.js";
import { PageNote } from "../chrome/notes.js";
import type { ViewerAccount } from "../chrome/page-header.js";
import { CatalogPage } from "./catalog-page.js";

/** What the page holds, said once over it. */
const PROMPTS_NOTE =
  "The prompts this deploy hands a model, read from the code that holds them. The coding agent's are measured for a sandbox agent on a repository with every workspace experiment off. Prompts a module keeps private, such as the title writer's, are not listed.";

/** How many rows the table's skeleton stands. */
const SKELETON_ROWS = 4;

const characters = (count: number) => `${formatCount(count)} characters`;

/** What a prompt's text before its first heading is called. */
const PREAMBLE_LABEL = "Before the first heading";

const promptColumn = createDataTableColumnHelper<AdminCatalogPrompt>();

const PROMPT_COLUMNS = promptColumn.columns([
  promptColumn.display({
    id: "prompt",
    header: "Prompt",
    cell: ({ row: { original: prompt } }) => prompt.label,
  }),
  promptColumn.display({
    id: "source",
    header: "Source",
    cell: ({ row: { original: prompt } }) => <Text font={TEXT_FONT.MONO}>{prompt.source}</Text>,
  }),
  promptColumn.display({
    id: "sections",
    header: "Sections",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: prompt } }) => formatCount(prompt.sections.length),
  }),
  promptColumn.display({
    id: "size",
    header: "Size",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: prompt } }) => characters(prompt.chars),
  }),
]);

const sectionColumn = createDataTableColumnHelper<AdminPromptSection>();

const SECTION_COLUMNS = sectionColumn.columns([
  sectionColumn.display({
    id: "heading",
    header: "Section",
    cell: ({ row: { original: section } }) =>
      section.heading ?? <QuietWords>{PREAMBLE_LABEL}</QuietWords>,
  }),
  sectionColumn.display({
    id: "size",
    header: "Size",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: section } }) => characters(section.chars),
  }),
]);

function PromptSections({ catalog }: { catalog: AdminCatalog | undefined }): React.JSX.Element {
  return (
    <>
      <AdminSection>
        <PageNote>{PROMPTS_NOTE}</PageNote>
        {catalog === undefined ? (
          <DataTableSkeleton
            label="Prompts"
            columns={PROMPT_COLUMNS}
            rows={SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        ) : (
          <DataTable
            label="Prompts"
            columns={PROMPT_COLUMNS}
            rows={catalog.prompts}
            getRowId={(prompt) => prompt.label}
            empty="This deploy lists no prompts."
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          />
        )}
      </AdminSection>

      {catalog?.prompts
        .filter((prompt) => prompt.sections.length > 1)
        .map((prompt) => (
          <AdminSection key={prompt.label} title={prompt.label}>
            <DataTable
              label={`${prompt.label} by section`}
              columns={SECTION_COLUMNS}
              rows={prompt.sections}
              getRowId={(section) => section.heading ?? PREAMBLE_LABEL}
              empty="No sections."
              minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            />
          </AdminSection>
        ))}
    </>
  );
}

export function PromptsScreen({
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
      title="Prompts"
      account={account}
      onSignOut={onSignOut}
      frame={frame}
      sections={(catalog) => <PromptSections catalog={catalog} />}
    />
  );
}
