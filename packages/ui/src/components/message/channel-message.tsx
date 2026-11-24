/**
 * channel-message.tsx -- a chat drawn as a team channel: full-width rows of a sender's picture, name, time, and words; a thread's replies summed under the message they answer; and the thread itself in a pane beside the channel.
 *
 * A channel stands every message at the column's left, whoever sent it, as
 * a row: the sender's picture in a gutter, their name in bold and when it
 * was sent in the muted ink over the words. A message that goes on its
 * sender's run (`continues`) draws neither, its words set at the gutter's
 * edge under the one before, so a run reads as one block. The row lights
 * under the pointer, and its actions (`actions`) float over its top end
 * corner while the pointer or the keyboard is on it, as a channel's do, so
 * they add nothing to its height.
 *
 * A message others answered in its thread says so under its words
 * (`ThreadReplies`): the faces of who answered and how many replies, in the
 * accent's ink, which opens the thread. The thread stands in a pane at the
 * channel's end (`ThreadPane`): its head, the message it answers, the
 * replies under a rule that counts them, and its own reply box at its foot.
 * `ChannelSplit` lays the channel and the pane side by side, the pane at
 * its own width and the channel taking the rest.
 *
 * It is drawn in the Tailwind theme's utilities.
 */

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { IconButton } from "../button/button.js";
import { type ContextMenuProps, withContextMenu } from "../menu/context-menu.js";
import { OneLine } from "../one-line/one-line.js";
import { MessageActions, MessageFrame } from "./message.js";

/** What the channel's rows say in words of their own. */
const CHANNEL_WORDS = {
  REPLY: "reply",
  REPLIES: "replies",
  THREAD: "Thread",
  CLOSE: "Close thread",
} as const;

/** How many of a thread's repliers' faces its summary shows, the rest counted in its words alone. */
const REPLIER_FACES = 3;

/** How a thread's replies are counted: "1 reply", "3 replies". */
export function repliesWords(count: number): string {
  return `${count} ${count === 1 ? CHANNEL_WORDS.REPLY : CHANNEL_WORDS.REPLIES}`;
}

/**
 * One message of a channel: `avatar` and `name` over its words with `at`
 * beside the name, or its words alone where it `continues` its sender's
 * run; `actions` over its top end corner while it is pointed at, and what
 * stands under its words (`under`), such as a thread's summary.
 */
export function ChannelMessage({
  avatar,
  name,
  at,
  continues = false,
  actions,
  contextMenu,
  under,
  messageId,
  children,
}: {
  avatar: ReactNode;
  name: ReactNode;
  /** When it was sent, as a `Time`; none where it is not known. */
  at?: ReactNode;
  /** Whether it goes on its sender's run, drawn with no picture, name, or time. */
  continues?: boolean | undefined;
  actions?: ReactNode;
  /** The menu a right-click or a long press on it opens; none where it has none. */
  contextMenu?: ContextMenuProps | undefined;
  under?: ReactNode;
  /** The message's id, which a reader finds its row by. */
  messageId?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <MessageFrame
      revealActionsOnTap
      className={`ui-channel-message relative flex w-full min-w-0 gap-ui-8 rounded-ui-6 px-ui-8 hover:bg-muted ${continues ? "py-ui-2" : "pt-ui-6 pb-ui-2"}`}
      data-continues={continues ? "" : undefined}
      data-message-id={messageId}
    >
      <span className="ui-channel-message-avatar inline-flex w-channel-avatar flex-none justify-center">
        {continues ? null : avatar}
      </span>
      <div
        className="ui-channel-message-body flex min-w-0 flex-1 flex-col gap-ui-2"
        {...withContextMenu<HTMLDivElement>(contextMenu, {})}
      >
        {continues ? null : (
          <div className="ui-channel-message-head flex min-w-0 items-baseline gap-ui-6">
            <OneLine className="font-ui-semibold text-body text-foreground">{name}</OneLine>
            {at === undefined ? null : (
              <span className="flex-none text-caption text-muted-foreground">{at}</span>
            )}
          </div>
        )}
        <div className="ui-channel-message-words min-w-0 text-body leading-reading text-foreground">
          {children}
        </div>
        {under}
      </div>
      {actions === undefined || actions === null ? null : (
        <div className="ui-channel-message-actions absolute -top-ui-12 end-ui-8 z-1">
          <MessageActions>
            <span className="flex items-center gap-ui-2 rounded-ui-6 border border-border bg-popover p-ui-2 shadow-menu">
              {actions}
            </span>
          </MessageActions>
        </div>
      )}
    </MessageFrame>
  );
}

/** A thread's summary under the message it answers: up to three of its repliers' faces (`faces`) and how many replies it holds, which opens the thread (`onOpen`). */
export function ThreadReplies({
  count,
  faces,
  open = false,
  onOpen,
}: {
  count: number;
  /** One face to each replier, the first to answer first. */
  faces: readonly ReactNode[];
  /** Whether the thread stands open in its pane. */
  open?: boolean | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <ButtonPrimitive
      type="button"
      className="ui-thread-replies -ms-ui-4 flex [border:0] bg-transparent font-ui w-max max-w-full items-center gap-ui-6 rounded-ui-6 px-ui-4 py-ui-2 text-caption font-ui-semibold text-accent-ink cursor-press hover:bg-fill-strong data-[open]:bg-fill-strong"
      data-open={open ? "" : undefined}
      aria-expanded={open}
      onClick={onOpen}
    >
      <span className="flex items-center gap-ui-2" aria-hidden>
        {faces.slice(0, REPLIER_FACES).map((face, index) => (
          <span key={index} className="inline-flex">
            {face}
          </span>
        ))}
      </span>
      {repliesWords(count)}
    </ButtonPrimitive>
  );
}

/** A thread in its pane beside the channel: its head, which closes it (`onClose`), the message it answers (`root`), its replies under a rule that counts them, and its reply box (`composer`) at its foot. */
export function ThreadPane({
  root,
  count,
  composer,
  onClose,
  children,
}: {
  root: ReactNode;
  count: number;
  composer: ReactNode;
  onClose: () => void;
  /** The replies, in the order they were sent. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <aside
      className="ui-thread-pane flex h-full w-thread-pane flex-none flex-col border-s border-border bg-background"
      aria-label={CHANNEL_WORDS.THREAD}
    >
      <header className="ui-thread-pane-head flex flex-none items-center justify-between gap-ui-8 border-b border-border px-ui-12 py-ui-6">
        <span className="font-ui-semibold text-body text-foreground">{CHANNEL_WORDS.THREAD}</span>
        <IconButton icon={<GLYPH.CLOSE />} label={CHANNEL_WORDS.CLOSE} onClick={onClose} />
      </header>
      <div className="ui-thread-pane-body flex min-h-0 flex-1 flex-col overflow-y-auto py-ui-8">
        {root}
        {count === 0 ? null : (
          <div className="ui-thread-pane-rule flex items-center gap-ui-8 px-ui-12 py-ui-6 text-caption text-muted-foreground">
            <span className="flex-none">{repliesWords(count)}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {children}
      </div>
      <div className="ui-thread-pane-foot flex-none px-ui-8 pb-ui-8">{composer}</div>
    </aside>
  );
}

/** A channel and, where one is open, its thread's pane beside it at the column's end. */
export function ChannelSplit({
  pane,
  children,
}: {
  pane: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-channel-split flex min-h-0 w-full flex-1 flex-row">
      <div className="ui-channel-split-main flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {pane}
    </div>
  );
}
