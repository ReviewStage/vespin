import {
  ChipPopover,
  type ChipPopoverFact,
  type MenuRow,
  STATUS_TONE,
  StatusGlyph,
  type StatusTone,
  StatusWords,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * chip-popovers.tsx -- a toolbar chip whose press opens a popover of facts:
 * a cloud sandbox off, booting, and running, its state on the chip's dot
 * and in the popover's Status, and one with a menu section under the facts,
 * the places to move its agent to.
 */

const STATES = [
  { id: "off", words: "Off", tone: STATUS_TONE.NEUTRAL },
  { id: "booting", words: "Booting", tone: STATUS_TONE.WORKING },
  { id: "running", words: "Running", tone: STATUS_TONE.COMPLETE },
] as const satisfies readonly { id: string; words: string; tone: StatusTone }[];

/** A sandbox's facts in a state: its status, its processors, and its memory. */
function sandboxFacts(words: string, tone: StatusTone): readonly ChipPopoverFact[] {
  return [
    {
      label: "Status",
      icon: <GLYPH.SANDBOX_STATE aria-hidden="true" />,
      value: <StatusWords tone={tone}>{words}</StatusWords>,
    },
    { label: "CPU", icon: <GLYPH.CPU aria-hidden="true" />, value: "4 vCPUs" },
    { label: "Memory", icon: <GLYPH.RAM aria-hidden="true" />, value: "8 GB" },
  ];
}

/** The cloud glyph wearing the state's dot. */
function cloudGlyph(words: string, tone: StatusTone): React.JSX.Element {
  return (
    <StatusGlyph tone={tone} label={words}>
      <GLYPH.CLOUD aria-hidden="true" />
    </StatusGlyph>
  );
}

const PLACES: readonly MenuRow[] = [
  { id: "cloud", label: "Cloud", icon: <GLYPH.CLOUD aria-hidden="true" /> },
  { id: "studio", label: "MacBook Pro", icon: <GLYPH.DESKTOP aria-hidden="true" /> },
  {
    id: "mini",
    label: "Mac mini",
    icon: <GLYPH.DESKTOP aria-hidden="true" />,
    detail: "Offline",
  },
];

function WithMoveTo(): React.JSX.Element {
  const [here, setHere] = useState("cloud");
  return (
    <ChipPopover
      label="Runs on"
      glyph={cloudGlyph("Running", STATUS_TONE.COMPLETE)}
      words="Cloud"
      hint="Runs on: Cloud · Running"
      said="Running"
      title="Cloud sandbox"
      facts={sandboxFacts("Running", STATUS_TONE.COMPLETE)}
      menu={{
        heading: "Move to",
        rows: PLACES,
        value: here,
        noMatch: "No places",
        onPick: setHere,
      }}
    />
  );
}

function ChipPopovers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="chip-popover-states" title="A cloud sandbox in each state">
        <div className="catalog-glyph-line catalog-chip-popover-stage">
          {STATES.map((state) => (
            <ChipPopover
              key={state.id}
              label="Runs on"
              glyph={cloudGlyph(state.words, state.tone)}
              words="Cloud"
              hint={`Runs on: Cloud · ${state.words}`}
              said={state.words}
              title="Cloud sandbox"
              facts={sandboxFacts(state.words, state.tone)}
            />
          ))}
        </div>
      </CatalogSection>
      <CatalogSection id="chip-popover-menu" title="With a menu section under the facts">
        <div className="catalog-glyph-line catalog-chip-popover-stage">
          <WithMoveTo />
        </div>
      </CatalogSection>
    </>
  );
}

export const CHIP_POPOVERS_EXAMPLE: Example = {
  id: "chip-popovers",
  title: "Chip popovers",
  Render: ChipPopovers,
};
