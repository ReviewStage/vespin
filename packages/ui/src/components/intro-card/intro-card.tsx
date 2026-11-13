/**
 * intro-card.tsx -- the card a page opens with the first time an account visits it: one sentence on what the page is for, Learn more, and Got it.
 *
 * It is a banner's card (`Banner`, `BANNER_LOOK.CARD`) in the neutral tone,
 * its glyph the one the page already wears where it is named (a sidebar
 * row's, a tab's) in the card's disc, and its words one sentence. Learn more
 * is a link drawn as a button (`ButtonLink`), its ↗ saying it leaves the
 * app, whose press hands the address to the caller's `open`, the window's
 * own door to the browser, and never follows it itself, so the window stays
 * where it is; it stays an `<a href>`, so a right-click still offers its
 * link menu. Got it is the banner's last press, an outline button as every
 * banner's is, and the card has no ×: the reader says they have read it.
 *
 * Whether it stands is the caller's (`shown`), which `onDismiss` asks to
 * turn off. It comes and goes as the rows a setting reveals do (`Reveal`):
 * where its place is a reveal area (`RevealArea`), it rolls up as Got it is
 * pressed and what stands under it closes over it, and elsewhere it goes at
 * once. Where it stands, and the room around it, is its place's, and the
 * banner already drops its presses under the words where a column is too
 * narrow for both. Its words are the app's own, so the screen recording
 * shows them (`ReplayUnmask`).
 */

import type { MouseEvent, ReactNode } from "react";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BANNER_LOOK, Banner } from "../banner/banner.js";
import { BUTTON_VARIANT, Button, ButtonLink } from "../button/button.js";
import { Reveal } from "../reveal/reveal.js";
import { Text } from "../text/text.js";

/** What the card's presses say, worded once. */
const INTRO_CARD_COPY = {
  LEARN_MORE: "Learn more",
  GOT_IT: "Got it",
} as const;

/** A page's first-visit card while `shown`: `children`, its one sentence, beside Learn more, which opens `learnMore` through `open`, and Got it, which calls `onDismiss`. */
export function IntroCard({
  shown,
  glyph,
  learnMore,
  open,
  onDismiss,
  children,
}: {
  shown: boolean;
  /** The glyph the page already wears where it is named, drawn in the card's disc. */
  glyph: ReactNode;
  /** The docs page that says more, opened outside the app. */
  learnMore: string;
  /** Opens an address outside the app, the window's own link door. */
  open: (href: string) => void;
  /** Asks that the card stand no more, for good. */
  onDismiss: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const learn = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    open(learnMore);
  };

  return (
    <Reveal shown={shown}>
      <ReplayUnmask>
        <Banner
          look={BANNER_LOOK.CARD}
          glyph={glyph}
          actions={
            <>
              <ButtonLink
                variant={BUTTON_VARIANT.OUTLINE}
                href={learnMore}
                external
                onClick={learn}
              >
                {INTRO_CARD_COPY.LEARN_MORE}
              </ButtonLink>
              <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onDismiss}>
                {INTRO_CARD_COPY.GOT_IT}
              </Button>
            </>
          }
        >
          <Text>{children}</Text>
        </Banner>
      </ReplayUnmask>
    </Reveal>
  );
}
