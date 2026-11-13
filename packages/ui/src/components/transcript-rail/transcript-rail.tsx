import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT } from "../../shadcn/dropdown-menu.js";
import { dropBelowStart, MENU_DETAIL, Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { OneLine } from "../one-line/one-line.js";
import { rovingItem, useRovingKeys } from "../roving-keys/roving-keys.js";

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
 * The pointer on the rail opens it into a list of its lines, each under its
 * sender's face and name with its words beside them, the row under the
 * pointer opening where the pointer stands; a press asks the caller to go
 * to that line (`onJump`). The list is one Tab stop, the arrows walking its
 * rows (`useRovingKeys`), and it opens as the keyboard reaches it too.
 *
 * A phone has no pointer to rest and no gutter to hover in, so there the
 * rail is one press, its lines a glance at where the reader stands, that
 * lists every line in a sheet (`Menu`), as the app's lists of people list
 * them: each under its sender's face and name, the caller's tag beside the
 * name (the reader's own badge, how long ago), and its words under them on
 * at most two lines.
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
  /** What stands beside its sender's name in a phone's list: the reader's own badge, how long ago it was sent. */
  readonly tag?: ReactNode;
  /** Whether its line stands in the view now, which the bubble wraps. */
  readonly shown: boolean;
}

/** What the rail is named for a reader, and what a phone's sheet is headed with. */
const RAIL_LABEL = "Messages to the agent";

/** The fewest lines a rail stands for. */
const FEWEST = 2;

/** The rail's column at the conversation's leading edge, taking the pointer only on its lines and its open list. */
const COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-24 items-center";

/** The lines, centered down the column, each at most a pitch tall and shrinking to a hairline's pitch where more stand than its height holds. */
const LINES = "pointer-events-auto flex max-h-full w-full flex-col py-ui-12";

const LINE_SLOT = "flex h-ui-8 min-h-ui-2 w-full shrink items-center pl-ui-6";

const LINE = "block h-ui-2 w-ui-12 rounded-ui-full bg-muted-foreground opacity-60";

/** The bubble round the lines in view: the column's whole height, clipped to them, so it glides on its clip rather than its size. */
const BUBBLE =
  "pointer-events-none absolute inset-y-0 rounded-ui-full bg-secondary ring-1 ring-border transition-[clip-path,opacity] duration-(--ui-duration-pane) ease-pane";

/** The list the rail opens into, standing over the rail on a menu's surface, its rows scrolling inside it. */
const LIST =
  "ui-transcript-rail-list absolute top-1/2 left-ui-4 flex max-h-[calc(100%-var(--spacing-ui-16))] w-popover-wide -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-menu border border-border-strong bg-background p-menu-inset text-foreground shadow-menu transition-[opacity,translate] duration-(--ui-duration-quick) ease-motion-exit";

const LIST_SHUT = "pointer-events-none -translate-x-ui-4 opacity-0";
const LIST_OPEN = "pointer-events-auto translate-x-0 opacity-100";

const ROW = cn(DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT, "ui-transcript-rail-row cursor-press");

/** A phone's rail: one press down the gutter, its lines a glance, opening the list of lines. */
const NARROW_COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-12 items-center";

const NARROW_PRESS =
  "pointer-events-auto flex max-h-full w-full cursor-press appearance-none flex-col items-start overflow-hidden border-0 bg-transparent p-0 py-ui-8 pl-ui-2";

const NARROW_SLOT = "flex h-ui-6 min-h-ui-2 shrink items-center";
const NARROW_LINE = "block h-ui-2 w-ui-8 rounded-ui-full bg-muted-foreground opacity-60";

/** Where the bubble stands down the column, in pixels from its top and its bottom; none where no line stands in view. */
interface BubbleClip {
  readonly top: number;
  readonly bottom: number;
}

/** What a reader hears a line as: who sent it, then its words. */
function markName(mark: TranscriptRailMark): string {
  return `${mark.sender}: ${mark.words}`;
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
      const top = from.offsetTop;
      const bottom = box.clientHeight - (to.offsetTop + to.offsetHeight);

      setClip((was) => (was?.top === top && was.bottom === bottom ? was : { top, bottom }));
    };

    read();
    const sized = new ResizeObserver(read);
    sized.observe(box);

    return () => sized.disconnect();
  }, [column, slots, first, last, marks.length]);

  return clip;
}

/** The bubble round the lines in view, placed across its column by `inset`. */
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
          : { clipPath: `inset(${clip.top}px 0 ${clip.bottom}px 0 round var(--radius-ui-full))` }
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
      <Bubble clip={clip} inset="left-0 w-ui-12" />
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
  const column = useRef<HTMLElement | null>(null);
  const slots = useRef<(HTMLElement | null)[]>([]);
  const list = useRef<HTMLDivElement | null>(null);
  // Where the pointer came onto the rail: the line it stood over, and its height on the screen.
  const arrival = useRef<{ index: number; y: number } | undefined>(undefined);
  const roving = useRovingKeys<HTMLElement>();
  const clip = useBubble(column, slots, marks);
  const open = pointed || focused;

  // Note that the list opens with the row of the line under the pointer under it, so the pointer lands on that line's row.
  useLayoutEffect(() => {
    const box = list.current;
    const at = arrival.current;

    if (!pointed || box === null || at === undefined) return;
    const row = box.children[at.index];

    if (!(row instanceof HTMLElement)) return;
    const boxTop = box.getBoundingClientRect().top;
    box.scrollTop = row.offsetTop + row.offsetHeight / 2 - (at.y - boxTop);
  }, [pointed]);

  const arrive = (event: React.PointerEvent<HTMLElement>) => {
    const index = slots.current.findIndex((slot) => {
      const box = slot?.getBoundingClientRect();

      return box !== undefined && event.clientY < box.bottom;
    });

    arrival.current = { index: index === -1 ? marks.length - 1 : index, y: event.clientY };
    setPointed(true);
  };

  return (
    <nav
      ref={(element) => {
        column.current = element;
        roving.ref(element);
      }}
      aria-label={RAIL_LABEL}
      className={COLUMN}
      data-roving={roving["data-roving"]}
      onKeyDown={roving.onKeyDown}
      onPointerEnter={arrive}
      onPointerLeave={() => setPointed(false)}
      onFocus={(event) => {
        roving.onFocus(event);
        setFocused(true);
      }}
      onBlur={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
          )
        ) {
          setFocused(false);
        }
      }}
    >
      <Bubble clip={clip} inset="left-ui-2 w-ui-20" />
      <div aria-hidden className={LINES}>
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
      </div>
      <div ref={list} className={cn(LIST, open ? LIST_OPEN : LIST_SHUT)}>
        {marks.map((mark) => (
          <button
            key={mark.key}
            type="button"
            aria-label={markName(mark)}
            aria-current={mark.shown ? "location" : undefined}
            className={ROW}
            {...rovingItem()}
            // Note that a press of the pointer takes no focus, so the list shuts once the pointer leaves it rather than staying open on the row pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onJump(mark.key)}
          >
            {mark.face === undefined ? null : <span className="flex flex-none">{mark.face}</span>}
            <OneLine className="min-w-0 flex-initial" words={mark.sender}>
              {mark.sender}
            </OneLine>
            <OneLine
              className="min-w-0 flex-[0_1000_auto] text-muted-foreground"
              words={mark.words}
            >
              {mark.words}
            </OneLine>
          </button>
        ))}
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
