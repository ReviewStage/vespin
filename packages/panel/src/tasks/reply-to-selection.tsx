import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Button, MENU_SURFACE_FLOW, MenuSurface, Tooltip, useWait } from "@repo/ui";
import { clipsAround, cutTo as cutToClips } from "@repo/ui/clip-room";
import { replyOf } from "@repo/ui/reply-quote";
import { type ViewportBox, visibleViewport } from "@repo/ui/visible-viewport";
import { Duration, Effect } from "effect";
import { ReplyIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import { coarsePointerNow, FINGER_SELECTION_GAP } from "../coarse-pointer.js";
import { selectedMarkdown } from "./selection-markdown.js";

/**
 * reply-to-selection.tsx -- words selected in an agent's message answered from its message box: Reply over the selection, and the quote block it lays into the box.
 *
 * Every chat that does this, ChatGPT's "Ask ChatGPT" and Claude's Reply,
 * offers a press beside the words once they are selected. Here the press
 * lays them into the message box as a quote block where the caret stands,
 * as email and GitHub let a reply quote what it answers, so a message can
 * answer several points, each under its quote, or several quotes at once.
 * A selection inside an agent's own words, a text part of one of its
 * messages, which wears `REPLY_SCOPE`, never a call's output or a thought
 * beside it, stands Reply over it once the pointer or the keys let it go,
 * or, on a touch screen, once it has rested for `SELECTION_SETTLE`, since
 * the handles a finger drags it by may let go with no pointerup on iOS;
 * there it stands under the words, where the system's own selection menu
 * does not (`coarse-pointer.ts`). The words are read as the Markdown they
 * were drawn from, their marks and each chip as its link
 * (`selection-markdown.tsx`), never as the selection's bare words, which
 * lose both. A press hands the words to the box
 * (`AgentComposer`'s `replyDoor`), whose editor lays them in as a quote
 * like one typed with `> ` (`insertQuote`), and sends them as a Markdown blockquote set apart
 * by a blank line (`@repo/ui/reply-quote`). The press is drawn over the window, not inside
 * the transcript, but stands as though it were inside it, as ChatGPT's and
 * Medium's do: it keeps the side it was offered on while the log scrolls,
 * carried with the words, and is cut at the edges of what can be seen of
 * the log (`roomAround`), so it slides under the pane's head with them
 * rather than jumping under the words or standing over the window's own
 * bars. It goes as the selection does. Note that
 * the press takes no focus and leaves the selection as it was until it is
 * pressed, because a press that took either would end what it answers.
 * While it stands, R does what the press does (`APP_COMMAND.REPLY_TO_SELECTION`),
 * as GitHub's R quotes words selected into a reply, its hover saying so.
 * An Inbox item's thread offers the same Reply over every word it draws
 * but the reader's draft: its title, the agent's messages and its
 * members', what an ask offers, an option's words, a step, a field's name,
 * how an answer left it, and what became of it, and lays the quote into
 * the item's box (`inbox-pane.tsx`, `inbox-answer-box.tsx`), so the press
 * hands on the words it was over beside the reply. A page an agent showed,
 * drawn live in its transcript or an Inbox thread (`shown-page.tsx`),
 * offers the same Reply over words selected in its frame, which the frame
 * says where they stand (`@repo/features/page-pick`), and lays them into
 * that place's box through `ReplyDoorProvider`, so it is offered only where
 * a box takes them. Note that
 * a selection reaching into a field, an input or an editor, is never
 * offered, because what it holds is the reader's own typing, not words to
 * answer.
 */

/** The attribute that marks words a selection inside may be replied to: an agent's own in a transcript, and an Inbox thread's. */
export const REPLY_SCOPE = "data-reply-scope";

const SCOPE_SELECTOR = `[${REPLY_SCOPE}]`;

const ReplyDoorContext = createContext<((reply: string) => void) | undefined>(undefined);

/** Hands what is drawn under it the door a reply's words are laid into the message box through; none while the box takes no change. */
export const ReplyDoorProvider = ReplyDoorContext.Provider;

/** The door a reply's words are laid into the message box through, where one stands. */
export function useReplyDoor(): ((reply: string) => void) | undefined {
  return useContext(ReplyDoorContext);
}

/** What the reader types into, whose words a selection reaching into is not offered. */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** What the press is called, which is its name and its hint. */
const REPLY_WORDS = {
  REPLY: "Reply",
} as const;

/** How far the press stands off the selection, and the least room it keeps from the window's sides. */
const PRESS_GAP = 6;
const PRESS_MARGIN = 48;

/** The room the press needs over the selection, under which it stands below instead. */
const PRESS_ROOM = 40;

/**
 * How long a finger's selection rests unchanged before Reply is offered
 * over it: past the pauses of a handle being dragged, so the press does not
 * stand up under the finger mid-drag, and short of a wait one notices.
 */
const SELECTION_SETTLE = Duration.millis(300);

/** A finger's selection settling: once the wait runs out, `offer` is called. */
function selectionSettled(offer: () => void): Effect.Effect<void> {
  return Effect.andThen(Effect.sleep(SELECTION_SETTLE), Effect.sync(offer));
}

/** A selection Reply answers: its words as the reply, the words it lies in, and where the press stands. */
interface Picked extends PressPlace {
  readonly reply: string;
  readonly words: Element;
}

/**
 * Whether a selection reaches into a field under `words`: one it lies in,
 * or one it runs across, as a selection inside an input is told around it.
 */
function reachesField(words: Element, range: Range): boolean {
  const common = range.commonAncestorContainer;
  const at = common instanceof Element ? common : common.parentElement;
  if (at !== null && at.closest(EDITABLE_SELECTOR) !== null) return true;
  return [...words.querySelectorAll(EDITABLE_SELECTOR)].some((field) =>
    range.intersectsNode(field),
  );
}

/** The run of words a reply may quote that `node` lies in, if any. */
function scopeOf(node: Node): Element | null {
  return (node instanceof Element ? node : node.parentElement)?.closest(SCOPE_SELECTOR) ?? null;
}

/** Whether `range` holds words of `text` a selection takes: more than spaces, in an element the reader may select. */
function takesWords(text: Text, range: Range): boolean {
  const from = text === range.startContainer ? range.startOffset : 0;
  const to = text === range.endContainer ? range.endOffset : text.length;
  if (text.data.slice(from, to).trim() === "" || text.parentElement === null) return false;
  const style = getComputedStyle(text.parentElement);
  // Note that WebKit answers the property by its prefixed name alone.
  return (style.userSelect || style.webkitUserSelect) !== "none";
}

/**
 * `range` cut to what it holds of `words`, or nothing where it takes words
 * past them: as a triple-click's selection of a run's last paragraph does
 * not, though it runs on to the start of the next block, past what no
 * selection takes, such as the letter of the next comment's avatar.
 */
function cutTo(words: Element, range: Range): Range | undefined {
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && !words.contains(node) && range.intersectsNode(node)) {
      if (takesWords(node, range)) return undefined;
    }
  }
  const cut = range.cloneRange();
  if (!words.contains(range.endContainer)) cut.setEnd(words, words.childNodes.length);
  return cut;
}

