/**
 * chat-work.tsx -- a Manager's work a press away from its chat: Show work beside a message, or beside its working line, and the item in a message's menu.
 *
 * A Manager's chat draws its messages alone (`@repo/features/manager-chat`),
 * and keeps the work each came of, its thoughts, calls, and own words
 * (`managerChatWork`), out of sight until the reader asks: Show work beside
 * a message, and in the menu a right-click or a long press on it opens,
 * draws that work under the bubble as the transcript draws a turn's, and
 * Hide work folds it away again. The working line offers the same for the
 * turn under way, so a finished chat draws no more than its messages.
 */

import { MessageActions } from "@repo/ui";
import { ListTreeIcon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { MessageAction } from "../ai-elements/message.js";

/** The words of the press, by whether the work stands open. */
export const CHAT_WORK_WORDS = {
  SHOW: "Show work",
  HIDE: "Hide work",
} as const;

/** Whether a message's work stands open under it, and the press that opens or folds it. */
export interface ChatWorkToggle {
  readonly shown: boolean;
  readonly onToggle: () => void;
}

/** What the press says, by whether the work stands open. */
export function chatWorkWords(shown: boolean): string {
  return shown ? CHAT_WORK_WORDS.HIDE : CHAT_WORK_WORDS.SHOW;
}

/** The press beside a message, or the working line, that opens the work under it, or folds it away. */
export function WorkMessageAction({ toggle }: { toggle: ChatWorkToggle }): ReactNode {
  const words = chatWorkWords(toggle.shown);

  return (
    <MessageAction label={words} tooltip={words} onClick={toggle.onToggle}>
      <ListTreeIcon />
    </MessageAction>
  );
}

/** Show work standing beside the working line by itself, as a message's stands among its actions. */
export function WorkingWorkAction({ toggle }: { toggle: ChatWorkToggle }): React.JSX.Element {
  return (
    <MessageActions>
      <WorkMessageAction toggle={toggle} />
    </MessageActions>
  );
}
