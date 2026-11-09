import { ListRow, SplitBar, type SplitBarMore } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * split-bars.tsx -- one bar split into equal segments: two and three that
 * fit, six that fold into "3 more" at a pane's width and into "5 more" on a
 * phone's, the folded segment's press listing the rest.
 */

interface Change {
  readonly id: string;
  readonly title: string;
}

const CHANGES: readonly Change[] = [
  { id: "1201", title: "Batch the turn reads" },
  { id: "1202", title: "Read a delivery's agents in one statement" },
  { id: "1203", title: "Split the pull request bar" },
  { id: "1204", title: "Keep pictures in batched statements" },
  { id: "1205", title: "One door for the turn reads" },
  { id: "1206", title: "Index the turn reads" },
];

const MORE: SplitBarMore<Change> = {
  icon: <GLYPH.PULL_REQUEST aria-hidden="true" />,
  words: (count) => `${count} more`,
  label: "Other changes",
  entries: (folded) =>
    folded.map((change) => ({
      key: change.id,
      label: `#${change.id} ${change.title}`,
      onSelect: () => undefined,
    })),
};

/** The bar of `count` changes, `width` wide. */
function Changes({ count, width }: { count: number; width: string }): React.JSX.Element {
  return (
    <div style={{ width }}>
      <SplitBar
        label="Change"
        items={CHANGES.slice(0, count)}
        keyOf={(change) => change.id}
        roomy={18}
        more={MORE}
        segment={(change) => (
          <ListRow
            leading={<GLYPH.PULL_REQUEST aria-hidden="true" />}
            title={`#${change.id} ${change.title}`}
            onPress={() => undefined}
          />
        )}
      />
    </div>
  );
}

function SplitBars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="split-bar-two" title="Two that fit">
        <Changes count={2} width="40rem" />
      </CatalogSection>
      <CatalogSection id="split-bar-three" title="Three that fit">
        <Changes count={3} width="40rem" />
      </CatalogSection>
      <CatalogSection id="split-bar-folded" title="Six folded at a pane's width">
        <Changes count={6} width="40rem" />
      </CatalogSection>
      <CatalogSection id="split-bar-phone" title="Six folded at a phone's width">
        <Changes count={6} width="21rem" />
      </CatalogSection>
    </>
  );
}

export const SPLIT_BARS_EXAMPLE: Example = {
  id: "split-bars",
  title: "Split bars",
  Render: SplitBars,
};
