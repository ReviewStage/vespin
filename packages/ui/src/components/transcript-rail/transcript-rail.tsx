import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { useDisclosure } from "../../use-disclosure.js";
import { ComboboxList, type ComboboxOption, comboboxOptionId } from "../combobox/combobox.js";
import { useComboboxField } from "../combobox/use-combobox-field.js";
import { dropBelowStart, MENU_DETAIL, Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { MENU_SURFACE_INSET, MenuSurface } from "../menu/menu-surface.js";

/**
 * transcript-rail.tsx -- a map of the lines sent into a conversation, down its leading edge: a line for each, a bubble round those in view, and a list of them on the pointer's rest.
 *
 * A long conversation with an agent buries the reader's own lines among
 * what teammates, other agents, GitHub, and automations send it, and
 * scrolling back for one's last ask is a hunt. The rail stands in the
 * conversation's leading gutter, as Codex's and T3 Code's do, one quiet
 * line for each line sent in, every one the same, spaced evenly in the
 * order they were sent rather than by where they stand in the scroll, so
 * each keeps a size a pointer finds. A bubble wraps the lines that stand in
 * the view, gliding as the conversation scrolls, so the rail says where the
 * reader is.
 *
 * The pointer on the rail opens it into a list of its lines on a menu's
 * surface (`MenuSurface`), each under its sender's face and name with its
 * words after them, the line under the pointer active; a press asks the
 * caller to go to that line (`onJump`). The list is the app's own
 * (`ComboboxList`), steered from the rail as a field steers a menu's
 * (`useComboboxField`): the rail is one Tab stop, opening the list as the
 * keyboard reaches it, its arrows walking the lines and Enter going to one.
 *
 * A phone has no pointer to rest and no gutter to hover in, so there the
 * rail is one press, its lines a glance at where the reader stands, that
 * lists every line in a sheet (`Menu`), as the app's lists of people list
 * them: each under its sender's face and name, the caller's tag beside the
 * name (a GitHub App's badge, how long ago), and its words under them on at
 * most two lines.
 *
 * A conversation of fewer than two lines has nothing to find, so no rail
 * stands beside it.
 */

/** One line sent into the conversation, as the rail marks it. */
export interface TranscriptRailMark {
  readonly key: string;
  /** Who sent it, as a reader hears it and the list names them. */
  readonly sender: string;
  /** Its words, as a reader hears them and the list shows them. */
  readonly words: string;
  /** Its sender's face, which leads its row in the list. */
  readonly face?: React.JSX.Element | undefined;
  /** What stands beside its sender's name in a phone's list: a GitHub App's badge, how long ago it was sent. */
  readonly tag?: ReactNode;
  /** Whether its line stands in the view now, which the bubble wraps. */
  readonly shown: boolean;
}

/** What the rail is named for a reader, and what its list and a phone's sheet are headed with. */
const RAIL_LABEL = "Messages to the agent";

/** What the rail's one press is named for a reader. */
const PRESS_LABEL = "Go to a message";

/** The fewest lines a rail stands for. */
const FEWEST = 2;

/** How far the bubble stands out past the lines it wraps, above the first and below the last, in pixels. */
const BUBBLE_PAD = 2;

/** The rail's column at the conversation's leading edge, taking the pointer only on its lines and its open list. */
const COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-24 items-center";

/** The rail's one press: its lines, centered down the column, each at most a pitch tall and shrinking to a hairline's pitch where more stand than its height holds. */
const PRESS =
  "pointer-events-auto flex max-h-full w-full cursor-default appearance-none flex-col border-0 bg-transparent p-0 py-ui-12";

const LINE_SLOT = "flex h-ui-8 min-h-ui-2 w-full shrink items-center pl-ui-6";

const LINE = "block h-ui-2 w-ui-12 rounded-ui-full bg-muted-foreground opacity-60";

/** The bubble round the lines in view: the column's whole height, clipped to them, so it glides on its clip rather than its size. */
const BUBBLE =
  "pointer-events-none absolute inset-y-0 bg-secondary transition-[clip-path,opacity] duration-(--ui-duration-pane) ease-pane";

/** Where the open list stands: over the rail, centered down the column. */
const LIST_PLACE = "pointer-events-none absolute inset-y-0 left-ui-4 flex items-center";

const LIST_SURFACE = "pointer-events-auto w-popover-wide";

/** A phone's rail: one press down the gutter, its lines a glance, opening the list of lines. */
const NARROW_COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-16 items-center";

const NARROW_PRESS =
  "pointer-events-auto flex max-h-full w-full cursor-press appearance-none flex-col items-start overflow-hidden border-0 bg-transparent p-0 py-ui-8 pl-ui-4";

const NARROW_SLOT = "flex h-ui-6 min-h-ui-2 shrink items-center";
const NARROW_LINE = "block h-ui-2 w-ui-8 rounded-ui-full bg-muted-foreground opacity-60";

/** Where the bubble stands down the column, in pixels from its top and its bottom; none where no line stands in view. */
interface BubbleClip {
  readonly top: number;
  readonly bottom: number;
}

/** Every line as a phone's sheet lists it: its sender's face, name, and tag over its words. */
function sheetEntries(
  marks: readonly TranscriptRailMark[],
  onJump: (key: string) => void,
): MenuEntry[][] {
  return [
    marks.map((mark) => ({
      key: mark.key,
      ...(mark.face === undefined ? undefined : { icon: mark.face }),
      label: mark.sender,
      tag: mark.tag,
      detail: mark.words,
      detailPlace: MENU_DETAIL.CLAMPED,
      onSelect: () => onJump(mark.key),
    })),
  ];
}

/** Every line as the rail's list names it: its sender's face and name, its words after them. */
function listOptions(marks: readonly TranscriptRailMark[]): ComboboxOption[] {
  return marks.map((mark) => ({
    id: mark.key,
    label: mark.sender,
    icon: mark.face ?? null,
    detail: mark.words,
  }));
}

/** The line whose slot stands at `y` on the screen, or the last where `y` is past them all. */
function lineAt(slots: readonly (HTMLElement | null)[], y: number): number {
  const at = slots.findIndex((slot) => slot !== null && y < slot.getBoundingClientRect().bottom);

  return at === -1 ? slots.length - 1 : at;
}

/** The last line standing in the view, or the last line where none does: where the keyboard opens the list. */
function lastShown(marks: readonly TranscriptRailMark[]): number {
  const at = marks.findLastIndex((mark) => mark.shown);

  return at === -1 ? marks.length - 1 : at;
}

/**
 * Where the bubble wraps the lines in view: from the first such line's slot
 * to the last's, read off the slots as they are laid out, and read again as
 * the column changes size.
 */
function useBubble(
  column: RefObject<HTMLElement | null>,
  slots: RefObject<(HTMLElement | null)[]>,
  marks: readonly TranscriptRailMark[],
): BubbleClip | undefined {
  const [clip, setClip] = useState<BubbleClip | undefined>(undefined);
  const shown = marks.flatMap((mark, index) => (mark.shown ? [index] : []));
  const first = shown[0];
  const last = shown[shown.length - 1];

  useLayoutEffect(() => {
    const box = column.current;

    if (box === null) return;

    const read = () => {
      const from = first === undefined ? null : slots.current[first];
      const to = last === undefined ? null : slots.current[last];

      if (from == null || to == null) return setClip(undefined);
      const top = Math.max(from.offsetTop - BUBBLE_PAD, 0);
      const bottom = Math.max(box.clientHeight - (to.offsetTop + to.offsetHeight) - BUBBLE_PAD, 0);

      setClip((was) => (was?.top === top && was.bottom === bottom ? was : { top, bottom }));
    };

    read();
    const sized = new ResizeObserver(read);
    sized.observe(box);

    return () => sized.disconnect();
  }, [column, slots, first, last, marks.length]);

  return clip;
}

/** The bubble round the lines in view, placed across its column by `inset`, its corners a small round's. */
function Bubble({
  clip,
  inset,
}: {
  clip: BubbleClip | undefined;
  inset: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(BUBBLE, inset, clip === undefined ? "opacity-0" : "opacity-100")}
      style={
        clip === undefined
          ? undefined
          : { clipPath: `inset(${clip.top}px 0 ${clip.bottom}px 0 round var(--radius-ui-6))` }
      }
    />
  );
}

