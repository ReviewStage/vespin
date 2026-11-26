/**
 * use-chat-react.ts -- a Manager chat's reactions as the reader gives them: each press drawn at once over the chat the host holds, then sent, and taken back off with the failure notice where it did not go.
 *
 * The panel draws a press over the window's document until its ask settles
 * (`manager-chat-reactions.tsx`); the app draws it over the chat's messages
 * a screen reads, the same way (`withReactionPress`), until the act
 * answers, by when the host has laid it into the chat it holds where the
 * service took it (`manager-chat-follow.ts`). A press the service refused
 * goes, and the failure notice says so.
 */

import {
  type ManagerChatLiveMessage,
  type ManagerChatReactionPress,
  withReactionPress,
} from "@repo/features/manager-chat-live";
import { CHAT_REACTION_REFUSED_WORDS } from "@repo/features/manager-chat-view";
import { ACT_KIND } from "@repo/host/acts";
import { BUZZ } from "@repo/ui-native";
import { useCallback, useMemo, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** No press waiting on its answer, the same array every render so nothing drawn from it is drawn anew. */
const NO_PRESSES: readonly ManagerChatReactionPress[] = [];

/** A Manager chat's reactions as the reader gives them: the press, and the chat's messages with every press still waiting on its answer drawn on them. */
export interface ChatReacting {
  readonly react: (press: ManagerChatReactionPress) => void;
  readonly drawn: <Message extends ManagerChatLiveMessage>(
    messages: readonly Message[],
  ) => readonly Message[];
}

/** The reader's reactions to `agentId`'s chat: each press drawn at once, sent as the host's act, and let go as it answers. */
export function useChatReact(agentId: string): ChatReacting {
  const acts = useHostActs();
  const write = useWrite();
  const [presses, setPresses] = useState<readonly ManagerChatReactionPress[]>(NO_PRESSES);

  const react = useCallback(
    (press: ManagerChatReactionPress) => {
      setPresses((was) => [...was, press]);

      const { emoji, ...reaction } = press;

      const params =
        emoji === undefined ? { agentId, ...reaction } : { agentId, ...reaction, emoji };

      // Note that the host is handed the emoji too, so it draws a kind new to the message by it until the chat's read carries it.
      void write(() => acts[ACT_KIND.AGENTS_CHAT_REACT](params), {
        refused: (answer) => ("failure" in answer ? CHAT_REACTION_REFUSED_WORDS : undefined),
        unanswered: CHAT_REACTION_REFUSED_WORDS,
        went: BUZZ.SELECTION,
      }).finally(() => setPresses((was) => was.filter((each) => each !== press)));
    },
    [acts, write, agentId],
  );

  const drawn = useCallback(
    <Message extends ManagerChatLiveMessage>(messages: readonly Message[]) =>
      presses.reduce(withReactionPress, messages),
    [presses],
  );

  return useMemo(() => ({ react, drawn }), [react, drawn]);
}
