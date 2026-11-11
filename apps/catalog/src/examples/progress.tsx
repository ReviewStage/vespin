/**
 * progress.tsx -- a download's bar under the words that say it in numbers,
 * at its start, part way, and done, a bar of its own named by its label, and
 * one full in the attention ink.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { GAP, PROGRESS_TONE, Progress, Stack, TEXT_TONE, TEXT_VARIANT, Text } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

const SHARES = [0, 42, 100] as const;

function ProgressBars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="progress-beside-words" title="Under the words that say it">
        <Stack gap={GAP.FIELD}>
          {SHARES.map((share) => (
            <Stack key={share} gap={GAP.ICON}>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {`Downloading ${PRODUCT_NAME} 4.2 · ${String(share)}%`}
              </Text>
              <Progress value={share} />
            </Stack>
          ))}
        </Stack>
      </CatalogSection>
      <CatalogSection id="progress-labeled" title="Named by its label">
        <Progress value={64} label="Uploading the recording" />
      </CatalogSection>
      <CatalogSection id="progress-attention" title="Needing a person">
        <Stack gap={GAP.ICON}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            At its limit · back at 3:40 PM
          </Text>
          <Progress value={100} tone={PROGRESS_TONE.ATTENTION} />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const PROGRESS_EXAMPLE: Example = {
  id: "progress",
  title: "Progress",
  Render: ProgressBars,
};
