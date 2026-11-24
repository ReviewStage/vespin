/**
 * chat-bubble.tsx -- one message of a chat as a chat app draws it: a bubble at the column's right for what people sent and at its left for what the other side sent, its corners on its own side tightened where its sender's run goes on past it.
 *
 * A chat stands one sender's consecutive messages close together, as one
 * run, and shapes each bubble by where it stands in it: the corner toward
 * its own edge that faces the next or the last message of the run is
 * tightened, so the run reads as one block that opens and closes round.
 * What stands beside a bubble (`beside`), such as its actions, stands on the
 * side toward the column's middle and adds nothing to the run's height, so
 * the run stays tight, nor to its width: it hangs past the bubble's edge, as
 * a chat app hangs its hover actions, so a bubble wraps where its words and
 * its caller's width say, whatever stands beside it. The row spans what
 * holds it, so a share of the column the caller caps the bubble at
 * (`ui-chat-bubble-hold`) is a share of the column, never of the row's own
 * words. A sender's picture (`avatar`), such as a Manager's
 * face, stands at the bubble's outer side, level with its foot, beside the
 * run's last bubble and a bubble alone, as a chat app stands it, and keeps
 * its room beside the run's others, so the run's bubbles line up, and the
 * line under the run starts past it (`MESSAGE_LINE_INSET.AVATAR`). It is
 * the one bubble of every transcript: an agent's, where a line stands
 * alone, and a Manager's chat, where it stands in runs. Both sides wear the
 * raised fill under the foreground's ink, so the words, links, chips, and
 * code inside read as they do anywhere in a transcript. Where the bubble stands in the column,
 * and the line over or under it, is its caller's.
 *
 * A message that answers another, as a chat app's Reply does, opens on the
 * words it answers (`quote`): two lines at most, set off by a quote's rule
 * and ink, which a press brings the message answered into view from, as
 * iMessage's and Slack's do. A bubble may carry a menu a right-click or a
 * long press opens (`contextMenu`), as a chat app's message does.
 *
 * What stands with a message but outside its bubble, such as the work a
 * Manager's message came of, opened under it, stands at the bubble's own
 * inset, past the sender's picture (`ChatAside`), as the line under it does.
 *
 * It is drawn in the Tailwind theme's utilities.
 */

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ReactNode } from "react";
import { type ContextMenuProps, withContextMenu } from "../menu/context-menu.js";
import { type MessageLineInset, OPENING_INSET } from "./message-line.js";

/** Which side of the chat sent the message: people, at the column's right, or the other side, at its left. */
export const CHAT_SIDE = {
  SENT: "sent",
  RECEIVED: "received",
} as const;

export type ChatSide = (typeof CHAT_SIDE)[keyof typeof CHAT_SIDE];

/** Where a message stands in its sender's run: alone, or its first, a middle one, or its last. */
export const CHAT_RUN = {
  ALONE: "alone",
  FIRST: "first",
  MIDDLE: "middle",
  LAST: "last",
} as const;

export type ChatRun = (typeof CHAT_RUN)[keyof typeof CHAT_RUN];

/** The corners tightened on each side where the run goes on past the bubble: below it, above it, or both. */
const RUN_CORNERS: Record<ChatSide, Record<ChatRun, string>> = {
  [CHAT_SIDE.SENT]: {
    [CHAT_RUN.ALONE]: "",
    [CHAT_RUN.FIRST]: "rounded-br-ui-6",
    [CHAT_RUN.MIDDLE]: "rounded-r-ui-6",
    [CHAT_RUN.LAST]: "rounded-tr-ui-6",
  },
  [CHAT_SIDE.RECEIVED]: {
    [CHAT_RUN.ALONE]: "",
    [CHAT_RUN.FIRST]: "rounded-bl-ui-6",
    [CHAT_RUN.MIDDLE]: "rounded-l-ui-6",
    [CHAT_RUN.LAST]: "rounded-tl-ui-6",
  },
};

/** Which way a side's row runs: from the column's left for what the other side sent, from its right for what people sent. */
const SIDE_FLOW: Record<ChatSide, string> = {
  [CHAT_SIDE.SENT]: "flex-row-reverse",
  [CHAT_SIDE.RECEIVED]: "",
};

/** Where what stands beside a bubble hangs: past its edge toward the column's middle, a gap off it. */
const BESIDE_PLACE: Record<ChatSide, string> = {
  [CHAT_SIDE.SENT]: "end-full me-ui-4",
  [CHAT_SIDE.RECEIVED]: "start-full ms-ui-4",
};

/** Whether a bubble shows its sender's picture: the run's last and a bubble alone do, and the others keep its room. */
const AVATAR_SHOWN: Record<ChatRun, boolean> = {
  [CHAT_RUN.ALONE]: true,
  [CHAT_RUN.FIRST]: false,
  [CHAT_RUN.MIDDLE]: false,
  [CHAT_RUN.LAST]: true,
};

