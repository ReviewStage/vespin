import { CAPTION_LEAVE, CaptionField, type CaptionLeave, TEXT_TONE, Text } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * caption-fields.tsx -- a picture's caption typed in place under it: one
 * holding a caption, one empty, whose placeholder shows only while it holds
 * the caret, and one in a narrow column wrapping its words; each says which
 * way a key last left it.
 */

/** What a leave is called, as the example says it. */
const LEFT = {
  [CAPTION_LEAVE.UP]: "Left for the picture above.",
  [CAPTION_LEAVE.DOWN]: "Left for the next line.",
  [CAPTION_LEAVE.NEW_LINE]: "Left for a new line.",
} as const satisfies Record<CaptionLeave, string>;

/** A caption the example holds, saying which way a key last left it. */
function Held({ start }: { start: string }): React.JSX.Element {
  const [words, setWords] = useState(start);
  const [left, setLeft] = useState<string>("Not left yet.");

  return (
    <>
      <CaptionField
        label="Caption"
        placeholder="Write a caption"
        value={words}
        onChange={setWords}
        onLeave={(way) => setLeft(LEFT[way])}
        onEscape={() => setLeft(LEFT[CAPTION_LEAVE.UP])}
      />
      <Text tone={TEXT_TONE.MUTED}>{left}</Text>
    </>
  );
}

function CaptionFields(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="caption-held" title="Holding a caption">
        <Held start="The settings page before the change" />
      </CatalogSection>
      <CatalogSection id="caption-empty" title="Empty, its placeholder shown while focused">
        <Held start="" />
      </CatalogSection>
      <CatalogSection id="caption-narrow" title="Narrow column, wrapping">
        <div className="catalog-narrow">
          <Held start="A long caption that wraps to a second line in a narrow column of the description" />
        </div>
      </CatalogSection>
    </>
  );
}

export const CAPTION_FIELDS_EXAMPLE: Example = {
  id: "caption-fields",
  title: "Caption fields",
  Render: CaptionFields,
};