/**
 * What can be seen of the window around `element`: the visible viewport cut
 * to each box that clips it, the log that scrolls it say, which Reply by its
 * words keeps to.
 */
export function roomAround(element: Element): ViewportBox {
  const seen = visibleViewport();
  return element instanceof HTMLElement ? cutToClips(seen, clipsAround(element)) : seen;
}

/**
 * The selection inside one run of words a reply may quote under `scope`, as
 * Reply answers it, on the side `kept` where Reply already stands; nothing
 * for any other.
 */
function pickedIn(scope: HTMLElement, kept?: Picked): Picked | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const whole = selection.getRangeAt(0);
  const words = scopeOf(whole.commonAncestorContainer) ?? scopeOf(whole.startContainer);
  if (words === null || !scope.contains(words)) return undefined;
  const range = cutTo(words, whole);
  if (range === undefined) return undefined;
  // Note that words a hidden pane holds keep their selection, as the narrow Inbox's item does behind its list, but are no longer on screen to reply to.
  if (words.closest("[hidden]") !== null) return undefined;
  if (reachesField(words, range)) return undefined;
  const reply = replyOf(selectedMarkdown(range));
  if (reply === "") return undefined;
  const box = range.getBoundingClientRect();
  return { reply, words, ...pressPlace(box, roomAround(words), kept?.below) };
}

/** Where Reply stands by words drawn in a box of the window, the middle of its edge, kept in from the sides of what can be seen of them. */
export interface PressPlace {
  readonly left: number;
  readonly top: number;
  /** Whether it stands under the words rather than over them. */
  readonly below: boolean;
  /** What can be seen of the words, past whose top and bottom the press is cut as they are. */
  readonly room: ViewportBox;
}

/**
 * Where Reply stands by words drawn in `box`, in window coordinates, inside
 * `room`, what can be seen of them: over them, or under where the room above
 * runs short or a finger made the selection. Note that a press already
 * standing keeps its side (`kept`), as the log scrolls say, because a press
 * that turned to the other side as the words neared the room's edge would
 * jump across them; it is cut at the edge with them instead.
 */
