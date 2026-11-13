import {
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { comboboxOptionId } from "../combobox/combobox.js";
import { useComboboxField } from "../combobox/use-combobox-field.js";
import { dropBelowStart, MENU_DETAIL, Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { MENU_SURFACE_FLOW, MenuSurface } from "../menu/menu-surface.js";
import { OneLine } from "../one-line/one-line.js";

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
 * The pointer on the rail stacks the lines round the one under it beside
 * the rail, each its own pill (`MenuSurface`'s toolbar): its sender's face,
 * name, and words, the line under the pointer in front and those either
 * side fainter, the stack gliding on the app's spring as the
 * pointer moves; a press asks the caller to go to the line under it
 * (`onJump`). The rail is one Tab stop, steering the stack as a field
 * steers a menu (`useComboboxField`): it opens as the keyboard reaches it,
 * its arrows walking the lines and Enter going to one.
 *
 * Note that the pointer moving draws nothing and adds no element. Every
 * line's pill stands drawn, hidden, from the rail's first draw, and the
 * pointer crossing a line writes the transform and opacity of the few pills
 * near it and near where the stack stood (`placeStack`), outside
 * React. An element added or taken away anywhere in the app restyles most
 * of the page under its stylesheet, as does a change to `aria-selected`,
 * which it reads under a `:has()`, so the rail names an option selected only
 * while the keys steer it. The lines' places are read as the pointer comes,
 * the focus comes, or the column changes size, never as it moves, so a move
 * forces no layout either.
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

/** How many pills stand either side of the line in front. */
const STACK_REACH = 3;

/** The gap between two pills, in pixels, as `--ui-space-4`. */
const STACK_GAP = 4;

/** How much fainter each pill stands for each line it is from the one in front, so one just past the stack's ends is gone. */
const STACK_FADE = 1 / (STACK_REACH + 1);

/** The stack beside the rail, its middle moved to the line in front; it takes no pointer, which scrubs the rail and presses it. */
const STACK =
  "pointer-events-none absolute top-0 left-ui-24 transition-transform duration-(--ui-duration-pane) ease-spring";

/** A pill's place in the stack, moved by its transform and opacity on the app's spring. */
const PILL_PLACE =
  "absolute top-0 left-0 origin-left transition-[transform,opacity] duration-(--ui-duration-pane) ease-spring";

const PILL_WORDS = "flex max-w-popover-wide items-center gap-ui-6 px-ui-4 text-caption";

/** A phone's rail: one press down the gutter, its lines a glance, opening the list of lines. */
const NARROW_COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-16 items-center";

const NARROW_PRESS =
  "pointer-events-auto flex max-h-full w-full cursor-press appearance-none flex-col items-start overflow-hidden border-0 bg-transparent p-0 py-ui-8 pl-ui-4";

const NARROW_SLOT = "flex h-ui-6 min-h-ui-2 shrink items-center";
const NARROW_LINE = "block h-ui-2 w-ui-8 rounded-ui-full bg-muted-foreground opacity-60";

/** Where the bubble stands down the column, in pixels from its top and its bottom. */
interface BubbleClip {
  readonly top: number;
  readonly bottom: number;
}

/** The bubble as drawn: where it last stood, none before any line stood in view, and whether a line stands in view now. */
interface BubbleState {
  readonly clip: BubbleClip | undefined;
  readonly shown: boolean;
}

/** Where the lines stand down the column as laid out: their middles, and the column's height and top on the screen, read once a hover or a focus begins. */
interface RailLayout {
  readonly middles: readonly number[];
  readonly room: number;
  readonly top: number;
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

/** The rail's lines as laid out, read off their slots. */
function readLayout(box: HTMLElement, slots: readonly (HTMLElement | null)[]): RailLayout {
  return {
    middles: slots.map((slot) => (slot === null ? 0 : slot.offsetTop + slot.offsetHeight / 2)),
    room: box.clientHeight,
    top: box.getBoundingClientRect().top,
  };
}

/** The line whose middle stands nearest `y`, in the column's own pixels. */
function nearestLine(middles: readonly number[], y: number): number {
  let best = 0;

  for (let index = 1; index < middles.length; index++) {
    if (Math.abs((middles[index] ?? 0) - y) < Math.abs((middles[best] ?? 0) - y)) best = index;
  }

  return best;
}

/** The last line standing in the view, or the last line where none does: where the keyboard opens the list. */
function lastShown(marks: readonly TranscriptRailMark[]): number {
  const at = marks.findLastIndex((mark) => mark.shown);

  return at === -1 ? marks.length - 1 : at;
}

/**
 * Where the bubble wraps the lines in view: from the first such line's slot
 * to the last's, read off the slots as they are laid out, and read again as
 * the column changes size. Where no line stands in view, as between two
 * lines a fast scroll passes, the bubble keeps where it last stood and only
 * fades, so it never stands unclipped down the column's whole height.
 */
function useBubble(
  column: RefObject<HTMLElement | null>,
  slots: RefObject<(HTMLElement | null)[]>,
  marks: readonly TranscriptRailMark[],
): BubbleState {
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

      if (from == null || to == null) return;
      const top = Math.max(from.offsetTop - BUBBLE_PAD, 0);
      const bottom = Math.max(box.clientHeight - (to.offsetTop + to.offsetHeight) - BUBBLE_PAD, 0);

      setClip((was) => (was?.top === top && was.bottom === bottom ? was : { top, bottom }));
    };

    read();
    const sized = new ResizeObserver(read);
    sized.observe(box);

    return () => sized.disconnect();
  }, [column, slots, first, last, marks.length]);

  return { clip, shown: first !== undefined };
}

/** The bubble round the lines in view, placed across its column by `inset`, its corners a small round's. */
function Bubble({ bubble, inset }: { bubble: BubbleState; inset: string }): React.JSX.Element {
  const { clip } = bubble;

  return (
    <span
      aria-hidden
      className={cn(
        BUBBLE,
        inset,
        bubble.shown && clip !== undefined ? "opacity-100" : "opacity-0",
      )}
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
  const bubble = useBubble(column, slots, marks);

  return (
    <div ref={column} className={NARROW_COLUMN}>
      <Bubble bubble={bubble} inset="left-0 w-ui-16" />
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

/** A line as its pill: its sender's face and name, and its words, on the app's floating toolbar; it draws once. */
const StackPill = memo(function StackPill({
  mark,
}: {
  mark: TranscriptRailMark;
}): React.JSX.Element {
  return (
    <MenuSurface flow={MENU_SURFACE_FLOW.TOOLBAR}>
      <span className={PILL_WORDS}>
        {mark.face === undefined ? null : <span className="flex flex-none">{mark.face}</span>}
        <OneLine className="min-w-0 flex-none" words={mark.sender}>
          {mark.sender}
        </OneLine>
        <OneLine className="min-w-0 text-muted-foreground" words={mark.words}>
          {mark.words}
        </OneLine>
      </span>
    </MenuSurface>
  );
});

/** How many lines from the one in front a line stands, held to just past the stack's ends, so a pill past the stack waits there and slides in from there rather than across the column. */
function stackPlace(index: number, active: number): number {
  return Math.max(-STACK_REACH - 1, Math.min(index - active, STACK_REACH + 1));
}

/**
 * Moves the pills near the line in front, and those near where it was, to
 * where it stands now: each to its place in the stack, fainter by its
 * distance. Note that only these are written, as their own transform and
 * opacity, so the pointer crossing a line restyles a few pills rather than
 * the rail.
 */
function placeStack(
  pills: readonly (HTMLElement | null)[],
  from: number,
  to: number,
  open: boolean,
  pill: number,
): void {
  const reach = STACK_REACH + 1;
  const first = Math.max(0, Math.min(from, to) - reach);
  const last = Math.min(pills.length - 1, Math.max(from, to) + reach);

  for (let index = first; index <= last; index++) {
    const at = stackPlace(index, to);
    const element = pills[index];

    if (element == null) continue;
    element.style.transform = `translateY(${at * (pill + STACK_GAP) - pill / 2}px)`;
    element.style.opacity = String(open ? Math.max(0, 1 - Math.abs(at) * STACK_FADE) : 0);
  }
}

/** One of the rail's lines; it draws once. */
const RailLine = memo(function RailLine({
  index,
  slots,
}: {
  index: number;
  slots: RefObject<(HTMLElement | null)[]>;
}): React.JSX.Element {
  const hold = useCallback(
    (slot: HTMLElement | null) => {
      slots.current[index] = slot;
    },
    [index, slots],
  );

  return (
    <span ref={hold} className={LINE_SLOT}>
      <span className={LINE} />
    </span>
  );
});

/** A pill before the stack first opens: below the stack's end, and gone. */
const PILL_WAITING: React.CSSProperties = { opacity: 0, transform: "translateY(0px)" };

/** A line's pill as an option of the stack; it draws once, and draws again only as the keys name it selected or not; the line in front moves it (`placeStack`). */
const StackOption = memo(function StackOption({
  mark,
  index,
  id,
  selected,
  pills,
  onChoose,
}: {
  mark: TranscriptRailMark;
  index: number;
  id: string;
  selected: boolean;
  pills: RefObject<(HTMLElement | null)[]>;
  onChoose: (index: number) => void;
}): React.JSX.Element {
  const hold = useCallback(
    (element: HTMLElement | null) => {
      pills.current[index] = element;
    },
    [index, pills],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the rail's press reads the keys and names this option active, as a field steers a menu.
    <div
      ref={hold}
      id={id}
      role="option"
      tabIndex={-1}
      // Note that an option is named selected only while the keys steer the rail: the app's stylesheet reads `aria-selected` under a `:has()`, so each change restyles most of the page, and the pointer would change it at every line it crossed.
      aria-selected={selected}
      className={PILL_PLACE}
      style={PILL_WAITING}
      onClick={() => onChoose(index)}
    >
      <StackPill mark={mark} />
    </div>
  );
});

/** The rail beside a conversation wide enough for a gutter: its lines, the bubble, and the stack of pills it opens into. */
function WideRail({
  marks,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  onJump: (key: string) => void;
}): React.JSX.Element {
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  // Whether a line was gone to, or Escape pressed, since the rail last opened: the stack stands shut until the pointer comes again or a key asks for it.
  const [shut, setShut] = useState(false);
  // The line the keys hold, which the rail names to a reader; the pointer moves the stack without it (`moveTo`).
  const [active, setActive] = useState(-1);
  const column = useRef<HTMLElement | null>(null);
  const slots = useRef<(HTMLElement | null)[]>([]);
  const pills = useRef<(HTMLElement | null)[]>([]);
  const stack = useRef<HTMLDivElement | null>(null);
  // Where the stack stands and what it is read against, held outside React so the pointer moving draws nothing.
  const inFront = useRef(-1);
  const placed = useRef(-1);
  const layout = useRef<RailLayout | undefined>(undefined);
  const pillHeight = useRef(0);
  const opened = useRef(false);
  const listId = useId();
  const bubble = useBubble(column, slots, marks);
  const open = (pointed || focused) && !shut;

  // Note that the lines' places are read as a hover or a focus begins, and again only once the column changes size, never as the pointer moves over them.
  const measure = (): RailLayout | undefined => {
    const box = column.current;

    if (box === null) return undefined;
    layout.current = readLayout(box, slots.current);
    pillHeight.current = pills.current[0]?.offsetHeight ?? 0;

    return layout.current;
  };

  // Puts the stack at line `to`: the pills and lines near it and near where it stood, and the stack's middle at the line, held off the column's ends.
  const moveTo = (to: number) => {
    const read = layout.current ?? measure();
    const box = stack.current;

    if (read === undefined || box === null || to < 0) return;
    const pill = pillHeight.current;
    const span = STACK_REACH * (pill + STACK_GAP) + pill;
    const center = Math.max(span, Math.min(read.middles[to] ?? 0, read.room - span));
    placeStack(pills.current, placed.current < 0 ? to : placed.current, to, opened.current, pill);
    box.style.transform = `translateY(${center}px)`;
    placed.current = to;
    inFront.current = to;
  };

  useLayoutEffect(() => {
    const box = column.current;

    if (box === null) return;

    const sized = new ResizeObserver(() => {
      layout.current = undefined;
    });

    sized.observe(box);

    return () => sized.disconnect();
  }, []);

  // Note that lines arriving or going move every line's place without the column changing size, so they are read again, and an open stack put back at its line.
  useLayoutEffect(() => {
    layout.current = undefined;

    if (opened.current) moveTo(inFront.current);
  }, [marks]);

  // The stack opens and shuts where it stands, and follows the keys. Note that `moveTo` reads refs alone, so it is the same move on every draw.
  useLayoutEffect(() => {
    opened.current = open;
    moveTo(inFront.current);
  }, [open]);

  useLayoutEffect(() => {
    if (active >= 0) moveTo(active);
  }, [active]);

  const choose = useCallback(
    (index: number) => {
      const mark = marks[index];

      if (mark === undefined) return;
      setShut(true);
      onJump(mark.key);
    },
    [marks, onJump],
  );

  const field = useComboboxField({
    open,
    active,
    count: marks.length,
    controls: open ? listId : undefined,
    activeId: open && focused && active >= 0 ? comboboxOptionId(listId, active) : undefined,
    onActiveChange: setActive,
    onChoose: choose,
    onEnter: () => setShut(false),
    onEscape: () => setShut(true),
    // Note that an arrow pressed with the stack shut opens it again, on the line it last stood on.
    onKey: (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") setShut(false);
    },
  });

  const selected = open && focused ? active : -1;

  const lines = useMemo(
    () => marks.map((mark, index) => <RailLine key={mark.key} index={index} slots={slots} />),
    [marks],
  );

  const options = useMemo(
    () =>
      marks.map((mark, index) => (
        <StackOption
          key={mark.key}
          mark={mark}
          index={index}
          id={comboboxOptionId(listId, index)}
          selected={index === selected}
          pills={pills}
          onChoose={choose}
        />
      )),
    [marks, listId, selected, choose],
  );

  // The line under the pointer, read off where the lines were laid out as the hover began.
  const point = (clientY: number) => {
    const read = layout.current ?? measure();

    if (read === undefined) return;
    const at = nearestLine(read.middles, clientY - read.top);

    if (at !== inFront.current) moveTo(at);
  };

  return (
    <nav
      ref={column}
      aria-label={RAIL_LABEL}
      className={COLUMN}
      onPointerEnter={(event) => {
        measure();
        point(event.clientY);
        setShut(false);
        setPointed(true);
      }}
      onPointerMove={(event) => point(event.clientY)}
      onPointerLeave={() => setPointed(false)}
    >
      <Bubble bubble={bubble} inset="left-ui-2 w-ui-20" />
      <button
        type="button"
        aria-label={PRESS_LABEL}
        className={PRESS}
        {...field.field}
        onKeyDown={(event) => field.onKeyDown(event)}
        onFocus={() => {
          measure();
          // Note that the stack is put at the focus's line here, since the keys may hold that line already, which no draw would move it to.
          const target = pointed ? inFront.current : lastShown(marks);

          moveTo(target);
          setActive(target);
          setShut(false);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onClick={() => {
          if (open) choose(inFront.current);
        }}
      >
        {lines}
      </button>
      <div
        ref={stack}
        id={listId}
        role="listbox"
        aria-label={RAIL_LABEL}
        // Note that the stack stands drawn while it is shut, so a reader is kept from it until it opens.
        aria-hidden={!open}
        className={STACK}
      >
        {options}
      </div>
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
