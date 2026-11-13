import { type ReactNode, useState } from "react";
import { dropBelowStart, MENU_DETAIL, Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { rovingItem, useRovingKeys } from "../roving-keys/roving-keys.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * transcript-rail.tsx -- a map of the lines sent into a conversation, down its leading edge: a mark for each, the reader's own in the accent, a card on the pointer's rest, and a press that goes there.
 *
 * A long conversation with an agent buries the reader's own lines among
 * what teammates, other agents, GitHub, and automations send it, and
 * scrolling back for one's last ask is a hunt. The rail stands in the
 * conversation's leading gutter, as Codex's and T3 Code's do, one mark for
 * each line sent in, spaced evenly in the order they were sent rather than
 * by where they stand in the scroll, so every mark keeps a size a pointer
 * finds. The reader's own is a tick in the accent; anyone else's is a quiet
 * dot, so the reader's stand out at a glance among the rest. A mark whose
 * line stands in the view is lit, so the rail says where the reader is.
 *
 * The pointer resting on a mark hangs its card beside it, which the caller
 * draws (`cardOf`), and the ticks near the pointer widen as a Dock's icons
 * do, the one under it the widest, so the pointer sees which it is on. A
 * press asks the caller to go to that line (`onJump`). The rail is one Tab
 * stop, the arrows walking its marks (`useRovingKeys`), each named by who
 * sent it and its words.
 *
 * A phone has no pointer to rest and no gutter to hover in, so there the
 * rail is one press, its marks a glance at where the reader stands, that
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
  /** Whether the reader sent it, which marks it as a tick in the accent; anyone else's is a dot. */
  readonly own: boolean;
  /** Who sent it, as a reader hears it and a phone's list names them. */
  readonly sender: string;
  /** Its words, as a reader hears them and a phone's list shows them, on one line. */
  readonly words: string;
  /** Its sender's face, which leads its row in a phone's list. */
  readonly face?: React.JSX.Element | undefined;
  /** What stands beside its sender's name in a phone's list: the reader's own badge, how long ago it was sent. */
  readonly tag?: ReactNode;
  /** Whether its line stands in the view now, which lights its mark. */
  readonly shown: boolean;
}

/** What the rail is named for a reader, and what a phone's sheet is headed with. */
const RAIL_LABEL = "Messages to the agent";

/** The fewest lines a rail stands for. */
const FEWEST = 2;

/**
 * The rail's column at the conversation's leading edge, taking the pointer
 * only on its marks, and the marks in it, centered down it, each at most a
 * pitch tall and shrinking to a hairline's pitch where more stand than its
 * height holds.
 */
const COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-24 items-center";

const MARKS = "pointer-events-auto flex max-h-full w-full flex-col py-ui-12";

const MARK =
  "ui-transcript-rail-mark flex h-ui-8 min-h-ui-2 w-full shrink cursor-press appearance-none items-center border-0 bg-transparent p-0 pl-ui-6";

/**
 * A tick, the reader's own: a hairline as wide as the widest step, drawn at
 * its step's share from its leading end, so it widens on the transform
 * alone; and a dot, anyone else's. Both lit where their line stands in the
 * view or the pointer is on them, and quiet otherwise.
 */
const TICK =
  "ui-transcript-rail-tick block h-ui-2 w-ui-24 origin-left rounded-ui-full bg-accent-fill transition-[scale,opacity] duration-(--ui-duration-hover) ease-motion-exit";

const DOT =
  "ui-transcript-rail-dot block size-ui-4 rounded-ui-full bg-muted-foreground transition-opacity duration-(--ui-duration-hover) ease-motion-exit";

/** A tick's width by its distance from the mark under the pointer, as a share of the widest: the one under it, its neighbors, theirs. */
const TICK_NEAR = ["scale-x-100", "scale-x-66", "scale-x-50"] as const;

/** A tick's width at rest. */
const TICK_REST = "scale-x-33";

/** A mark's ink as lit or quiet, the reader's own stronger than anyone else's. */
const LIT = { OWN: "opacity-100", OTHER: "opacity-80" } as const;
const QUIET = { OWN: "opacity-60", OTHER: "opacity-40" } as const;