/** The words a bubble's message answers, which it opens on, and the press that brings the message answered into view; none where it cannot be found. */
export interface ChatBubbleQuote {
  readonly words: string;
  /** What the press is called, which says what it brings into view. */
  readonly label: string;
  readonly onPress?: (() => void) | undefined;
}

/** A quote's face: its rule and ink, as a sent quote wears them (`markdown-quote`), cut short at its second line. */
const QUOTE_FACE =
  "ui-chat-bubble-quote mb-ui-4 block w-full min-w-0 border-0 border-s-[3px] border-solid border-border-strong bg-transparent ps-ui-8 pe-0 py-0 text-start text-caption text-muted-foreground [display:-webkit-box] overflow-hidden wrap-anywhere [-webkit-box-orient:vertical] [-webkit-line-clamp:2]";

/** The words a message answers, opening its bubble: a press where it brings the message answered into view, else the words alone. */
function BubbleQuote({ quote }: { quote: ChatBubbleQuote }): React.JSX.Element {
  if (quote.onPress === undefined) {
    return <span className={QUOTE_FACE}>{quote.words}</span>;
  }

  return (
    <ButtonPrimitive
      className={`${QUOTE_FACE} cursor-press [font-family:inherit] hover:text-foreground`}
      aria-label={quote.label}
      title={quote.label}
      onClick={quote.onPress}
    >
      {quote.words}
    </ButtonPrimitive>
  );
}

/** Where a message stands in its run, from whether it opens the run and whether it closes it. */
export function chatRunOf(opens: boolean, closes: boolean): ChatRun {
  if (opens) return closes ? CHAT_RUN.ALONE : CHAT_RUN.FIRST;

  return closes ? CHAT_RUN.LAST : CHAT_RUN.MIDDLE;
}

/** One message's bubble, `children` its words, shaped by its `side` and its place in its `run`, with `beside` toward the column's middle and its sender's `avatar` at its outer side. */
export function ChatBubble({
  side,
  run,
  avatar,
  beside,
  quote,
  contextMenu,
  children,
}: {
  side: ChatSide;
  run: ChatRun;
  /** The words the message answers, which the bubble opens on; none for a message that answers none. */
  quote?: ChatBubbleQuote | undefined;
  /** The menu a right-click or a long press on the bubble opens (`useMenu`'s `contextMenu`); none where it has none. */
  contextMenu?: ContextMenuProps | undefined;
  /** The sender's picture, drawn beside the run's last bubble and a bubble alone and its room kept beside the others; none where the chat draws none. */
  avatar?: ReactNode;
  /** What stands beside the bubble toward the column's middle, such as its actions or a mark that it did not go; none where nothing does. */
  beside?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`ui-chat-bubble-row flex w-full min-w-0 items-center gap-ui-4 ${SIDE_FLOW[side]}`}
      data-side={side}
      data-run={run}
    >
      {avatar === undefined ? null : (
        <span
          className={`ui-chat-bubble-avatar inline-flex w-chat-avatar flex-none justify-center self-end ${AVATAR_SHOWN[run] ? "" : "invisible"}`}
        >
          {avatar}
        </span>
      )}
      <div className="ui-chat-bubble-hold relative flex min-w-0 max-w-full">
        {/* Note that it clips past the keyboard's ring rather than at its edge, so a fold, a chip, or a link it holds keeps its ring. */}
        <div
          className={`ui-chat-bubble min-w-0 max-w-full overflow-clip rounded-ui-14 px-list-inset py-row-inset text-body leading-reading text-foreground [overflow-clip-margin:var(--ui-focus-ring-room)] bg-fill-strong ${RUN_CORNERS[side][run]}`}
          {...withContextMenu<HTMLDivElement>(contextMenu, {})}
        >
          {quote === undefined ? null : <BubbleQuote quote={quote} />}
          {children}
        </div>
        {beside === undefined || beside === null ? null : (
          <div
            className={`ui-chat-bubble-beside absolute top-1/2 flex w-max -translate-y-1/2 items-center gap-ui-4 ${SIDE_FLOW[side]} ${BESIDE_PLACE[side]}`}
          >
            {beside}
          </div>
        )}
      </div>
    </div>
  );
}

/** What stands with a message outside its bubble, such as the work it came of, at the bubble's inset (`inset`), past the sender's picture where the chat draws one, as the line under the run starts. */
export function ChatAside({
  inset,
  children,
}: {
  inset: MessageLineInset;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={`ui-chat-aside min-w-0 max-w-full ${OPENING_INSET[inset]}`}>{children}</div>
  );
}
