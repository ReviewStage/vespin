import {
  RESOURCE_SORT,
  type ResourceFact,
  type ResourceRow,
  type ResourceSort,
  ResourcesPopover,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * resources-popovers.tsx -- the memory button whose press hangs what the
 * app spends of the Mac: its totals, then each of its processes, a child
 * under the process that started it, sorted by the column a heading chose.
 */

const FACTS: readonly ResourceFact[] = [
  { label: "CPU", value: "158.6%" },
  { label: "Memory", value: "2.8 GB" },
];

const ROWS: readonly ResourceRow[] = [
  { key: "1", name: "Renderer", depth: 0, cpu: "2.3%", memory: "1.1 GB" },
  { key: "2", name: "Host", depth: 0, cpu: "0.4%", memory: "164 MB" },
  { key: "3", name: "claude", depth: 1, cpu: "142.3%", memory: "537 MB" },
  { key: "4", name: "git", depth: 2, cpu: "0.2%", memory: "8.4 MB" },
  { key: "5", name: "Main", depth: 0, cpu: "3.2%", memory: "195 MB" },
  { key: "6", name: "zsh", depth: 1, cpu: "0.0%", memory: "2.1 MB" },
  { key: "7", name: "node", depth: 2, cpu: "10.2%", memory: "42 MB" },
  { key: "8", name: "Network Service", depth: 0, cpu: "0.0%", memory: "14 MB" },
];

/** The popover standing open over its rows, sorted by memory until a heading chooses another. */
function OpenResources(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [sort, setSort] = useState<ResourceSort>(RESOURCE_SORT.MEMORY);

  return (
    <ResourcesPopover
      label="Resources"
      open={open}
      onOpenChange={setOpen}
      facts={FACTS}
      headings={{ name: "Name", cpu: "CPU", memory: "Mem" }}
      sort={sort}
      onSort={setSort}
      rows={ROWS}
      empty="Reading this Mac's processes…"
      copy={{ text: "Renderer 2.3% 1.1 GB", what: "processes", run: async () => undefined }}
    />
  );
}

function ResourcesPopovers(): React.JSX.Element {
  return (
    <CatalogSection id="resources-popover-open" title="Open over the app's processes">
      <div className="catalog-glyph-line">
        <OpenResources />
      </div>
    </CatalogSection>
  );
}

export const RESOURCES_POPOVERS_EXAMPLE: Example = {
  id: "resources-popovers",
  title: "Resources popovers",
  Render: ResourcesPopovers,
};
