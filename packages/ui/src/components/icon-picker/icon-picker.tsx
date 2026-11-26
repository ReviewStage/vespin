import type { PopoverRoot } from "@base-ui/react/popover";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Popover, PopoverContent } from "../../shadcn/popover.js";
import { ICON_BUTTON_SIZE, IconButton } from "../button/button.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
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
 * and entered picks what it found first. What a choice opens (a section
 * glyph's colors) floats from it (`IconPickerFlyout`) in a portal on the
 * window's layer, placed by the window's edges rather than the grid's, so
 * the scrolling grid never cuts it: it turns and slides to fit what is seen
 * of the window, over the picker's own choices where it must.
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

/** Base UI's reason for Escape putting a popover away. */
const ESCAPE_KEY = "escape-key" satisfies PopoverRoot.ChangeEventReason;

/** The grid's choices under `root`, in order. */
function gridChoices(root: Element, selector = "button"): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)];
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

  // Note that a flyout's choices are heard here too, since React carries a portal's events up the tree that drew it, but they stand outside the grid.
  if (!(focused instanceof HTMLButtonElement) || !event.currentTarget.contains(focused)) return;

  for (const stop of gridChoices(event.currentTarget, 'button:not([tabindex="-1"])')) {
    stop.tabIndex = -1;
  }

  focused.tabIndex = 0;
}

/** What a choice floats while it stands open: its name for a reader, its choices, and where Escape or a press away puts it. */
export interface IconPickerFlyout {
  readonly label: string;
  /** Its choices, each an `IconButton` marked `roving`, laid out five to a row. */
  readonly content: ReactNode;
  readonly onClose: () => void;
}

/** The flyouts standing in the window, each its popup and the choice it floats from, the newest last. */
const standingFlyouts: { readonly popup: HTMLElement; readonly choice: HTMLElement }[] = [];

/**
 * The choice the flyout `node` stands in floats from, the newest where
 * flyouts stand over one another; none where `node` stands in no flyout. A
 * surface that closes when a press or the focus leaves it, as a menu's
 * panel holding a picker does, traces a flyout back through it, since the
 * flyout stands apart from the picker, portaled to the body.
 */
export function iconPickerChoiceOf(node: Node): HTMLElement | undefined {
  return standingFlyouts.findLast((each) => each.popup.contains(node))?.choice;
}

/** Counts `popup` among the flyouts standing, floating from `choice`, until the returned call takes it out. */
function standFlyout(popup: HTMLElement, choice: HTMLElement): () => void {
  const entry = { popup, choice };
  standingFlyouts.push(entry);

  return () => {
    const at = standingFlyouts.indexOf(entry);

    if (at !== -1) standingFlyouts.splice(at, 1);
  };
}

/** The layer a flyout from `choice` stands in: the one the picker it stands in was hung on, over a dialog's card where that was. */
function layerAround(choice: HTMLElement | null): string | undefined {
  return choice?.closest("[data-layer]")?.getAttribute("data-layer") ?? undefined;
}

/**
 * Whether a change asks a flyout away for the press or the focus going to
 * its own choice, which the choice's press answers. Note that the focus is
 * heard too, because an engine that focuses a pressed button moves it there
 * before the click, and closing then would let the click open it again.
 */
function towardChoice(
  details: PopoverRoot.ChangeEventDetails,
  choice: HTMLElement | null,
): boolean {
  const event = details.event;
  const to = event instanceof FocusEvent ? event.relatedTarget : event?.target;

  return to instanceof Node && choice?.contains(to) === true;
}

/**
 * The flyout a choice floats, on Base UI's popover, a child of the
 * picker's own, so a press inside it is no press away from the picker. Its
 * pressed choice, or else its first, takes the focus the moment it opens;
 * the arrows walk its choices; and Escape puts it away, the focus going back
 * to the choice it floats from, as a press away or the focus leaving does,
 * the focus staying where it went, and another choice's flyout taking its
 * place keeps the focus there.
 */
