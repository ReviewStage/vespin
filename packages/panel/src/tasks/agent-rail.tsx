/**
 * agent-rail.tsx -- the rail beside an agent's transcript: a line for each line sent into it, a bubble round those in view, and a list of them, each under its sender's face, going to it on a press.
 *
 * A long run buries the reader's own asks among what teammates, other
 * agents, GitHub, and automations send the agent, so the transcript wears
 * `@repo/ui`'s `TranscriptRail` down its leading edge, a mark for each line
 * sent in (`sent-lines.ts`). Its list names each line as the app names a
 * person: their face and name, the reader's own under their own face as "You". A press
 * goes to the line as a link to a message does, bringing its row in where
 * the log has not drawn it and lighting it once it lands
 * (`message-links.tsx`).
 *
 * The bubble wraps the lines standing in the view, read off the rows the
 * log has drawn as it scrolls or it or its rows change size, the rail drawn
 * again only when which lines stand there changes. The rail marks the lines
 * of the pages the log holds and reads no page of its own: an older page's
 * lines join it as the log reads that page (`use-agent-transcript.ts`).
 */

import { QuietWords, TIME_LOOK, Time, TranscriptRail, type TranscriptRailMark } from "@repo/ui";
import { type Actor, actorName } from "@repo/ui/actor-model";
import { land } from "@repo/ui/landed";
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, BotBadge } from "../actor-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { usePhoneRoom } from "../stage-room.js";
import { drawnMessages, messageElement } from "./message-links.js";
import type { SentLine } from "./sent-lines.js";

/** What the rail names the reader by on their own lines, as a comment's head does. */
const READER_NAME = "You";

/** A line sent in, and the key of the log's row that draws it. */
export interface RailLine {
  readonly rowKey: string;
  readonly line: SentLine;
}

/** Whether two lists of keys hold the same keys in the same order. */
function sameKeys(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((key, at) => key === other[at]);
}

/** Whether `element` stands, in part, within `view`. */
function standsIn(element: HTMLElement, view: DOMRect): boolean {
  const box = element.getBoundingClientRect();

  return box.bottom > view.top && box.top < view.bottom;
}

/**
 * The messages of `lines` standing in `box`'s view, each by where its own
 * element stands, since a line that reached a turn while it ran shares the
 * turn's row and may stand far from the turn's part on screen. Note that a
 * row out of view is never drawn, so only the drawn rows are read, and a
 * line drawn by no element of its own, a continue's note, stands where its
 * row does.
 */
function linesInView(
  box: HTMLElement,
  rows: VirtualRowsHandle,
  lines: readonly RailLine[],
): readonly string[] {
  const view = box.getBoundingClientRect();
  const drawn = drawnMessages(box);

  return lines.flatMap(({ rowKey, line }) => {
    const element = drawn.get(line.messageId) ?? rows.rowElement(rowKey);

    return element !== undefined && standsIn(element, view) ? [line.messageId] : [];
  });
}

/**
 * The messages of `lines` standing in the log's view, read again once a
 * frame as it scrolls, as it or its rows change size, a row measured anew
 * among them, and as the lines change.
 */
function useLinesInView(
  list: RefObject<HTMLDivElement | null>,
  rows: RefObject<VirtualRowsHandle | null>,
  lines: readonly RailLine[],
): ReadonlySet<string> {
  const [inView, setInView] = useState<readonly string[]>([]);
  // Note that the lines a read takes are those the log last drew, kept once drawn, never a render's that may not be.
  const latest = useRef(lines);
  useLayoutEffect(() => {
    latest.current = lines;
  }, [lines]);

  const read = useCallback(() => {
    const box = list.current;
    const handle = rows.current;

    if (box === null || handle === null) return;
    const next = linesInView(box, handle, latest.current);
    setInView((was) => (sameKeys(was, next) ? was : next));
  }, [list, rows]);

  useEffect(() => {
    const box = list.current;

    if (box === null) return;
    let frame = 0;

    // Note that a scroll is read once a frame, however many it fires, since the rail's lights need no more.
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };

    box.addEventListener("scroll", soon, { passive: true });
    // Note that what the log holds is watched beside the log itself, since a row measured anew moves the rows under it without a scroll.
    const sized = new ResizeObserver(soon);
    sized.observe(box);

    for (const held of box.children) sized.observe(held);

    return () => {
      box.removeEventListener("scroll", soon);
      sized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [list, read]);
  // Note that new lines may move every row's place without a scroll, so they are read again as they land.
  useEffect(read, [lines, read]);

  return useMemo(() => new Set(inView), [inView]);
}

/** Scrolls the log by `rows` so `element` stands in the middle of `box`'s view. */
function centerIn(box: HTMLElement, rows: VirtualRowsHandle, element: HTMLElement): void {
  const view = box.getBoundingClientRect();
  const at = element.getBoundingClientRect();
  rows.scrollBy(at.top + at.height / 2 - (view.top + view.height / 2));
}

/**
 * What stands beside a line's sender in a phone's list, as a comment's head
 * says it: a GitHub App's badge on its line, then how long ago it was sent.
 */
function SheetTag({
  sender,
  sentAt,
}: {
  sender: Actor | undefined;
  sentAt: number | undefined;
}): React.JSX.Element {
  return (
    <>
      {sender === undefined ? null : <BotBadge actor={sender} />}
      {sentAt === undefined ? null : (
        <QuietWords>
          <Time at={sentAt} look={TIME_LOOK.SINCE} hint={false} />
        </QuietWords>
      )}
    </>
  );
}

/** The rail of the lines sent into an agent, beside its log `list`, whose rows `rows` holds; `bringIn` brings a message's row into view. */
export function AgentRail({
  lines,
  list,
  rows,
  bringIn,
}: {
  lines: readonly RailLine[];
  list: RefObject<HTMLDivElement | null>;
  rows: RefObject<VirtualRowsHandle | null>;
  bringIn: (messageId: string, then: (row: HTMLElement) => void) => boolean;
}): React.JSX.Element | null {
  const { readerId } = useMemberDirectory();
  const reader = usePerson(readerId === undefined ? undefined : { userId: readerId, name: "" });
  const inView = useLinesInView(list, rows, lines);
  const narrow = usePhoneRoom();

  const marks = lines.map(
    ({ line }): TranscriptRailMark => ({
      key: line.messageId,
      sender: line.sender === undefined ? READER_NAME : actorName(line.sender),
      words: line.words,
      face: <ActorMark actor={line.sender ?? reader} size={ACTOR_SIZE.INLINE} />,
      tag: <SheetTag sender={line.sender} sentAt={line.sentAt} />,
      shown: inView.has(line.messageId),
    }),
  );

  // A press goes to the line as a link to it does: its row brought in, then the line lit where it lands.
  const onJump = (messageId: string) => {
    bringIn(messageId, (row) => {
      const element = messageElement(row, messageId);
      // Note that the row is centered by the log's own virtualizer, so a line within a long turn's row is centered after it, on the frame after.
      requestAnimationFrame(() => {
        const box = list.current;
        const handle = rows.current;

        if (element !== undefined && box !== null && handle !== null) {
          centerIn(box, handle, element);
        }

        land(element ?? row);
      });
    });
  };

  return <TranscriptRail marks={marks} narrow={narrow} onJump={onJump} />;
}
