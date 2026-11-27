import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { cssCustomProperties } from "../../css.js";
import { ArrowDownIcon } from "../../icons/icons.js";
import { BUTTON_CORNERS, BUTTON_VARIANT, IconButton } from "../button/button.js";
import { useEndAnchor } from "../end-anchor/end-anchor.js";
import { Fill } from "../layout/layout.js";
import { ScrollArea } from "../scroll-area/scroll-area.js";
import { Tooltip } from "../tooltip/hint.js";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "../virtual-rows/virtual-rows.js";

/**
 * conversation.tsx -- AI Elements' Conversation: a log of messages that keeps to its newest line while the reader is there.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to our tokens. One change of substance: the registry's
 * Conversation scrolls on `use-stick-to-bottom`, which animates the scroll
 * on timings of its own, where docs/DESIGN.md has content land at once. So
 * the log here draws its lines through `ConversationRows`, TanStack
 * Virtual's run (`@repo/ui/virtual-rows`), and keeps to its newest line
 * through `@repo/ui/end-anchor`, the registry's contract without its
 * animation: the log opens at its end and keeps to it, whatever lands,
 * grows, or moves it, until the reader scrolls away, and lines put before
 * the first leave the reader's place where it was. The context the children
 * read is the registry's: whether the log keeps to its end (`stuck`), and a
 * way back there (`stick`).
 *
 * As the guide's log does, the log's scroll box holds nothing after the
 * rows: a line that stands after the messages, as an agent's working line
 * does, is drawn inside the last of them, which grows as the guide's
 * streaming reply grows, or is the run's last row, as an Inbox thread's
 * reply box is; and the log's room at its end is the virtualizer's own (`paddingEnd`), read from the theme (`--conversation-log-end`, a
 * length the stylesheet registers), and, where something floats over the
 * log's end, as the apps' windows an agent is using do, that much more
 * (`overEnd`), above which the way back to the newest line stands. The log
 * goes back to its end as the reader's own line lands (`ownLast`), as the
 * guide's example does on a send, and lets go of it as it is scrolled for
 * the reader to one of its lines (its handle's `bringIn` and `scrollBy`).
 *
 * The log scrolls in `@repo/ui`'s `ScrollArea`, and holds its lines in one
 * block of its own inside it
 * (`.conversation-log`), which carries the log's padding. That block is
 * not a flex column. A flex item of a container with a definite height has
 * a definite height of its own once flexed, so a percentage height anywhere
 * inside a message would resolve against the message rather than fall back
 * to its content; a block child keeps the height it draws, whatever is
 * inside it.
 */

/** The theme's room at a log's end (`conversation.css`), registered as a length so it reads in pixels. */
const LOG_END_PROPERTY = "--conversation-log-end";

/** How near its top, in screens of the box, a log asks for the lines older than its first (`onNearTop`): one, so they land before the reader reaches them. */
const NEAR_TOP_SCREENS = 1;