/** A phone's rail: the lines as a glance, one press listing every line in a sheet. */
function NarrowRail({
  marks,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  onJump: (key: string) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const column = useRef<HTMLDivElement | null>(null);
  const slots = useRef<(HTMLElement | null)[]>([]);
  const clip = useBubble(column, slots, marks);

  return (
    <div ref={column} className={NARROW_COLUMN}>
      <Bubble clip={clip} inset="left-0 w-ui-16" />
      <button
        type="button"
        aria-label={RAIL_LABEL}
        className={NARROW_PRESS}
        {...menu.trigger(dropBelowStart)}
      >
        {marks.map((mark, index) => (
          <span
            key={mark.key}
            ref={(slot) => {
              slots.current[index] = slot;
            }}
            className={NARROW_SLOT}
          >
            <span className={NARROW_LINE} />
          </span>
        ))}
      </button>
      {menu.drawn === undefined ? null : (
        <Menu
          label={RAIL_LABEL}
          menu={menu.drawn}
          groups={sheetEntries(marks, onJump)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/** The rail beside a conversation wide enough for a gutter: its lines, the bubble, and the list it opens into. */
function WideRail({
  marks,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  onJump: (key: string) => void;
}): React.JSX.Element {
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  // Whether a line was gone to, or Escape pressed, since the rail last opened: the list stands shut until the pointer comes again or a key asks for it.
  const [shut, setShut] = useState(false);
  const [active, setActive] = useState(-1);
  const column = useRef<HTMLElement | null>(null);
  const slots = useRef<(HTMLElement | null)[]>([]);
  const listId = useId();
  const clip = useBubble(column, slots, marks);
  const open = (pointed || focused) && !shut;
  const drawn = useDisclosure(open);

  const choose = (index: number) => {
    const mark = marks[index];

    if (mark === undefined) return;
    setShut(true);
    onJump(mark.key);
  };

  const field = useComboboxField({
    open,
    active,
    count: marks.length,
    controls: open ? listId : undefined,
    activeId: open && active >= 0 ? comboboxOptionId(listId, active) : undefined,
    onActiveChange: setActive,
    onChoose: choose,
    onEnter: () => setShut(false),
    onEscape: () => setShut(true),
    // Note that an arrow pressed with the list shut opens it again, on the line it last stood on.
    onKey: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") setShut(false);
    },
  });

  return (
    <nav
      ref={column}
      aria-label={RAIL_LABEL}
      className={COLUMN}
      onPointerEnter={(event) => {
        setActive(lineAt(slots.current, event.clientY));
        setShut(false);
        setPointed(true);
      }}
      onPointerLeave={() => setPointed(false)}
    >
      <Bubble clip={clip} inset="left-ui-2 w-ui-20" />
      <button
        type="button"
        aria-label={PRESS_LABEL}
        className={PRESS}
        {...field.field}
        onKeyDown={(event) => field.onKeyDown(event)}
        onFocus={() => {
          if (!pointed) setActive(lastShown(marks));
          setShut(false);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
      >
        {marks.map((mark, index) => (
          <span
            key={mark.key}
            ref={(slot) => {
              slots.current[index] = slot;
            }}
            className={LINE_SLOT}
          >
            <span className={LINE} />
          </span>
        ))}
      </button>
      {drawn.mounted ? (
        <div className={LIST_PLACE}>
          <MenuSurface
            ref={drawn.ref}
            className={LIST_SURFACE}
            inset={MENU_SURFACE_INSET.NONE}
            leaving={drawn.leaving}
          >
            <ComboboxList
              id={listId}
              label={RAIL_LABEL}
              groups={[{ label: RAIL_LABEL, options: listOptions(marks) }]}
              headed={false}
              active={active}
              onActiveChange={setActive}
              onChoose={choose}
            />
          </MenuSurface>
        </div>
      ) : null}
    </nav>
  );
}

/** The rail beside a conversation: a line for each line sent into it, a bubble round those in view, a press going to its line. */
export function TranscriptRail({
  marks,
  narrow,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  /** Whether the window stands in a phone's room, where the rail is one press listing its lines; the caller's, so the rail turns as the room does. */
  narrow: boolean;
  /** Goes to the line a mark stands for. */
  onJump: (key: string) => void;
}): React.JSX.Element | null {
  if (marks.length < FEWEST) return null;

  if (narrow) return <NarrowRail marks={marks} onJump={onJump} />;

  return <WideRail marks={marks} onJump={onJump} />;
}
