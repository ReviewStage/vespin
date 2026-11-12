import { BUTTON_SIZE, cn, IconButton, MessageFrame, Tooltip } from "@repo/ui";
import { MARKDOWN_LOOK, Markdown, type MarkdownProps } from "@repo/ui/markdown";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { type HTMLAttributes, memo, type ReactNode } from "react";
import { markdownHtmlParserQuery } from "../markdown-html-parser.js";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to our tokens: the developer's turn stands at the right in a
 * raised bubble, the app's at the left in plain text across the whole column,
 * as a chat app draws them. The actions on a message are the
 * registry's, each one a quiet icon button in `@repo/ui`'s `MessageActions`,
 * which shows while the pointer or the keyboard is on the message, in the
 * line under it (`MessageLine`), with the window's own
 * hover hint in place of the registry's tooltip. The registry's branches, attachments, and toolbar are
 * not here, because nothing draws them yet; each arrives with the surface
 * that first does.
 *
 * One change of substance from the registry: nothing in a message sets a
 * percentage height. The registry's Response is `size-full`, and in a
 * panel of fixed height, where the log and the messages are flex items of
 * definite size, that `height: 100%` resolved against the message's own
 * column, so every text part asked for the whole column and the parts
 * beside it were shrunk to slivers. The content stacks as blocks here.
 * And one more: the registry's content clips with `overflow-hidden`,
 * which cut the keyboard's ring off every fold, tool line, picture, and chip
 * a reply holds, so it clips past the ring instead (base.css's room).
 */

export type MessageProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick"> & {
  from: UIMessage["role"];
};

/**
 * A turn, `@repo/ui`'s `MessageFrame` in the transcript's skin: a column of
 * its words and what stands with them, the developer's own against the
 * column's right edge at a bubble's measure, whose actions a tap shows on a
 * screen with no hover. A line written again where it stands
 * (`edit-composer.tsx`) is the agent's box at that measure (`data-editing`).
 */
export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <MessageFrame
      revealActionsOnTap
      className={cn(
        "transcript-message group/message relative flex w-full flex-col gap-tight-gap",
        from === "user"
          ? "is-user ml-auto max-w-bubble items-end justify-end data-editing:items-stretch"
          : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A line the other side sent, the app's, GitHub's, or another agent's, at the
 * column's left, the other side of the conversation, its line under it starting at its left edge: the same
 * bubble as the developer's own, which stands at the right.
 */
export const RECEIVED_MESSAGE_CLASS = "is-received mr-auto max-w-bubble items-start";

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

/** The words of a turn: plain across the column, or the developer's raised bubble. */
export function MessageContent({ children, className, ...props }: MessageContentProps): ReactNode {
  return (
    // A reply is reading text, so it keeps a reading leading rather than the
    // body role's. It clips past the keyboard's ring rather than at its edge,
    // so a fold, a tool line, or a chip it holds keeps its ring. The
    // developer's turn and a received line raise it in a bubble.
    <div
      className={cn(
        "message-content min-w-0 max-w-full overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)] text-body leading-reading text-foreground",
        "group-[:is(.is-user,.is-received)]/message:w-fit group-[:is(.is-user,.is-received)]/message:rounded-ui-14 group-[:is(.is-user,.is-received)]/message:bg-fill-strong group-[:is(.is-user,.is-received)]/message:px-list-inset group-[:is(.is-user,.is-received)]/message:py-row-inset",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The developer's bubble with a mark at its side, toward the column's middle,
 * as a chat app stands its red alert beside a message that did not go
 * (`undelivered-mark.tsx`); the mark keeps its full ink while the bubble
 * fades (`tasks.css`).
 */
export function MessageBeside({
  mark,
  children,
}: {
  mark: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="message-beside flex min-w-0 max-w-full items-center justify-end gap-tight-gap">
      {children}
      {mark}
    </div>
  );
}

export type MessageActionProps = {
  /** What the action does, which is its accessible name and, when `tooltip` is set, the hint it shows. */
  label: string;
  /** Whether it hangs a hint: its label, or the words given here in its place. */
  tooltip?: boolean | string;
  /** A hover card hung in the hint's place, saying more about the action than its label (`@repo/ui`'s `Tooltip`'s `card`). */
  card?: ReactNode;
  onClick: () => void;
  /** Its glyph. */
  children: ReactNode;
};

/** One action: the shared compact glyph button, as a row's marks are. */
export function MessageAction({
  label,
  tooltip = false,
  card,
  onClick,
  children,
}: MessageActionProps): ReactNode {
  const button = (
    <IconButton icon={children} label={label} size={BUTTON_SIZE.COMPACT} onClick={onClick} />
  );

  if (card !== undefined) {
    return (
      <Tooltip label={label} card={card}>
        {button}
      </Tooltip>
    );
  }

  if (tooltip === false) return button;

  return <Tooltip label={tooltip === true ? label : tooltip}>{button}</Tooltip>;
}

export type MessageResponseProps = Omit<MarkdownProps, "look" | "className"> & {
  /** Whether the words are drawn on one line, as a queued message's row draws them (`MARKDOWN_LOOK.TRANSCRIPT_LINE`). */
  line?: boolean | undefined;
};

/**
 * A reply's markdown, drawn as it streams, in `.transcript-markdown`
 * (tasks.css). Note that it is memoised on every prop rather than on the
 * words alone, as the registry has it, because a mode changed under the same
 * words has to be drawn too. The words are drawn at once, and drawn again
 * through the HTML parser the moment it lands (`markdown-html-parser.ts`):
 * a window reloaded over a transcript draws it before the parser's chunk has
 * landed, and words that wait on it stand as empty bubbles meanwhile.
 */
export const MessageResponse = memo(
  ({ line = false, ...props }: MessageResponseProps): ReactNode => {
    const parsed = useQuery(markdownHtmlParserQuery).data === true;

    // Note that the words are drawn anew once the parser lands, because Streamdown keeps each block it has drawn while its words stand.
    return (
      <Markdown
        key={String(parsed)}
        look={line ? MARKDOWN_LOOK.TRANSCRIPT_LINE : MARKDOWN_LOOK.TRANSCRIPT}
        className="transcript-markdown"
        {...props}
      />
    );
  },
);

MessageResponse.displayName = "MessageResponse";