interface ConversationScroll {
  /** Whether the log keeps to its end (`@repo/ui/end-anchor`). */
  readonly stuck: boolean;
  /** Takes the log to its end and keeps it there. */
  readonly stick: () => void;
  /** Lets go of the end, as the log is scrolled for the reader to one of its lines. */
  readonly release: () => void;
  /** The room, in pixels, what floats over the log's end takes (`overEnd`). */
  readonly overEnd: number;
  /** The scroll box, which `ConversationContent` is. */
  readonly list: RefObject<HTMLDivElement | null>;
  /** The block the lines stand in inside the scroll box, which says the log's room at its end (`--conversation-log-end`). */
  readonly log: RefObject<HTMLDivElement | null>;
  /** The log's room at its end, in pixels, as its block last said it (`ConversationContent`). */
  readonly logEnd: number;
  /** Says the log's room at its end, as its block reads it from the theme. */
  readonly sayLogEnd: (room: number) => void;
  /** Holds the log's run of lines while it stands (`ConversationRows`); the answer lets it go. */
  readonly hold: (rows: RefObject<VirtualRowsHandle | null>) => () => void;
  /** Asks for older lines where the reader is near the top, or the lines do not fill the box. */
  readonly askOlder: () => void;
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const ConversationContext = createContext<ConversationScroll | undefined>(undefined);

function useConversation(): ConversationScroll {
  const context = useContext(ConversationContext);

  if (context === undefined)
    throw new Error("Conversation components must be used within Conversation");

  return context;
}

export type ConversationProps = ComponentProps<"div"> & {
  /** The scroll box's ref, where the caller reads the box too; one of the log's own where none is handed. */
  list?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * Asked for the lines older than its first, once the reader nears its top
   * or its lines do not fill it; none where no older lines stand. Lines put
   * before the first keep the reader's place.
   */
  onNearTop?: (() => void) | undefined;
  /**
   * The room, in pixels, what floats over the log's end takes, as the apps'
   * windows an agent is using do; none where nothing does. The log's end
   * makes that much more room, the way back to the newest line stands above
   * it, and a log standing at its end keeps to it as the room changes.
   */
  overEnd?: number | undefined;
};

export function Conversation({
  className,
  children,
  list: handed,
  onNearTop,
  overEnd = 0,
  style,
  ...props
}: ConversationProps): ReactNode {
  const own = useRef<HTMLDivElement>(null);
  const list = handed ?? own;
  const log = useRef<HTMLDivElement>(null);
  // The log's room at its end, as its block says it (`ConversationContent`).
  const [logEnd, setLogEnd] = useState(0);

  const sayLogEnd = useCallback(
    (room: number) => setLogEnd((was) => (was === room ? was : room)),
    [],
  );

  // The log's run of lines, while one stands.
  const rows = useRef<RefObject<VirtualRowsHandle | null> | undefined>(undefined);

  // The log is taken to its end by its run where one stands, so the virtualizer stays the one writer of its place.
  const toEnd = useCallback(() => {
    const run = rows.current?.current;

    if (run === null || run === undefined) return false;
    run.scrollToEnd();

    return true;
  }, []);

  const { stuck, stick, release } = useEndAnchor({ scroller: list, content: log, toEnd });

  // Note that a run standing anew opens at its end, as an Inbox item's thread does in the box the item before it was scrolled in.
  const hold = useCallback(
    (run: RefObject<VirtualRowsHandle | null>) => {
      rows.current = run;
      stick();

      return () => {
        if (rows.current === run) rows.current = undefined;
      };
    },
    [stick],
  );

  // Where the log last stood, so a scroll is read as up or down from there.
  const lastTop = useRef(0);
  const nearTop = useRef(onNearTop);
  nearTop.current = onNearTop;

  const askOlder = useCallback(() => {
    const element = list.current;

    if (element === null) return;
    // Note that a scroll past the top, as Safari's bounce reports, is no place the reader stands, as the docs' example says.
    const top = element.scrollTop;

    if (top >= 0 && top <= element.clientHeight * NEAR_TOP_SCREENS) nearTop.current?.();
  }, [list]);

  // Note that the log asks as it opens too, since lines drawn before its scroll box stood asked of no box,
  // and a log that opens on all its lines draws none anew; its own effects run once its box's ref is set.
  useLayoutEffect(() => {
    askOlder();
  }, [askOlder]);

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const up = element.scrollTop < lastTop.current;
      lastTop.current = element.scrollTop;

      if (up) askOlder();
    },
    [askOlder],
  );

  const scroll = useMemo<ConversationScroll>(
    () => ({
      stuck,
      stick,
      release,
      overEnd,
      list,
      log,
      logEnd,
      sayLogEnd,
      hold,
      askOlder,
      onScroll,
    }),
    [stuck, stick, release, overEnd, list, logEnd, sayLogEnd, hold, askOlder, onScroll],
  );

  return (
    <ConversationContext value={scroll}>
      <Fill
        className={cn("conversation relative", className)}
        style={{
          ...style,
          ...cssCustomProperties({ "--conversation-over-end": `${String(overEnd)}px` }),
        }}
        {...props}
      >
        {children}
      </Fill>
    </ConversationContext>
  );
}

export interface ConversationContentProps {
  /** The pane's own class on the block the lines stand in, which holds the log's padding. */
  className?: string | undefined;
  /**
   * Whether its lines are written as they stream in, as an agent's reply is,
   * so the log is no live region: a reader would hear each chunk as it
   * landed, and its owner says the line once it is whole instead.
   */
  streams?: boolean | undefined;
  children?: ReactNode;
}

/** The scroll box, a log of what follows, its lines in one block inside it. */
export function ConversationContent({
  className,
  streams = false,
  children,
}: ConversationContentProps): ReactNode {
  const { list, log, onScroll, sayLogEnd } = useConversation();
  // The log's room at its end, as the theme says it for the class its block wears, in pixels: a registered length, so it reads as one.
  // Note that it is read as the block stands and as its class changes, never on each render, because a style read just after React's changes makes the window restyle and lay out there and then: once for every write an agent's stream makes, and once for every key typed.
  useLayoutEffect(() => {
    const element = log.current;

    if (element === null) return;
    const said = Number.parseFloat(getComputedStyle(element).getPropertyValue(LOG_END_PROPERTY));
    sayLogEnd(Number.isFinite(said) ? said : 0);
  }, [className, log, sayLogEnd]);

  return (
    <ScrollArea ref={list} role="log" aria-live={streams ? "off" : undefined} onScroll={onScroll}>
      <div ref={log} className={cn("conversation-log px-content-inset pt-section-gap", className)}>
        {children}
      </div>
    </ScrollArea>
  );
}

/**
 * The log's lines, drawn only near the view (`@repo/ui/virtual-rows`), in
 * the log's own scroll box. The log keeps to its newest line as its header
 * says, and the run keeps the reader's place as lines land before its first.
 */
