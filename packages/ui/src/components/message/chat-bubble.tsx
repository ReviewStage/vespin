/**
 * chat-bubble.tsx -- one message of a chat as a chat app draws it: a bubble at the column's right for what people sent and at its left for what the other side sent, its corners on its own side tightened where its sender's run goes on past it.
 *
 * A chat stands one sender's consecutive messages close together, as one
 * run, and shapes each bubble by where it stands in it: the corner toward
 * its own edge that faces the next or the last message of the run is
 * tightened, so the run reads as one block that opens and closes round.
 * What stands beside a bubble (`beside`), such as its actions, stands on the
 * side toward the column's middle and adds nothing to the run's height, so
 * the run stays tight. A sender's picture (`avatar`), such as a Manager's
 * face, stands at the bubble's outer side, level with its foot, beside the
 * run's last bubble and a bubble alone, as a chat app stands it, and keeps
 * its room beside the run's others, so the run's bubbles line up, and the
 * line under the run starts past it (`MESSAGE_LINE_INSET.AVATAR`). The two sides wear different grounds, the sent one a
 * wash of the accent and the received one the raised fill, both under the
 * foreground's ink, so the words, links, chips, and code inside read as
 * they do anywhere in a transcript. Where the bubble stands in the column,
 * and the line over or under it, is its caller's.
 *
 * It is drawn in the Tailwind theme's utilities.
 */

import type { ReactNode } from "react";

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

/** The bubble's ground on each side. */
const SIDE_GROUND: Record<ChatSide, string> = {
  [CHAT_SIDE.SENT]: "bg-bubble-sent",
  [CHAT_SIDE.RECEIVED]: "bg-fill-strong",
};

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

/** Whether a bubble shows its sender's picture: the run's last and a bubble alone do, and the others keep its room. */
const AVATAR_SHOWN: Record<ChatRun, boolean> = {
  [CHAT_RUN.ALONE]: true,
  [CHAT_RUN.FIRST]: false,
  [CHAT_RUN.MIDDLE]: false,
  [CHAT_RUN.LAST]: true,
};

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
  children,
}: {
  side: ChatSide;
  run: ChatRun;
  /** The sender's picture, drawn beside the run's last bubble and a bubble alone and its room kept beside the others; none where the chat draws none. */
  avatar?: ReactNode;
  /** What stands beside the bubble toward the column's middle, such as its actions or a mark that it did not go; none where nothing does. */
  beside?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`ui-chat-bubble-row flex min-w-0 max-w-full items-center gap-ui-4 ${side === CHAT_SIDE.SENT ? "flex-row-reverse" : ""}`}
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
      {/* Note that it clips past the keyboard's ring rather than at its edge, so a fold, a chip, or a link it holds keeps its ring. */}
      <div
        className={`ui-chat-bubble min-w-0 max-w-full overflow-clip rounded-ui-14 px-list-inset py-row-inset text-body leading-reading text-foreground [overflow-clip-margin:var(--ui-focus-ring-room)] ${SIDE_GROUND[side]} ${RUN_CORNERS[side][run]}`}
      >
        {children}
      </div>
      {beside}
    </div>
  );
}
