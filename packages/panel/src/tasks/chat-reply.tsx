import { chatWorkWords } from "@repo/features/manager-chat";
import { replyOf } from "@repo/features/reply-quote";
import type { ContextMenuProps } from "@repo/ui";
import { CopyIcon, useMenu } from "@repo/ui";
import { ListTreeIcon, ReplyIcon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu } from "../desktop/action-menu.js";
import type { ChatWorkToggle } from "./chat-work.js";
import { useReplyDoor } from "./reply-to-selection.js";

/**
 * chat-reply.tsx -- a reply to a message of a Manager's chat: Reply beside the message and in the menu a right-click or a long press on it opens, which quotes the whole message into the box as Reply over words selected does.
 *
 * Every message of the chat, the Manager's and every person's, offers
 * Reply beside its Copy and in its menu. Reply does what Reply over words
 * selected in a message does (`reply-to-selection.tsx`), with the whole
 * message as the words: it lays
 * them into the box as a quote block where the caret stands, through the
 * same door (`useReplyDoor`), and hands the box the caret under it. Nothing
 * stands over the box, and nothing of the message is cut but by the
 * message's own bound. The Manager reads the quote at the head of the line
 * it is sent, as a Markdown blockquote, so it knows which message is
 * answered, and the chat draws the line as any line with a quote. Reply is
 * offered only where a box takes the quote, as Reply over a selection is.
 */

/** The words of a chat message's presses and its menu. */
const REPLY_WORDS = {
  ACTION: "Reply",
  COPY: "Copy",
  COPIED: "Message copied",
  MENU: "Message actions",
} as const;

/** The press that quotes a chat message, `words` its Markdown, into the box; none where no box takes a quote or the message has no words yet. */
function useQuoteMessage(words: string): (() => void) | undefined {
  const reply = useReplyDoor();

  if (reply === undefined || words === "") return undefined;

  return () => reply(replyOf(words));
}

/** The press beside a chat message's Copy that quotes the whole message into the box; none where no box takes a quote. */
export function ReplyMessageAction({ words }: { words: string }): ReactNode {
  const quote = useQuoteMessage(words);

  if (quote === undefined) return null;

  return (
    <MessageAction label={REPLY_WORDS.ACTION} tooltip={REPLY_WORDS.ACTION} onClick={quote}>
      <ReplyIcon />
    </MessageAction>
  );
}

/** A chat message's right-click menu: what its bubble spreads to open it, none for a message of no words, and the menu to draw beside the bubble. */
interface ChatMessageMenu {
  readonly contextMenu: ContextMenuProps | undefined;
  readonly menu: ReactNode;
}

/** A chat message's right-click menu, Reply and Copy of its Markdown `words`, and Show work where the message keeps work of its own (`work`). */
export function useChatMessageMenu(
  words: string,
  work?: ChatWorkToggle | undefined,
): ChatMessageMenu {
  const quote = useQuoteMessage(words);
  const copy = useCopyToast();
  const menu = useMenu(true);
  const offered = words !== "";

  const items = [
    ...(quote === undefined
      ? []
      : [{ label: REPLY_WORDS.ACTION, icon: <ReplyIcon aria-hidden="true" />, onSelect: quote }]),
    {
      label: REPLY_WORDS.COPY,
      icon: <CopyIcon aria-hidden="true" />,
      onSelect: () => copy(words, REPLY_WORDS.COPIED),
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
