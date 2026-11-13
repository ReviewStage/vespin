/**
 * intro-cards.tsx -- the card a page opens with on its first visit, at the
 * width of a page's column and in a narrow one, where its presses drop
 * under its words; Got it rolls it up as the line under it closes over it,
 * and Show again brings it back.
 */

import {
  BUTTON_VARIANT,
  Button,
  IntroCard,
  RevealArea,
  revealArea,
  TEXT_TONE,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { type ReactNode, useRef, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

const DOCS = "https://vespin.dev/docs/inbox";

/** Opens nothing: the catalog stays offline. */
const stay = (): void => undefined;

/** One card over a line of the page it heads, in a reveal area, with a press that brings it back. */
function Sample({ glyph, children }: { glyph: ReactNode; children: string }): React.JSX.Element {
  const [shown, setShown] = useState(true);
  const area = useRef<HTMLDivElement>(null);

  return (
    <RevealArea root={area}>
      <div ref={area} className="catalog-intro-room" {...revealArea()}>
        <IntroCard
          shown={shown}
          glyph={glyph}
          learnMore={DOCS}
          open={stay}
          onDismiss={() => setShown(false)}
        >
          {children}
        </IntroCard>
        <Text tone={TEXT_TONE.MUTED}>The page's own content starts here.</Text>
        <div>
          <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setShown(true)}>
            Show again
          </Button>
        </div>
      </div>
    </RevealArea>
  );
}

function Cards(): React.JSX.Element {
  return (
    <>
      <Sample glyph={<GLYPH.INBOX />}>
        Agents post here when they need your decision, a to-do done, or your review, and your answer
        goes straight back to them.
      </Sample>
      <Sample glyph={<GLYPH.AUTOMATION />}>
        Automations start agents on a schedule, or when GitHub, Sentry, or a webhook says something
        happened.
      </Sample>
    </>
  );
}

function IntroCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="intro-card-wide" title="A page's column">
        <Cards />
      </CatalogSection>
      <CatalogSection id="intro-card-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <Cards />
        </div>
      </CatalogSection>
    </>
  );
}

export const INTRO_CARDS_EXAMPLE: Example = {
  id: "intro-cards",
  title: "Intro cards",
  Render: IntroCards,
};
