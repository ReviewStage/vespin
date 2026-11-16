import { CHECK_STATE } from "@repo/features/agent-wire";
import { CheckGlyph, GAP, Inline, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * check-glyphs.tsx -- where a check stands, as one glyph in its standing's
 * ink, each beside the word it stands for: passed, failed, running, and
 * skipped, as a pull request's Checks tab and the Merge queue page lead
 * their rows with it.
 */

const STATES = [
  { state: CHECK_STATE.PASSED, word: "Passed" },
  { state: CHECK_STATE.FAILED, word: "Failed" },
  { state: CHECK_STATE.PENDING, word: "Running" },
  { state: CHECK_STATE.SKIPPED, word: "Skipped" },
] as const;

function CheckGlyphs(): React.JSX.Element {
  return (
    <CatalogSection id="check-glyph" title="A check's glyph for where it stands">
      <Inline gap={GAP.SECTION}>
        {STATES.map(({ state, word }) => (
          <Inline key={state} gap={GAP.ICON}>
            <CheckGlyph state={state} />
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {word}
            </Text>
          </Inline>
        ))}
      </Inline>
    </CatalogSection>
  );
}

export const CHECK_GLYPHS_EXAMPLE: Example = {
  id: "check-glyphs",
  title: "Check glyphs",
  Render: CheckGlyphs,
};
