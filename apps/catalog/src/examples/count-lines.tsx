import { CountLine, STATUS_TONE } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * count-lines.tsx -- a page's counts on one line, as a Manager's overview
 * opens: what waits on the reader inked while anything does, and a line
 * where nothing waits.
 */

function CountLinesExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="count-line-waiting" title="Something waits on the reader">
        <CountLine
          label="At a glance"
          counts={[
            { value: 2, words: "waiting on you", tone: STATUS_TONE.ATTENTION },
            { value: 3, words: "agents working" },
            { value: 2, words: "pull requests open" },
            { value: 5, words: "done this week" },
          ]}
        />
      </CatalogSection>
      <CatalogSection id="count-line-quiet" title="Nothing waits">
        <CountLine
          label="At a glance"
          counts={[
            { value: 0, words: "waiting on you", tone: STATUS_TONE.ATTENTION },
            { value: 0, words: "agents working" },
            { value: 1, words: "pull request open" },
            { value: 12, words: "done this week" },
          ]}
        />
      </CatalogSection>
    </>
  );
}

export const COUNT_LINES_EXAMPLE: Example = {
  id: "count-lines",
  title: "Count lines",
  Render: CountLinesExample,
};
