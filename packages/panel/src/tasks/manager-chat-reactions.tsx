/**
 * manager-chat-reactions.tsx -- a Manager chat message's 👍 and 👎: the presses among its actions, and the chips under it of each reaction it was given, each a press that gives the reader's own or takes it back.
 *
 * Every message of the chat with an id, in the channel or in a thread, may
 * be given a 👍 or a 👎: two presses first among the actions over its
 * corner, before Reply in thread, each pressed where the reader gave it,
 * and under its words a chip to each reaction it was given (`@repo/ui`'s
 * `ReactionChip`), its emoji and how many gave it, lit where the reader
 * did. Pressing either takes the reader's own back where it
 * stands, and gives it where it does not.
 *
 * A press is drawn at once (`useChatReact`): over the window's document
 * until its ask settles (`drawAhead`), by when the host has written it into
 * the chat it holds where the service took it (`manager-chat-follow.ts`),
 * and where it did not, the press goes and a toast says so.
 */

import { LIVE_READ } from "@repo/features/live-wire";
import {
  MANAGER_CHAT_REACTION,
  type ManagerChatLiveMessage,
  type ManagerChatReaction,
  type ManagerChatReactionPress,
  withReactionPress,
} from "@repo/features/manager-chat-live";
import {
  CHAT_REACTION_REFUSED_WORDS,
  chatReactionWords,
  MANAGER_CHAT_REACTION_FACES,
} from "@repo/features/manager-chat-view";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { ReactionChip, ReactionRow, STATUS_TONE } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback } from "react";
import { pressMutation } from "../act-mutations.js";
import { MessageAction } from "../ai-elements/message.js";
import { showToast } from "../toast.js";
import { drawAhead } from "../use-app-state.js";

/** The reactions the actions offer, in the order they stand. */
const OFFERED: readonly ManagerChatReaction[] = Object.values(MANAGER_CHAT_REACTION);

/** Gives the reader's reaction to a message of the chat, or takes it off, as the press says. */
export type ChatReact = (press: ManagerChatReactionPress) => void;

/** `state` with `press` drawn on `agentId`'s chat as the window holds it; the very document where the chat holds no such message or its reaction stands so already. */
function withChatPress(
  state: AppStateSnapshot,
  agentId: string,
  press: ManagerChatReactionPress,
): AppStateSnapshot {
  const chats = state[LIVE_READ.MANAGER_CHAT];
  const held = chats[agentId];
  const chat = held?.rows;

  if (held === undefined || chat === undefined) return state;
  const messages = withReactionPress(chat.messages, press);

  if (messages === chat.messages) return state;

  return {
    ...state,
    [LIVE_READ.MANAGER_CHAT]: { ...chats, [agentId]: { ...held, rows: { ...chat, messages } } },
  };
}

/** Whether the reader gave `message` the reaction `kind`. */
function reactedTo(message: ManagerChatLiveMessage, kind: ManagerChatReaction): boolean {
  return message.reactions?.some((each) => each.kind === kind && each.reacted) ?? false;
}

/** The press that gives `agentId`'s chat's messages the reader's reactions or takes them off, each drawn at once over the window's document until its ask settles; one the host or the service refused says so on a toast as it is taken back off. */
export function useChatReact(agentId: string): ChatReact {
  const client = useQueryClient();
  const { mutateAsync: react } = useMutation(pressMutation(ACT_KIND.AGENTS_CHAT_REACT));

  return useCallback(
    (press: ManagerChatReactionPress) => {
      // Note that the press is drawn before it is asked, so a fixture run's answer, which stages the document again as it is asked, lands over it.
      const { promise: settled, resolve } = Promise.withResolvers<void>();
      drawAhead(client, (state) => withChatPress(state, agentId, press), settled);
      // Note that the host's refusal is said by the mutation's toast, and the service's, which answers rather than fails, here.
      react({ agentId, ...press }).then(
        (answer) => {
          if ("failure" in answer) {
            showToast({
              words: CHAT_REACTION_REFUSED_WORDS,
              tone: STATUS_TONE.DANGER,
              failure: {
                surface: FAILURE_SURFACE.ACT,
                act: ACT_KIND.AGENTS_CHAT_REACT,
                cause: answer,
                about: failureAboutOf({ agentId }),
              },
            });
          }

          resolve();
        },
        () => resolve(),
      );
    },
    [agentId, client, react],
  );
}

/** The 👍 and 👎 among a message's actions, each pressed where the reader gave it, a press giving it or taking it back. */
export function ReactMessageActions({
  message,
  react,
}: {
  message: ManagerChatLiveMessage;
  react: ChatReact;
}): ReactNode {
  return OFFERED.map((kind) => {
    const reacted = reactedTo(message, kind);
    const face = MANAGER_CHAT_REACTION_FACES[kind];

    return (
      <MessageAction
        key={kind}
        label={face.press}
        tooltip
        pressed={reacted}
        onClick={() => react({ messageId: message.id, kind, reacted: !reacted })}
      >
        <span aria-hidden="true">{face.emoji}</span>
      </MessageAction>
    );
  });
}

/** The reactions a message was given, under its words, each a press that gives the reader's own or takes it back; nothing where it was given none. */
export function ChatReactions({
  message,
  react,
}: {
  message: ManagerChatLiveMessage;
  react: ChatReact;
}): ReactNode {
  const reactions = message.reactions ?? [];

  if (reactions.length === 0) return null;

  return (
    <ReactionRow>
      {reactions.map((reaction) => (
        <ReactionChip
          key={reaction.kind}
          emoji={MANAGER_CHAT_REACTION_FACES[reaction.kind].emoji}
          count={reaction.count}
          label={chatReactionWords(reaction)}
          reacted={reaction.reacted}
          onPress={() =>
            react({ messageId: message.id, kind: reaction.kind, reacted: !reaction.reacted })
          }
        />
      ))}
    </ReactionRow>
  );
}
