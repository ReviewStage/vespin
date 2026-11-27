/**
 * manager-chat-reactions.tsx -- a Manager chat message's reactions: 👍, 👎, and any emoji picked, among its actions and in its menu, and the chips under it of each reaction it was given, each a press that gives the reader's own or takes it back.
 *
 * Every message of the chat with an id, in the channel or in a thread, may
 * be given any emoji Slack names as a reaction: 👍 and 👎 first among the
 * actions over its corner, each pressed where the reader gave it, then Add
 * reaction, which hangs the app's one emoji picker (`@repo/ui`'s
 * `IconPicker` over `IconPickerEmoji`, as a section's icon and a Manager's
 * face pick emoji), 👍 and 👎 leading it, all before Reply in thread; its menu offers the
 * same, Add reaction › opening the picker beside it. Under its words a
 * chip stands to each reaction it was given (`@repo/ui`'s `ReactionChip`),
 * its emoji and how many gave it, lit where the reader did. Pressing a
 * press, a chip, or an emoji picked takes the reader's own back where it
 * stands, and gives it where it does not, as Slack's do. An emoji picked
 * is given by the name Slack gives it (`reactionOfEmoji`), from Slack's
 * table, loaded the first time one is picked.
 *
 * A press is drawn at once (`useChatReact`): over the window's document
 * until its ask settles (`drawAhead`), by when the host has written it into
 * the chat it holds where the service took it (`manager-chat-follow.ts`),
 * and where it did not, the press goes and a toast says so.
 */

import type { EmojiGroup } from "@repo/features/emoji-model";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  MANAGER_CHAT_REACTION,
  type ManagerChatLiveMessage,
  type ManagerChatReaction,
  type ManagerChatReactionPress,
  reactionOfEmoji,
  withReactionPress,
} from "@repo/features/manager-chat-live";
import {
  CHAT_ADD_REACTION_WORDS,
  CHAT_REACTION_PICKER_WORDS,
  CHAT_REACTION_REFUSED_WORDS,
  CHAT_REACTION_UNNAMED_WORDS,
  chatReactionEmoji,
  chatReactionWords,
  MANAGER_CHAT_REACTION_FACES,
} from "@repo/features/manager-chat-view";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { slackEmojiIndex } from "@repo/features/slack-emoji";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  BUTTON_SIZE,
  HeldMessageAction,
  IconPicker,
  IconPickerEmoji,
  IconPickerMenuPanel,
  POPOVER_WIDTH,
  PopoverIconButton,
  ReactionChip,
  ReactionRow,
  STATUS_TONE,
  useEmojiGroups,
} from "@repo/ui";
import { SmilePlusIcon } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useCallback, useRef, useState } from "react";
import { pressMutation } from "../act-mutations.js";
import { MessageAction } from "../ai-elements/message.js";
import type { MenuEntry } from "../desktop/action-menu.js";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast } from "../toast.js";
import { drawAhead } from "../use-app-state.js";

/** The reactions the actions offer, in the order they stand. */
const OFFERED: readonly ManagerChatReaction[] = Object.values(MANAGER_CHAT_REACTION);

/** Gives the reader's reaction to a message of the chat, or takes it off, as the press says. */
export type ChatReact = (press: ManagerChatReactionPress) => void;

