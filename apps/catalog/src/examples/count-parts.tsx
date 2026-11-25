import { ChoiceCount, CountParts, GAP, Inline, linesCount, STATUS_TONE } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * count-parts.tsx -- what an option counts as parts each in its own tone: a
 * pull request's checks as one part, and a diff's lines as the two parts
 * `linesCount` builds, additions in the complete tone and deletions in the
 * danger tone. `ChoiceCount` draws an option's count where the option
 * stands outside a bar, words as one quiet part and parts each in its tone,
 * as a phone's rows standing for a pull request's tabs draw them.
 */

function CountPartsExample(): React.JSX.Element {
  return (
    <CatalogSection id="count-parts" title="One part, and two">
      <Inline gap={GAP.SECTION}>
        <span>
          <CountParts parts={[{ text: "9/9", tone: STATUS_TONE.COMPLETE }]} />
        </span>
        <span>
          <CountParts parts={[{ text: "3/9", tone: STATUS_TONE.ATTENTION }]} />
        </span>
        <span>
          <CountParts parts={[{ text: "12 files" }]} />
        </span>
        <span>
          <CountParts parts={linesCount(120, 34)} />
        </span>
      </Inline>
    </CatalogSection>
  );
}

function ChoiceCountExample(): React.JSX.Element {
  return (
    <CatalogSection id="choice-count" title="An option's count outside its bar">
      <Inline gap={GAP.SECTION}>
        <span>
          <ChoiceCount count="1/4 viewed" />
        </span>
        <span>
          <ChoiceCount count={[{ text: "5", tone: STATUS_TONE.COMPLETE }]} />
        </span>
      </Inline>
    </CatalogSection>
  );
}

function CountPartsExamples(): React.JSX.Element {
  return (
    <>
      <CountPartsExample />
      <ChoiceCountExample />
    </>
  );
}

export const COUNT_PARTS_EXAMPLE: Example = {
  id: "count-parts",
  title: "Count parts",
  Render: CountPartsExamples,
};