export function pressPlace(
  box: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
  room: ViewportBox,
  kept?: boolean,
): PressPlace {
  // Note that a finger's press stands under the words, clear of the system's menu over them, unless the room ends first.
  const touch = coarsePointerNow();
  const finger = touch && box.bottom + FINGER_SELECTION_GAP + PRESS_ROOM <= room.bottom;
  const below = kept ?? (finger || box.top - room.top < PRESS_ROOM);
  const gap = touch ? FINGER_SELECTION_GAP : PRESS_GAP;
  const center = (box.left + box.right) / 2;
  return {
    left: Math.min(Math.max(center, room.left + PRESS_MARGIN), room.right - PRESS_MARGIN),
    top: below ? box.bottom + gap : box.top - PRESS_GAP,
    below,
    room,
  };
}

/**
 * Reply over words selected under `scope` that a reply may quote, handing
 * them to `onReply` as pressed, with the words they were picked from;
 * nothing while no such selection stands.
 */
export function ReplyToSelection({
  scope,
  onReply,
}: {
  scope: RefObject<HTMLElement | null>;
  onReply: (reply: string, words: Element) => void;
}): ReactNode {
  const [picked, setPicked] = useState<Picked | undefined>(undefined);
  const shown = picked !== undefined;
  // Note that each change starts the wait over, and the press's going calls it off.
  const settle = useWait();

  // A selection is offered once the pointer or the keys let it go, or a finger's once it rests, never while it is being drawn.
  useEffect(() => {
    const element = scope.current;
    if (element === null) return undefined;
    const offer = () => setPicked(pickedIn(element));
    // Note that a mouse's selection waits for its pointerup as ever, so only a finger's is offered on resting,
    // and a mouse's drag is never measured as it goes.
    const changed = () => {
      if (coarsePointerNow() && pickedIn(element) !== undefined)
        settle.start(selectionSettled(offer));
    };
    element.addEventListener("pointerup", offer);
    element.addEventListener("keyup", offer);
    document.addEventListener("selectionchange", changed);
    return () => {
      element.removeEventListener("pointerup", offer);
      element.removeEventListener("keyup", offer);
      document.removeEventListener("selectionchange", changed);
    };
  }, [scope, settle]);

  // Once offered, the press follows the selection as the log scrolls and goes as it does, or as the pane holding it is hidden.
  useEffect(() => {
    const element = scope.current;
    if (!shown || element === null) return undefined;
    const follow = () => setPicked((standing) => pickedIn(element, standing));
    // Note that hiding a pane changes no selection, so its `hidden` attribute is watched for itself.
    const hiding = new MutationObserver(follow);
    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    document.addEventListener("selectionchange", follow);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      hiding.disconnect();
      document.removeEventListener("selectionchange", follow);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [scope, shown]);

  const reply =
    picked === undefined
      ? undefined
      : () => {
          setPicked(undefined);
          window.getSelection()?.removeAllRanges();
          onReply(picked.reply, picked.words);
        };
  useAppCommand(APP_COMMAND.REPLY_TO_SELECTION, reply);

  if (picked === undefined || reply === undefined) return null;
  return <ReplyPress place={picked} onReply={reply} />;
}

/**
 * Reply standing by words selected, where `pressPlace` put it, over
 * everything in the window but cut at the top and bottom of what can be seen
 * of the words, so it scrolls out of sight with them; a press hands the reply on.
 */
export function ReplyPress({
  place,
  onReply,
  layer,
}: {
  place: PressPlace;
  onReply: () => void;
  /** The box it stands in, for an owner that hears a press away from it. */
  layer?: RefObject<HTMLDivElement | null> | undefined;
}): React.JSX.Element {
  const { room } = place;
  return createPortal(
    <div
      className="reply-to-selection-room pointer-events-none fixed inset-x-0 z-menu overflow-clip"
      style={{ top: room.top, height: Math.max(0, room.bottom - room.top) }}
    >
      <MenuSurface
        ref={layer}
        flow={MENU_SURFACE_FLOW.TOOLBAR}
        className="reply-to-selection pointer-events-auto absolute -translate-x-1/2 -translate-y-full data-below:translate-y-0"
        data-below={place.below ? "" : undefined}
        style={{ left: place.left, top: place.top - room.top }}
      >
        <Tooltip label={REPLY_WORDS.REPLY} command={APP_COMMAND.REPLY_TO_SELECTION}>
          <Button
            icon={<ReplyIcon aria-hidden="true" />}
            // Note that the press keeps the selection and the focus where they stand until it lands.
            keepFocus
            onPointerDown={(event) => event.preventDefault()}
            onClick={onReply}
          >
            {REPLY_WORDS.REPLY}
          </Button>
        </Tooltip>
      </MenuSurface>
    </div>,
    document.body,
  );
}
