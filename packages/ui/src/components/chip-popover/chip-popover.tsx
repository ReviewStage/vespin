import { type ReactNode, useId, useRef, useState } from "react";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { useDisclosure } from "../../use-disclosure.js";
import {
  AnchoredPopover,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
} from "../anchored-popover/anchored-popover.js";
import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName } from "../chip/chip.js";
import { Fact, Facts } from "../facts/facts.js";
import { PopoverPanel } from "../popover-panel/popover-panel.js";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu/searchable-menu.js";

/**
 * chip-popover.tsx -- a toolbar chip whose press hangs a popover of what it names: a title, its facts as label-value rows, and where it offers one, a menu section to pick from.
 *
 * The chip draws its glyph and its words, or its glyph alone where its place
 * is too narrow, and says no more on a rest. A press opens the popover
 * from the chip's leading edge and a second press, Escape, or focus
 * leaving puts it away, focus back on the chip. The popover is headed by
 * its title, and under it each fact stands as a muted label led by its
 * glyph, its value at the line's end (`Facts`), as a cloud sandbox's
 * Status, CPU, and Memory do.
 *
 * Where the owner hands a menu, its rows stand under the facts behind a
 * hairline, headed by the menu's heading ("Move to"), the one chosen
 * checked, and a pick hands the row's id to the owner and closes the
 * popover: the popover is then the picker menu (`SearchableMenu`), its
 * facts standing over its rows (`lead`), so its keys and its phone sheet
 * are the menu's own. With no menu it is a small card (`PopoverPanel`)
 * holding the facts alone. A popover whose menu says all there is, as a
 * task's followers do, stands with no title and no facts, its rows the whole
 * of it, named to a reader by the chip's own name; its rows may stand under
 * no heading, with none chosen, and where its owner takes no pick they only
 * say, each hanging its card, so a press on one changes nothing and the
 * popover stays. Under the rows the owner may pin rows of its own
 * (`SearchableMenu`'s `FootRow`): a press, or a switch a press turns, which
 * act and leave the popover standing. Its title and the facts' labels are
 * the app's own words, which a screen recording shows as they read; a value
 * or a row the owner marks masked stays masked.
 */

/** One fact the popover lists: its glyph, its label, and its value. */
export interface ChipPopoverFact {
  readonly label: string;
  readonly icon: ReactNode;
  readonly value: ReactNode;
}

/** The menu section under the facts: its heading, its rows, the one chosen, what a pick does, and the rows pinned under them. */
export interface ChipPopoverMenu {
  /** The heading over the rows; none where they stand under no heading. */
  readonly heading?: string | undefined;
  readonly rows: readonly MenuRow[];
  /** The id of the row chosen now, drawn checked; none where no row is chosen. */
  readonly value?: string | undefined;
  /** Said where no row is listed. */
  readonly noMatch: string;
  /** What a pick does, which puts the popover away; none where the rows only say, so a press changes nothing. */
  readonly onPick?: ((id: string) => void) | undefined;
  /** Rows pinned under the list: a press, or a switch, each acting with the popover still standing. */
  readonly foot?: readonly FootRow[] | undefined;
}

/**
 * What the popover holds: its title and its facts, with a menu under them
 * or none; or, with a menu, the menu alone, with no title and no facts.
 */
type ChipPopoverBody =
  | {
      title: string;
      facts: readonly ChipPopoverFact[];
      /** The menu section under the facts; none where the popover lists the facts alone. */
      menu?: ChipPopoverMenu | undefined;
    }
  | {
      title?: undefined;
      facts?: undefined;
      menu: ChipPopoverMenu;
    };

/** The title over the facts, as a popover card heads itself. */
const TITLE = "ui-chip-popover-title m-0 text-section font-section";

/** The facts under the title, which the card and the menu's lead both draw. */
function PopoverFacts({ facts }: { facts: readonly ChipPopoverFact[] }): React.JSX.Element {
  return (
    <ReplayUnmask>
      <Facts>
        {facts.map((fact) => (
          <Fact key={fact.label} icon={fact.icon} label={fact.label}>
            {fact.value}
          </Fact>
        ))}
      </Facts>
    </ReplayUnmask>
  );
}

export function ChipPopover({
  label,
  glyph,
  words,
  said,
  iconOnly = false,
  ...body
}: {
  /** What a reader hears the chip as, before its words: "Runs on". */
  label: string;
  glyph: ReactNode;
  words: string;
  /** What a reader hears after the chip's words, which its glyph says to the eye: a sandbox's state; none where it says nothing more. */
  said?: string | undefined;
  /** Whether the chip draws its glyph alone, its words kept for a reader. */
  iconOnly?: boolean | undefined;
} & ChipPopoverBody): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const { menu } = body;
  // The title and the facts under it, where the popover holds them.
  const head = body.title === undefined ? undefined : { title: body.title, facts: body.facts };
  const popoverId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its button, because closing takes the focused popover away with it.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  const left = (target: EventTarget | null) => {
    if (!(target instanceof Node && box.current?.contains(target))) setOpen(false);
  };

  return (
    <span
      className="ui-chip-popover relative inline-flex min-w-0 flex-initial items-center"
      ref={box}
    >
      <Chip
        ref={chip}
        look={CHIP_LOOK.TOOLBAR}
        width={CHIP_WIDTH.AUTO}
        iconOnly={iconOnly}
        aria-label={said === undefined ? `${label}: ${words}` : `${label}: ${words}, ${said}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(!open)}
      >
        {glyph}
        <ChipName>{words}</ChipName>
      </Chip>
      {menu === undefined ? (
        head === undefined ? null : (
          <AnchoredPopover open={open} align={POPOVER_ALIGN.START}>
            <PopoverPanel
              open={open}
              id={popoverId}
              title={head.title}
              replayUnmasked
              onDismiss={close}
              onLeave={left}
            >
              <PopoverFacts facts={head.facts} />
            </PopoverPanel>
          </AnchoredPopover>
        )
      ) : drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={popoverId}
          label={head?.title ?? label}
          lead={
            head === undefined ? undefined : (
              <>
                <p className={TITLE} aria-hidden="true">
                  {head.title}
                </p>
                <PopoverFacts facts={head.facts} />
              </>
            )
          }
          rows={menu.rows.map((row) => ({ ...row, section: menu.heading }))}
          value={menu.value}
          noMatch={menu.noMatch}
          foot={menu.foot}
          align={POPOVER_ALIGN.START}
          width={POPOVER_WIDTH.REGULAR}
          replayUnmasked
          onPick={(id) => {
            const { onPick } = menu;

            // Note that rows that only say take no pick, so a press on one leaves the popover standing.
            if (onPick === undefined) return;
            close();
            onPick(id);
          }}
          onClose={close}
          onLeave={left}
        />
      ) : null}
    </span>
  );
}
