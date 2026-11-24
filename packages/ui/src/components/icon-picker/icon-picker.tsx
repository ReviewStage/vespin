import { type ReactNode, type RefObject, useRef } from "react";
import { IconButton } from "../button/button.js";
import { ScrollArea } from "../scroll-area/scroll-area.js";
import { SearchField } from "../search-field/search-field.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * icon-picker.tsx -- the app's one icon picker: a search over named groups of choices, each a square button in a grid ten wide, walked with the arrows, which a section's icon and a Manager's face are both picked in.
 *
 * The picker is a frame its owner fills: a search on top, anything the
 * owner stands under it (a section's Icons and Emoji tabs and its Remove
 * icon), and a scrolling grid of groups (`IconPickerGroup`), each choice an
 * `IconPickerChoice`, pressed while it is the one chosen. The grid is one
 * tab stop moved through with the arrows, a row's width up and down; the
 * choice that took focus becomes the stop, so Tab out and back lands where
 * the arrows left it. The arrow down from the search enters the grid, and
 * Enter in the search presses the first choice drawn, so a search typed
 * and entered picks what it found first. What an owner hangs over a choice
 * (a section glyph's colors) wears `ICON_PICKER_ASIDE`, so it is no choice
 * of the grid's.
 */

/** How many choices stand in one row of the grid, which `grid-cols-section-icons` lays out alike; the arrows step a row by it. */
const GRID_COLUMNS = 10;

/** The arrow keys that move through the grid, and by how many choices. */
const GRID_STEPS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -GRID_COLUMNS],
  ["ArrowDown", GRID_COLUMNS],
]);

/** The class of what an owner hangs over a choice, whose buttons are no choices of the grid's. */
export const ICON_PICKER_ASIDE = "ui-icon-picker-aside";

/** The grid's choices under `root`, in order, what hangs over them left out. */
function gridChoices(root: Element, selector = "button"): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)].filter(
    (choice) => choice.closest(`.${ICON_PICKER_ASIDE}`) === null,
  );
}

/** Moves focus through the choices with the arrows, from whichever holds it, a row's width up and down. */
function stepGrid(event: React.KeyboardEvent<HTMLFieldSetElement>): void {
  const step = GRID_STEPS.get(event.key);

  if (step === undefined) return;
  const choices = gridChoices(event.currentTarget);
  const from = event.target instanceof HTMLButtonElement ? choices.indexOf(event.target) : -1;

  if (from === -1) return;
  event.preventDefault();
  choices[Math.min(Math.max(from + step, 0), choices.length - 1)]?.focus();
}

/**
 * Makes the choice that took focus the grid's one tab stop. Note that this
 * is written on the buttons themselves rather than drawn, because drawing
 * it would draw every one of some two thousand buttons again on each arrow
 * press; the next choice made draws the stop again as the one chosen.
 */
function standTabStop(event: React.FocusEvent<HTMLFieldSetElement>): void {
  const focused = event.target;

  if (
    !(focused instanceof HTMLButtonElement) ||
    focused.closest(`.${ICON_PICKER_ASIDE}`) !== null
  ) {
    return;
  }

  for (const stop of gridChoices(event.currentTarget, 'button:not([tabindex="-1"])')) {
    stop.tabIndex = -1;
  }

  focused.tabIndex = 0;
}

/**
 * One choice in the grid: a button pressed while it is the one chosen, the
 * grid's tab stop where `stop`, and, where a press hangs something over it
 * rather than choosing (`popup`), saying so. Note that it says it hangs
 * something but not whether that stands open, because flipping
 * `aria-expanded` restyles every box a `:has([aria-expanded])` rule
 * reaches, some two thousand cells among them, for a quarter of a second;
 * what it hangs takes the focus as it opens, which says it instead.
 */
export function IconPickerChoice({
  label,
  pressed,
  stop,
  face,
  popup = false,
  onPress,
}: {
  label: string;
  pressed: boolean;
  stop: boolean;
  face: ReactNode;
  popup?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <IconButton
      icon={face}
      label={label}
      pressed={pressed}
      tabbable={stop}
      aria-haspopup={popup ? "dialog" : undefined}
      onClick={onPress}
    />
  );
}

/** A group of choices under its name, in the grid's rows of ten. */
export function IconPickerGroup({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section
      className="ui-icon-picker-group [.ui-icon-picker-group+&]:mt-control-gap"
      aria-label={name}
    >
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        className="ui-icon-picker-group-name m-0 mb-tight-gap"
      >
        {name}
      </Text>
      <div className="ui-icon-picker-grid grid grid-cols-section-icons gap-tight-gap">
        {children}
      </div>
    </section>
  );
}

/** The picker; see the module's head. */
export function IconPicker({
  searchLabel,
  search,
  query,
  onQuery,
  bar,
  legend,
  panel,
  children,
}: {
  /** What the search asks for, its label and its placeholder alike. */
  searchLabel: string;
  /** The search's field, which a popover opening the picker focuses first. */
  search?: RefObject<HTMLInputElement | null> | undefined;
  query: string;
  onQuery: (query: string) => void;
  /** What stands under the search, as a section's tabs and Remove icon; nothing where none. */
  bar?: ReactNode;
  /** What the grid is called for a reader. */
  legend: string;
  /** The tab the grid is the panel of, where the bar holds tabs. */
  panel?: { readonly id: string; readonly labelledBy: string } | undefined;
  /** The groups (`IconPickerGroup`), or what the grid says in their place. */
  children: ReactNode;
}): React.JSX.Element {
  const grid = useRef<HTMLDivElement | null>(null);

  // Enter, shifted or not, presses the first choice drawn.
  const chooseFirst = () => {
    if (grid.current !== null) gridChoices(grid.current)[0]?.click();
  };

  // Note that the search's own keys stop at Enter and Escape, so the arrow down into the grid is heard around it.
  const toGrid = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();

    if (grid.current !== null) gridChoices(grid.current, 'button:not([tabindex="-1"])')[0]?.focus();
  };

  return (
    <div className="ui-icon-picker flex w-section-icon-picker flex-col">
      <div className="ui-icon-picker-head flex flex-col gap-control-gap p-card-inset-snug pb-0">
        <search onKeyDown={toGrid}>
          <SearchField
            ref={search}
            label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={onQuery}
            onClear={() => onQuery("")}
            onEnter={chooseFirst}
            onShiftEnter={chooseFirst}
          />
        </search>
        {bar}
      </div>
      <fieldset
        className="ui-icon-picker-choices m-0 min-w-0 border-0 p-card-inset-snug pt-control-gap"
        role={panel === undefined ? undefined : "tabpanel"}
        id={panel?.id}
        aria-labelledby={panel?.labelledBy}
        onKeyDown={stepGrid}
        onFocus={standTabStop}
      >
        <VisuallyHidden as="legend">{legend}</VisuallyHidden>
        <div className="ui-icon-picker-scroll flex h-section-icon-scroll flex-col">
          <ScrollArea ref={grid}>{children}</ScrollArea>
        </div>
      </fieldset>
    </div>
  );
}