/** A phone's rail: one press down the gutter, its marks a glance, opening the list of lines. */
const NARROW_COLUMN =
  "ui-transcript-rail pointer-events-none absolute inset-y-0 left-0 z-1 flex w-ui-12 items-center";

const NARROW_PRESS =
  "pointer-events-auto flex max-h-full w-full cursor-press appearance-none flex-col items-start overflow-hidden border-0 bg-transparent p-0 py-ui-8 pl-ui-2";

const NARROW_MARK = "flex h-ui-6 min-h-ui-2 shrink items-center";
const NARROW_TICK = "block h-ui-2 w-ui-8 rounded-ui-full bg-accent-fill";

/** The width class of a tick at `distance` marks from the one under the pointer, none where the pointer is on none. */
function tickWidth(distance: number | undefined): string {
  return distance === undefined ? TICK_REST : (TICK_NEAR[distance] ?? TICK_REST);
}

/** What a reader hears a mark as: who sent it, then its words. */
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

/** A mark as the rail draws it: a tick of the reader's, widened by the pointer's nearness, or a dot of anyone else's. */
function MarkGlyph({
  mark,
  distance,
}: {
  mark: TranscriptRailMark;
  distance: number | undefined;
}): React.JSX.Element {
  const lit = mark.shown || distance === 0;

  if (!mark.own) return <span className={`${DOT} ${lit ? LIT.OTHER : QUIET.OTHER}`} />;

  return <span className={`${TICK} ${tickWidth(distance)} ${lit ? LIT.OWN : QUIET.OWN}`} />;
}

/** A phone's rail: the marks as a glance, one press listing every line in a sheet. */
function NarrowRail({
  marks,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  onJump: (key: string) => void;
}): React.JSX.Element {
  const menu = useMenu(true);

  return (
    <div className={NARROW_COLUMN}>
      <button
        type="button"
        aria-label={RAIL_LABEL}
        className={NARROW_PRESS}
        {...menu.trigger(dropBelowStart)}
      >
        {marks.map((mark) => (
          <span key={mark.key} className={NARROW_MARK}>
            {mark.own ? (
              <span className={`${NARROW_TICK} ${mark.shown ? LIT.OWN : QUIET.OWN}`} />
            ) : (
              <span className={`${DOT} ${mark.shown ? LIT.OTHER : QUIET.OTHER}`} />
            )}
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

/** The rail beside a conversation: a mark for each line sent into it, its card the caller's, a press going to its line. */
export function TranscriptRail({
  marks,
  narrow,
  cardOf,
  onJump,
}: {
  marks: readonly TranscriptRailMark[];
  /** Whether the window stands in a phone's room, where the rail is one press listing its lines; the caller's, so the rail turns as the room does. */
  narrow: boolean;
  /** The card a mark hangs while the pointer rests on it or the keyboard holds it. */
  cardOf: (key: string) => ReactNode;
  /** Goes to the line a mark stands for. */
  onJump: (key: string) => void;
}): React.JSX.Element | null {
  const [near, setNear] = useState<number | undefined>(undefined);
  const roving = useRovingKeys<HTMLElement>();

  if (marks.length < FEWEST) return null;

  if (narrow) return <NarrowRail marks={marks} onJump={onJump} />;

  return (
    <div className={COLUMN}>
      <nav
        aria-label={RAIL_LABEL}
        className={MARKS}
        data-roving={roving["data-roving"]}
        ref={roving.ref}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
        onPointerLeave={() => setNear(undefined)}
      >
        {marks.map((mark, index) => (
          <Tooltip key={mark.key} label={markName(mark)} card={cardOf(mark.key)} cardBeside>
            <button
              type="button"
              aria-label={markName(mark)}
              aria-current={mark.shown ? "location" : undefined}
              className={MARK}
              data-own={mark.own ? "true" : undefined}
              {...rovingItem()}
              onPointerEnter={() => setNear(index)}
              onFocus={() => setNear(index)}
              onBlur={() => setNear(undefined)}
              onClick={() => onJump(mark.key)}
            >
              <MarkGlyph
                mark={mark}
                distance={near === undefined ? undefined : Math.abs(index - near)}
              />
            </button>
          </Tooltip>
        ))}
      </nav>
    </div>
  );
}