export function ConversationRows({
  keys,
  estimate,
  gap,
  overscan,
  listItems = false,
  className,
  rowClassName,
  "aria-label": label,
  handle,
  ownLast,
  children,
}: {
  keys: readonly string[];
  /** The height a line is taken to have before it is drawn, in pixels. */
  estimate: number;
  /** The room between two lines, in pixels. */
  gap: number;
  /** How many lines past each edge of the view are drawn. */
  overscan?: number | undefined;
  /** Whether each line is a list item of the caller's own, wearing the place it is handed (`VirtualRows`' `listItems`). */
  listItems?: boolean;
  className?: string | undefined;
  /** The class each line wears, or the class the line at an index wears. */
  rowClassName?: string | ((index: number) => string) | undefined;
  /** What the lines are called, to a reader. */
  "aria-label"?: string | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  /** The key of the reader's own newest line, which takes the log to its end as it lands; none where the reader has written none. */
  ownLast?: string | undefined;
  /** Draws the line at an index, which wears `place` where the lines are list items of the caller's own. */
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): ReactNode {
  const { list, hold, askOlder, stick, release, overEnd, logEnd } = useConversation();
  const run = useRef<VirtualRowsHandle>(null);
  useLayoutEffect(() => hold(run), [hold]);
  // The reader's own line landing takes the log back to its end; the line the log opened on does not, since the log opens there.
  const sent = useRef(ownLast);
  useLayoutEffect(() => {
    const was = sent.current;
    sent.current = ownLast;

    if (ownLast !== undefined && was !== undefined && ownLast !== was) stick();
  }, [ownLast, stick]);
  // Note that a scroll the caller asks for away from the end lets go of it first, so the log stays where it was taken; one to the end keeps to it.
  useImperativeHandle(handle, () => {
    const now = () => run.current;

    return {
      bringIn: (key, then) => {
        const lines = now();

        if (lines === null || !lines.keys().includes(key)) return false;
        release();

        return lines.bringIn(key, then);
      },
      rowElement: (key) => now()?.rowElement(key),
      drawnKeys: () => now()?.drawnKeys() ?? [],
      keys: () => now()?.keys() ?? [],
      scrollToEnd: stick,
      scrollBy: (delta) => {
        release();
        now()?.scrollBy(delta);
      },
    };
  }, [stick, release]);
  // Note that the lines changing may leave the box unfilled, which no scroll would say.
  useLayoutEffect(() => {
    askOlder();
  }, [keys, askOlder]);

  return (
    <VirtualRows
      scroller={list}
      anchor={VIRTUAL_ROWS_ANCHOR.END}
      keys={keys}
      estimate={estimate}
      gap={gap}
      overscan={overscan}
      listItems={listItems}
      className={className}
      rowClassName={rowClassName}
      aria-label={label}
      handle={run}
      paddingEnd={logEnd + overEnd}
    >
      {children}
    </VirtualRows>
  );
}

/** What the log says instead of messages: a wait, or the line the caller draws, on a wider measure where `wide` says so. */
export function ConversationEmptyState({
  wide = false,
  children,
}: {
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cn(
        "conversation-empty m-auto flex max-w-conversation-empty flex-col items-center justify-center gap-block-gap p-card text-center text-body text-muted-foreground",
        wide && "max-w-conversation-empty-wide",
      )}
    >
      {children}
    </div>
  );
}

/**
 * What the log says at its top before its first line lands, as a line on
 * its way's working line, standing on the log's own inset where that line
 * will, so it stands still whatever docks over the composer. Its words are
 * no live region, since a working line says itself.
 */
export function ConversationLead({
  className,
  children,
}: {
  /** The pane's own class on the block the line stands in, as the log's. */
  className?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <Conversation>
      <ConversationContent className={className} streams>
        {children}
      </ConversationContent>
    </Conversation>
  );
}

/**
 * What floats over a log in a slot of its own, centered across it, on a
 * ground of its own ringed and lifted off the lines: the line saying earlier
 * lines could not be read, over its top, so it moves no row of the log as it
 * comes and goes.
 */
export const FLOATING_OVER_LOG_CLASS =
  "absolute left-1/2 -translate-x-1/2 rounded-control shadow-floating-edge";

/** What the way back to the newest line is called, as its hint and its name. */
const SCROLL_LABEL = "Scroll to the newest line";

/**
 * The way back to the newest line, shown while the reader has scrolled away
 * from it: the shared icon button, round, floating over the lines on a
 * ground of its own in the log's bottom right corner, as phone chat apps
 * stand theirs, so it covers at most a line's end rather than the middle of
 * the words, or a reply box being typed in. It stands in the log's column,
 * its center over the composer's send button below it.
 */
export function ConversationScrollButton(): ReactNode {
  const { stuck, stick } = useConversation();

  if (stuck) return null;

  return (
    // Its ground is the button's own (`--ui-button-ground`), which the button's lit fill is laid over as a title bar's is.
    <div className="conversation-scroll absolute right-conversation-scroll-end bottom-conversation-scroll flex rounded-disc bg-button-ground shadow-floating-edge [--ui-button-ground:var(--ui-color-well)]">
      <Tooltip label={SCROLL_LABEL}>
        <IconButton
          label={SCROLL_LABEL}
          corners={BUTTON_CORNERS.ROUND}
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ArrowDownIcon aria-hidden="true" />}
          onClick={stick}
        />
      </Tooltip>
    </div>
  );
}