/** Slack's names for every emoji, loaded once per window the first time a reaction is picked. */
const slackEmojiQuery = queryOptions({
  queryKey: [QUERY_ROOT.SLACK_EMOJI],
  queryFn: () =>
    import("@repo/features/slack-emoji-names").then((module) =>
      slackEmojiIndex(module.SLACK_EMOJI_NAMES),
    ),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
});

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
function reactedTo(message: ManagerChatLiveMessage, kind: string): boolean {
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
      const { emoji, ...reaction } = press;

      react(emoji === undefined ? { agentId, ...reaction } : { agentId, ...reaction, emoji }).then(
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

/**
 * The press that gives `message` the reader's reaction of an emoji picked,
 * by the name Slack gives it, or takes it back where the reader gave it;
 * an emoji Slack names nothing says so on a toast.
 */
function usePickedReaction(message: ManagerChatLiveMessage, react: ChatReact) {
  const client = useQueryClient();

  return (emoji: string) =>
    void client.fetchQuery(slackEmojiQuery).then(
      (index) => {
        const reaction = reactionOfEmoji(index, emoji);

        if (reaction === undefined) {
          showToast({ words: CHAT_REACTION_UNNAMED_WORDS, tone: STATUS_TONE.ATTENTION });

          return;
        }

        react({
          messageId: message.id,
          kind: reaction.name,
          reacted: !reactedTo(message, reaction.name),
          emoji: reaction.emoji,
        });
      },
      () => showToast({ words: CHAT_REACTION_REFUSED_WORDS, tone: STATUS_TONE.ATTENTION }),
    );
}

/** The reactions offered first, leading the picker as they lead the actions. */
const QUICK: EmojiGroup = {
  name: CHAT_REACTION_PICKER_WORDS.QUICK,
  emojis: OFFERED.map((kind) => ({
    emoji: MANAGER_CHAT_REACTION_FACES[kind].emoji,
    name: MANAGER_CHAT_REACTION_FACES[kind].name,
    // Note that a lead is drawn only while nothing is searched, so it carries nothing a search reads.
    terms: [],
    words: [],
  })),
};

/**
 * The app's one emoji picker, as a section's icon and a Manager's face
 * pick emoji, offering every emoji as a reaction, 👍 and 👎 first; it
 * reads them the first time one stands open.
 */
function ReactionEmojiPicker({
  search,
  onEmoji,
}: {
  /** The search's field, which a popover opening the picker focuses first. */
  search?: RefObject<HTMLInputElement | null> | undefined;
  onEmoji: (emoji: string) => void;
}): ReactNode {
  const [query, setQuery] = useState("");
  const emoji = useEmojiGroups();

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel={CHAT_REACTION_PICKER_WORDS.SEARCH}
        search={search}
        query={query}
        onQuery={setQuery}
        legend={CHAT_REACTION_PICKER_WORDS.LEGEND}
      >
        <IconPickerEmoji
          groups={emoji.data}
          failed={emoji.isError}
          query={query}
          chosen={undefined}
          onEmoji={onEmoji}
          lead={QUICK}
        />
      </IconPicker>
    </ReplayUnmask>
  );
}

/** A message's Add reaction: a compact smile-plus among its actions, hanging the picker while `open`; a pick hands the emoji on and puts the picker away. */
function AddReactionAction({
  open,
  onOpenChange,
  onEmoji,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEmoji: (emoji: string) => void;
}): ReactNode {
  const search = useRef<HTMLInputElement | null>(null);

  return (
    <PopoverIconButton
      icon={<SmilePlusIcon aria-hidden="true" />}
      label={CHAT_ADD_REACTION_WORDS}
      title={CHAT_ADD_REACTION_WORDS}
      hint={CHAT_ADD_REACTION_WORDS}
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      size={BUTTON_SIZE.COMPACT}
      initialFocus={search}
    >
      <ReactionEmojiPicker
        search={search}
        onEmoji={(emoji) => {
          onEmoji(emoji);
          onOpenChange(false);
        }}
      />
    </PopoverIconButton>
  );
}

/** The 👍 and 👎 among a message's actions, each pressed where the reader gave it, a press giving it or taking it back, then Add reaction, the picker of every emoji. */
export function ReactMessageActions({
  message,
  react,
  picking,
  onPicking,
}: {
  message: ManagerChatLiveMessage;
  react: ChatReact;
  /** Whether Add reaction's picker stands open, which holds the message's actions shown (`ChannelMessage`'s `actionsHeld`). */
  picking: boolean;
  onPicking: (picking: boolean) => void;
}): ReactNode {
  const picked = usePickedReaction(message, react);

  return (
    <>
      {OFFERED.map((kind) => {
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
      })}
      <HeldMessageAction>
        <AddReactionAction open={picking} onOpenChange={onPicking} onEmoji={picked} />
      </HeldMessageAction>
    </>
  );
}

/** A message's reactions as its menu offers them: 👍 and 👎, each giving it or taking it back, then Add reaction ›, the picker of every emoji beside it. */
export function useChatReactionMenu(
  message: ManagerChatLiveMessage,
  react: ChatReact,
): readonly MenuEntry[] {
  const picked = usePickedReaction(message, react);

  const offered = OFFERED.map((kind) => {
    const reacted = reactedTo(message, kind);
    const face = MANAGER_CHAT_REACTION_FACES[kind];

    return {
      label: face.press,
      icon: <span aria-hidden="true">{face.emoji}</span>,
      onSelect: () => react({ messageId: message.id, kind, reacted: !reacted }),
    };
  });

  return [
    ...offered,
    {
      label: CHAT_ADD_REACTION_WORDS,
      icon: <SmilePlusIcon aria-hidden="true" />,
      width: POPOVER_WIDTH.FIT,
      panel: ({ close }) => (
        <IconPickerMenuPanel>
          <ReactionEmojiPicker
            onEmoji={(emoji) => {
              picked(emoji);
              close();
            }}
          />
        </IconPickerMenuPanel>
      ),
    },
  ];
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
          emoji={chatReactionEmoji(reaction)}
          count={reaction.count}
          label={chatReactionWords(reaction)}
          reacted={reaction.reacted}
          onPress={() =>
            react({
              messageId: message.id,
              kind: reaction.kind,
              reacted: !reaction.reacted,
              emoji: reaction.emoji,
            })
          }
        />
      ))}
    </ReactionRow>
  );
}
