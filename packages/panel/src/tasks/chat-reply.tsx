import type { ChatReply } from "@repo/features/manager-chat";
import { plainWords } from "@repo/features/plain-words";
import type { ChatBubbleQuote, ContextMenuProps } from "@repo/ui";
import { CopyIcon, ONE_LINE_END, OneLine, useMenu } from "@repo/ui";
import { ListTreeIcon, ReplyIcon } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu } from "../desktop/action-menu.js";
import { type ChatWorkToggle, chatWorkWords } from "./chat-work.js";
import { DraftStarterCard } from "./fork-action.js";
import type { ChatReplyTarget } from "./use-agent-composer.js";

/**
 * chat-reply.tsx -- a reply to one of a Manager's messages, as a chat app's Reply: the press on the message, its right-click menu, the chip over the box naming what the next send answers, and the quote's press back to the message answered.
 *
 * A Manager's message offers Reply beside its Copy and in the menu a
 * right-click or a long press on it opens, which makes the box's next send
 * answer it (`use-agent-composer.ts`'s `replyTo`) and puts the caret in the
 * box. The box names the message over itself with an × that lets the reply
 * go, its words kept. The send carries the message quoted over the words
 * (`@repo/features/manager-chat`'s `chatReplyText`), and the chat draws
 * that line's bubble opening on the quote, whose press brings the message
 * answered into view and lights it, as a link to a message does.
 */

/** The words of a reply's presses and its chip. */
const REPLY_WORDS = {
  ACTION: "Reply",
  COPY: "Copy",
  COPIED: "Message copied",
  MENU: "Message actions",
  CHIP_LEAD: "Replying to",
  DROP: "Drop the reply",
  JUMP: "Show the message this answers",
} as const;

/** What a Manager's chat hands its messages: the press that makes the box's next send answer one, none while the box takes none, and the press that brings one into view. */
interface ChatReplyDoors {
  readonly replyTo: ((target: ChatReplyTarget) => void) | undefined;
  readonly show: ((messageId: string) => void) | undefined;
}

const ChatReplyContext = createContext<ChatReplyDoors | undefined>(undefined);

/** Hands a Manager's chat drawn under it the press that makes the box's next send answer a message; none while the box takes none. */
export function ChatReplyProvider({
  replyTo,
  children,
}: {
  replyTo: ((target: ChatReplyTarget) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const show = useContext(ChatReplyContext)?.show;

  return (
    <ChatReplyContext.Provider value={{ replyTo, show }}>{children}</ChatReplyContext.Provider>
  );
}

/** Hands a Manager's chat drawn under it the press that brings one of its messages into view, beside the reply press handed from over it. */
export function ChatShowProvider({
  show,
  children,
}: {
  show: (messageId: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const replyTo = useContext(ChatReplyContext)?.replyTo;

  return (
    <ChatReplyContext.Provider value={{ replyTo, show }}>{children}</ChatReplyContext.Provider>
  );
}

/** The press beside a Manager's message's Copy that makes the box's next send answer it; none where the box takes no reply. */
export function ReplyMessageAction({ target }: { target: ChatReplyTarget }): ReactNode {
  const replyTo = useContext(ChatReplyContext)?.replyTo;

  if (replyTo === undefined) return null;

  return (
    <MessageAction
      label={REPLY_WORDS.ACTION}
      tooltip={REPLY_WORDS.ACTION}
      onClick={() => replyTo(target)}
    >
      <ReplyIcon />
    </MessageAction>
  );
}

/** A Manager's message's right-click menu: what its bubble spreads to open it, none for a message of no words, and the menu to draw beside the bubble. */
interface ChatMessageMenu {
  readonly contextMenu: ContextMenuProps | undefined;
  readonly menu: ReactNode;
}

/** A Manager's message's right-click menu, Reply and Copy, and Show work where the message keeps work of its own (`work`). */
export function useChatMessageMenu(
  target: ChatReplyTarget,
  work?: ChatWorkToggle | undefined,
): ChatMessageMenu {
  const replyTo = useContext(ChatReplyContext)?.replyTo;
  const copy = useCopyToast();
  const menu = useMenu(true);
  const offered = target.words !== "";

  const items = [
    ...(replyTo === undefined
      ? []
      : [
          {
            label: REPLY_WORDS.ACTION,
            icon: <ReplyIcon aria-hidden="true" />,
            onSelect: () => replyTo(target),
          },
        ]),
    {
      label: REPLY_WORDS.COPY,
      icon: <CopyIcon aria-hidden="true" />,
      onSelect: () => copy(target.words, REPLY_WORDS.COPIED),
    },
    ...(work === undefined
      ? []
      : [
          {
            label: chatWorkWords(work.shown),
            icon: <ListTreeIcon aria-hidden="true" />,
            onSelect: work.onToggle,
          },
        ]),
  ];

  return {
    contextMenu: offered ? menu.contextMenu() : undefined,
    menu:
      !offered || menu.drawn === undefined ? null : (
        <ActionMenu
          label={REPLY_WORDS.MENU}
          menu={menu.drawn}
          groups={[items]}
          replayUnmasked
          onClose={menu.close}
        />
      ),
  };
}

/** The quote a reply's bubble opens on, whose press brings the message it answers into view; none for a line that answers none. */
export function useChatReplyQuote(reply: ChatReply | undefined): ChatBubbleQuote | undefined {
  const show = useContext(ChatReplyContext)?.show;

  if (reply === undefined) return undefined;

  return {
    words: reply.quote,
    label: REPLY_WORDS.JUMP,
    onPress: show === undefined ? undefined : () => show(reply.to),
  };
}

/** The chip over the box naming the Manager's message its next send answers, and the × that lets the reply go. */
export function ReplyChip({
  target,
  onDrop,
}: {
  target: ChatReplyTarget;
  onDrop: () => void;
}): React.JSX.Element {
  return (
    <DraftStarterCard
      glyph={<ReplyIcon className="draft-fork-glyph" aria-hidden="true" />}
      marks={{ "data-reply-chip": "" }}
      drop={REPLY_WORDS.DROP}
      onDrop={onDrop}
    >
      <span className="draft-fork-lead">{REPLY_WORDS.CHIP_LEAD}</span>
      <OneLine end={ONE_LINE_END.ELLIPSIS} className="draft-fork-quote">
        {`“${plainWords(target.words)}”`}
      </OneLine>
    </DraftStarterCard>
  );
}
