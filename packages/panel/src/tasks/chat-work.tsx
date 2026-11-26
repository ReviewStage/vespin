/**
 * chat-work.tsx -- the work of a Manager's turn a press away from its chat: Show work beside the turn's first message and in its menu, or beside its working line.
 *
 * A Manager's chat draws its messages alone (`@repo/features/manager-chat-view`),
 * and keeps the work each turn did, its thoughts, calls, and own words, out
 * of sight until the reader asks. A turn that has ended offers Show work
 * among the actions of its first message and in that message's menu
 * (`manager-chat-tab.tsx`, `chat-reply.tsx`); the turn under way offers it
 * beside its working line. Either draws the work under its row as the
 * transcript draws a turn's, and Hide work folds it away again, so a
 * finished chat draws no more than its messages.
 */

import { chatWorkWords } from "@repo/features/manager-chat-view";
import { MessageActions } from "@repo/ui";
import { ListTreeIcon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { MessageAction } from "../ai-elements/message.js";

/** Whether a message's work stands open under it, the press that opens or folds it, and what opens it however often it is asked, as a find landing in it does. */
export interface ChatWorkToggle {
  readonly shown: boolean;
  readonly onToggle: () => void;
  readonly onShow: () => void;
}

/** The press beside a message or the working line that opens the work under it, or folds it away. */
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
