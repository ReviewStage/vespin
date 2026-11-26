import type { LinkDestination } from "@repo/features/link-grammar";
import { chatWorkWords } from "@repo/features/manager-chat-view";
import type { ContextMenuProps } from "@repo/ui";
import { CopyIcon, useMenu } from "@repo/ui";
import { ListTreeIcon, MessageSquareTextIcon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyToast } from "../copy-feedback.js";
import { useLinkItems } from "../copy-link-item.js";
import { ActionMenu } from "../desktop/action-menu.js";
import type { ChatWorkToggle } from "./chat-work.js";
import { THREAD_WORDS } from "./manager-chat-threads.js";

/**
 * chat-message-menu.tsx -- the menu a right-click or a long press on a message of a Manager's chat opens: Reply in thread, Copy, Copy link, Mark as unread, and Show work.
 *
 * Every message of the chat, the Manager's and every person's, offers in
 * its menu what its actions beside it offer. A message is answered in its
 * thread (Reply in thread), never by a quote of it laid into the box.
 */

/** The words of a chat message's menu. */
const MENU_WORDS = {
  COPY: "Copy",
  COPIED: "Message copied",
  MENU: "Message actions",
} as const;

/** A chat message's right-click menu: what its bubble spreads to open it, none for a message with nothing to offer, and the menu to draw beside the bubble. */
interface ChatMessageMenu {
  readonly contextMenu: ContextMenuProps | undefined;
  readonly menu: ReactNode;
}

/**
 * A chat message's right-click menu, a phone's long press: Reply in thread
 * first where the message opens a thread (`onThread`), as the actions beside
 * it lead with it, then Copy of its Markdown `words`, where it has any, then
 * Copy link to the message (`link`), as Slack's menu offers it, where the
 * page hands down a workspace to write it under, then apart Mark as unread
 * where the chat's mark moves back to it (`onMarkUnread`), and last, apart,
 * Show work or Hide work where the message opens a turn that did work
 * (`work`), as the fold over it once did.
 */
export function useChatMessageMenu(
  words: string,
  onThread: (() => void) | undefined,
  work: ChatWorkToggle | undefined,
  link: LinkDestination | undefined,
  onMarkUnread?: (() => void) | undefined,
): ChatMessageMenu {
  const copy = useCopyToast();
  const menu = useMenu(true);
  const linkItemsOf = useLinkItems();
  const worded = words !== "";
  const linkItems = link === undefined ? [] : linkItemsOf(link);

  const offered =
    worded ||
    onThread !== undefined ||
    work !== undefined ||
    linkItems.length > 0 ||
    onMarkUnread !== undefined;

  const items = [
    ...(onThread === undefined
      ? []
      : [
          {
            label: THREAD_WORDS.REPLY,
            icon: <MessageSquareTextIcon aria-hidden="true" />,
            onSelect: onThread,
          },
        ]),
    ...(worded
      ? [
          {
            label: MENU_WORDS.COPY,
            icon: <CopyIcon aria-hidden="true" />,
            onSelect: () => copy(words, MENU_WORDS.COPIED),
          },
        ]
      : []),
    ...linkItems,
  ];

  const readItems =
    onMarkUnread === undefined
      ? []
      : [commandAction(PANEL_COMMAND.MARK_UNREAD, onMarkUnread, undefined)];

  const workItems =
    work === undefined
      ? []
      : [
          {
            label: chatWorkWords(work.shown),
            icon: <ListTreeIcon aria-hidden="true" />,
            onSelect: work.onToggle,
          },
        ];

  return {
    contextMenu: offered ? menu.contextMenu() : undefined,
    menu:
      !offered || menu.drawn === undefined ? null : (
        <ActionMenu
          label={MENU_WORDS.MENU}
          menu={menu.drawn}
          groups={[items, readItems, workItems].filter((group) => group.length > 0)}
          replayUnmasked
          onClose={menu.close}
        />
      ),
  };
}
