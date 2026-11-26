/**
 * side-splits.tsx -- a view with a pane opened beside it, parted by the edge it is dragged by, and the pane alone the box's whole width where the box is too narrow for both, as a Manager's thread stands beside its chat.
 */

import {
  BACK_BUTTON_LOOK,
  BackButton,
  IconButton,
  PaneBar,
  SideSplit,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useSideSplit,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

const BOUNDS = { MIN: 160, MAX: 320, DEFAULT: 200 } as const;

/** The least the view keeps beside the pane before it hides. */
const MAIN_MIN = 200;

/** A view and a pane in a box `narrow` or not, the pane open until its close, and opened again by the view's press. */
function SplitBox({ narrow }: { narrow: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState<number>(BOUNDS.DEFAULT);

  const split = useSideSplit({
    open,
    width,
    bounds: BOUNDS,
    mainMin: MAIN_MIN,
    label: "Resize pane",
    onResize: setWidth,
  });

  const close = () => setOpen(false);

  return (
    <div className={narrow ? "catalog-side-split catalog-side-split-narrow" : "catalog-side-split"}>
      <SideSplit
        split={split}
        main={
          <div className="catalog-side-split-view">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              The view
            </Text>
            {open ? null : (
              <IconButton icon={<GLYPH.THREAD />} label="Open pane" onClick={() => setOpen(true)} />
            )}
          </div>
        }
        side={
          <>
            <PaneBar
              start={
                split.alone ? (
                  <BackButton
                    look={BACK_BUTTON_LOOK.GLYPH}
                    label="View"
                    place="the view"
                    onBack={close}
                  />
                ) : undefined
              }
              title="Pane"
              end={<IconButton icon={<GLYPH.CLOSE />} label="Close pane" onClick={close} />}
            />
            <div className="catalog-side-split-view">
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {split.alone ? "Alone, the view hidden" : `Drag the edge · ${String(width)}px`}
              </Text>
            </div>
          </>
        }
      />
    </div>
  );
}

function SideSplits(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="side-split-both" title="A pane beside the view">
        <SplitBox narrow={false} />
      </CatalogSection>
      <CatalogSection id="side-split-alone" title="Too narrow for both: the pane alone">
        <SplitBox narrow />
      </CatalogSection>
    </>
  );
}

export const SIDE_SPLITS_EXAMPLE: Example = {
  id: "side-splits",
  title: "Side splits",
  Render: SideSplits,
};