function ChoiceFlyout({
  choice,
  flyout,
}: {
  choice: RefObject<HTMLButtonElement | null>;
  flyout: IconPickerFlyout;
}): React.JSX.Element {
  const row = useRef<HTMLDivElement | null>(null);
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.BOTH });

  const start = () =>
    row.current?.querySelector<HTMLElement>('button[aria-pressed="true"]') ??
    row.current?.querySelector<HTMLElement>("button") ??
    true;

  // Note that the row takes the focus the moment it stands rather than on the next frame, as Base UI would, because a key pressed in that frame would land on the choice or the search and close it.
  const landed = useRef(false);
  // Whether Escape put it away, which hands the focus back to its choice; a press away or the focus leaving already put the focus where it went, and another choice's flyout taking its place keeps the focus it took.
  const escaped = useRef(false);
  // Whether it still stands. Note that Base UI hears the focus leave a moment after it went, so a flyout another choice's took the place of may ask to close once it is gone, which would close the one that replaced it.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);
  const close = useRef(flyout.onClose);
  close.current = flyout.onClose;
  // Whether it is counted among the flyouts standing, which it is from the moment its row stands, before it takes the focus, so a surface hearing the focus leave for it can trace it back.
  const counted = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    const popup = row.current?.parentElement;

    if (counted.current === undefined && popup != null && choice.current !== null) {
      counted.current = standFlyout(popup, choice.current);
    }

    return () => {
      counted.current?.();
      counted.current = undefined;
    };
  }, [choice]);

  // Note that Escape with the focus back on its choice closes it alone, heard on the choice before it reaches the window, where the picker's popover would close as well.
  useEffect(() => {
    const button = choice.current;

    if (button === null) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !standing.current) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };

    button.addEventListener("keydown", onKey);

    return () => button.removeEventListener("keydown", onKey);
  }, [choice]);

  const stand = (element: HTMLDivElement | null) => {
    row.current = element;
    roving.ref(element);

    // Note that the popup the row stands in is what is counted, so a press on its edge around the row is the flyout's too.
    const popup = element?.parentElement;

    if (counted.current === undefined && popup != null && choice.current !== null) {
      counted.current = standFlyout(popup, choice.current);
    }

    if (element === null || landed.current) return;
    landed.current = true;
    const landing = start();

    if (landing !== true) landing.focus({ preventScroll: true });
  };

  return (
    <Popover
      open
      onOpenChange={(next, details) => {
        const byEscape = details.reason === ESCAPE_KEY;

        // Note that Escape always closes it, the focus standing on its choice included.
        const kept = !byEscape && towardChoice(details, choice.current);

        if (next || !standing.current || kept) return;
        escaped.current = byEscape;
        flyout.onClose();
      }}
    >
      <PopoverContent
        anchor={choice}
        layer={layerAround(choice.current)}
        aria-label={flyout.label}
        initialFocus={start}
        finalFocus={() => (escaped.current ? choice.current : false)}
      >
        <div
          ref={stand}
          data-roving={roving["data-roving"]}
          role="toolbar"
          aria-label={flyout.label}
          className="ui-icon-picker-flyout grid grid-cols-5 gap-tight-gap p-tight-gap"
          onKeyDown={roving.onKeyDown}
          onFocus={roving.onFocus}
        >
          {flyout.content}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One choice in the grid: a button pressed while it is the one chosen, the
 * grid's tab stop where `stop`, and, where a press floats something from it
 * rather than choosing (`popup`), saying so, and floating `flyout` while it
 * stands open. Note that it says it floats something but not whether that
 * stands open, because flipping `aria-expanded` restyles every box a
 * `:has([aria-expanded])` rule reaches, some two thousand cells among them,
 * for a quarter of a second; the flyout takes the focus as it opens, which
 * says it instead.
 */
export function IconPickerChoice({
  label,
  pressed,
  stop,
  face,
  popup = false,
  flyout,
  onPress,
}: {
  label: string;
  pressed: boolean;
  stop: boolean;
  face: ReactNode;
  popup?: boolean | undefined;
  /** What it floats while it stands open; nothing while none does. */
  flyout?: IconPickerFlyout | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const button = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <IconButton
        ref={button}
        icon={face}
        size={ICON_BUTTON_SIZE.PICKER}
        label={label}
        pressed={pressed}
        tabbable={stop}
        aria-haspopup={popup ? "dialog" : undefined}
        onClick={onPress}
      />
      {flyout === undefined ? null : <ChoiceFlyout choice={button} flyout={flyout} />}
    </>
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
