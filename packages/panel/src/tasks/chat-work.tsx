/**
 * chat-work.tsx -- the work of a Manager's turn under way a press away from its chat: Show work beside its working line.
 *
 * A Manager's chat draws its messages alone (`@repo/features/manager-chat-view`),
 * and keeps the work each turn did, its thoughts, calls, and own words, out
 * of sight until the reader asks. A turn that has ended keeps its work
 * folded over its first message (`manager-chat-tab.tsx`); the turn under way
 * offers Show work beside its working line instead, which draws its work so
 * far under the line as the transcript draws a turn's, and Hide work folds
 * it away again, so a finished chat draws no more than its messages.
 */

import { chatWorkWords } from "@repo/features/manager-chat-view";
import { MessageActions } from "@repo/ui";
import { ListTreeIcon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { MessageAction } from "../ai-elements/message.js";

/** Whether a message's work stands open under it, and the press that opens or folds it. */
export interface ChatWorkToggle {
  readonly shown: boolean;
  readonly onToggle: () => void;
}

/** The press beside the working line that opens the work under it, or folds it away. */
function WorkMessageAction({ toggle }: { toggle: ChatWorkToggle }): ReactNode {
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
