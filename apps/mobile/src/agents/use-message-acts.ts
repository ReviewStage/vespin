/**
 * use-message-acts.ts -- what an agent's messages offer past copying and sharing them, as the panel's message actions offer it: a line of the member's Edit, a Manager's chat message Mark as unread, and an agent's finished turn Fork to new agent and Rewind conversation to here.
 *
 * Where each lands is the panel's (`@repo/features/agent-rewind-model`'s
 * `rewindPoints` and `editsInPlace`): Edit on a person's line that opened a
 * turn, never a comment's, a Slack message's, one said on a call, or files
 * alone; Rewind conversation to here on a reply some such line follows.
 * Edit and Rewind are offered only while the agent takes messages, not archived and
 * with no call of this phone's standing into it, as the service refuses a
 * rewind under a call. Rewind asks first, in the panel's words
 * (`revertAsk`), and sends the panel's `AGENTS_REWIND`; only the
 * conversation goes back from the phone, the files staying as they are.
 * Edit lays the line's words in the composer, which sends them in its place
 * (`use-agent-composer.ts`); a line that carried files is written again only
 * on the desktop and the web, since the phone does not read a line's files
 * back into its field. A Manager's chat, in the channel and in a thread, is
 * a team channel instead, as the panel's is: Edit stands on each of the
 * reader's own messages that has words, whatever opened a turn, and its words
 * are saved in place, the message marked edited and the Manager told, its
 * files and everything after it standing as they were
 * (`AGENTS_CHAT_EDIT`); nothing is rewound, and no Rewind conversation to
 * here is offered there. Fork to new agent opens New agent as the panel's
 * fork opens its draft (`@repo/features/agent-fork-model`), on a turn of
 * an agent that stands under a task and is not archived.
 */

import { FORK_WORDS, messageOpening } from "@repo/features/agent-fork-model";
import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  editsInPlace,
  REWIND_WORDS,
  revertAsk,
  rewindPoints,
  sameRewindPoints,
} from "@repo/features/agent-rewind-model";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { INBOX_READ_MARK } from "@repo/features/inbox-list-model";
import { ACT_KIND } from "@repo/host/acts";
import type { AppTranscript } from "@repo/host/app-state";
import type { FollowedAgent } from "@repo/host/app-state-reads";
import { GLYPH, type HeldAct, type MessageItem, TRANSCRIPT_ITEM, useKept } from "@repo/ui-native";
import { MESSAGE_ROLE } from "@repo/wire";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import type { AgentComposer } from "./use-agent-composer.js";

/** A sent line, as the transcript draws it. */
type SaidItem = Extract<MessageItem, { kind: typeof TRANSCRIPT_ITEM.SAID }>;

/** What a message's acts and Rewind's question are drawn with. */
export interface MessageActs {
  /** What the message offers past copying and sharing it, in the panel's order. */
  readonly more: (item: MessageItem) => readonly HeldAct[];
  /** The question Rewind conversation to here asks first, as `ConfirmAsk` takes it. */
  readonly reverting: {
    readonly title: string;
    readonly message: string;
    readonly act: string;
    readonly presented: boolean;
    readonly onAct: () => void;
    readonly onDismiss: () => void;
  };
}

/** The rewinds' points as last read, where they land in the same places as the points read now. */
function keptPoints<P extends Parameters<typeof sameRewindPoints>[0]>(held: P, built: P): P {
  return sameRewindPoints(held, built) ? held : built;
}

/** The lines a person wrote as last read, where each stands as the same message. */
function keptLines<M>(
  held: ReadonlyMap<string, M>,
  built: ReadonlyMap<string, M>,
): ReadonlyMap<string, M> {
  return held.size === built.size && [...built].every(([id, line]) => held.get(id) === line)
    ? held
    : built;
}

/**
 * The acts of the messages of the agent `agentId` names, whose row is
 * `agent`, whose transcript the page holds as `transcript`, read by
 * `readerId`; `calling` while this phone's call into it stands.
 */
export function useMessageActs(input: {
  readonly agentId: string;
  readonly agent: FollowedAgent | undefined;
  readonly transcript: AppTranscript | undefined;
  readonly readerId: string | undefined;
  readonly composer: Pick<AgentComposer, "editMessage">;
  readonly calling: boolean;
  /** Where the messages are a Manager's chat's, the ids of those the chat holds, each standing under its row's id, whose Edit saves the reader's own words in place; none for any other agent. A message still on its way or refused stands under its send's key instead, so it offers no such Edit, keeping its own. */
  readonly chatMessages?: ReadonlySet<string> | undefined;
  /** Moves the reader's mark of a Manager's chat back to just before one of its messages, by its id and when it was sent, as its Mark as unread presses; none for any other agent. */
  readonly markUnread?: ((messageId: string, sentAt: number) => void) | undefined;
}): MessageActs {
  const { agentId, agent, transcript, readerId, composer, calling, chatMessages, markUnread } =
    input;

  const acts = useHostActs();
  const write = useWrite();
  const router = useRouter();
  // The line a reply's Rewind conversation to here drops from, while its question stands, with the reply it was asked on.
  const [asked, setAsked] = useState<{ readonly reply: string; readonly line: string }>();
  const messages = transcript?.messages;
  const sending = transcript?.sending;

  const built = useMemo(
    () =>
      rewindPoints(
        messages ?? [],
        (sending ?? []).length > 0,
        readerId,
        new Set((sending ?? []).map((line) => line.clientKey)),
      ),
    [messages, sending, readerId],
  );

  // Note that the points and the lines a person wrote are kept while they stand the same, as a turn moving with no line or reply landing leaves them, so the acts read through them, which every message's row draws, are made again only as they move.
  const points = useKept(built, keptPoints);

  const byId = useKept(
    useMemo(
      (): ReadonlyMap<string, AgentTranscriptMessage> =>
        new Map(
          (messages ?? []).flatMap((message) =>
            message.role === MESSAGE_ROLE.USER ? [[message.id, message] as const] : [],
          ),
        ),
      [messages],
    ),
    keptLines,
  );

  const standing = agent !== undefined && agent.archivedAt === undefined;
  const rewinds = standing && !calling;
  const taskId = agent?.taskId;
  const forks = standing && taskId !== undefined;

  const revert = (line: string) => {
    write(() => acts[ACT_KIND.AGENTS_REWIND]({ agentId, messageId: line }), {
      refused: (answer) => ("failure" in answer ? messageFailureWords(answer.failure) : undefined),
      unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
    });
  };

  const more = useCallback(
    (message: MessageItem): readonly HeldAct[] => {
      const fork = (messageId: string, words: string) =>
        router.push({
          pathname: "/start-agent",
          params: { task: taskId, forkOf: agentId, at: messageId, opening: messageOpening(words) },
        });

      /** A message of a Manager's chat's Edit, on the reader's own with words while the Manager stands unarchived, which lays its words in the field to save in place. */
      const chatActs = (item: SaidItem, held: ReadonlySet<string>): readonly HeldAct[] =>
        standing && !item.received && held.has(item.place.row) && item.words.trim() !== ""
          ? [
              {
                label: REWIND_WORDS.EDIT,
                symbol: GLYPH.EDIT_MESSAGE,
                onPress: () =>
                  composer.editMessage({
                    messageId: item.place.row,
                    words: item.words,
                    cuts: false,
                    takes: undefined,
                  }),
              },
            ]
          : [];

      /** A line's Edit, where it opened a turn a person wrote, carried words alone, and the agent takes messages. */
      const lineActs = (item: SaidItem): readonly HeldAct[] => {
        if (chatMessages !== undefined) return chatActs(item, chatMessages);
        const id = item.place.row;
        const line = byId.get(id);
        const { words } = item;

        const offered =
          rewinds &&
          line !== undefined &&
          points.editable.has(id) &&
          editsInPlace(line, words.trim()) &&
          (item.pictures ?? []).length +
            (item.wordPictures?.size ?? 0) +
            (item.files ?? []).length ===
            0;

        return offered
          ? [
              {
                label: REWIND_WORDS.EDIT,
                symbol: GLYPH.EDIT_MESSAGE,
                onPress: () =>
                  composer.editMessage({
                    messageId: id,
                    words,
                    cuts: points.followed.has(id),
                    takes: points.editTakes.get(id),
                  }),
              },
            ]
          : [];
      };

      /** A finished turn's Fork to new agent and Rewind conversation to here, in the panel's order, each where it is offered. */
      const turnActs = (id: string, words: string): readonly HeldAct[] => {
        // Note that a Manager's chat offers no rewind, as a channel takes nothing back; its messages are edited in place instead.
        const line = rewinds && chatMessages === undefined ? points.revertsAt.get(id) : undefined;

        return [
          ...(forks
            ? [{ label: FORK_WORDS.ACTION, symbol: GLYPH.FORK, onPress: () => fork(id, words) }]
            : []),
          // Note that a turn of no words offers no rewind, as the panel's foot draws only where it copies or forks.
          ...(line === undefined || (words.trim() === "" && !forks)
            ? []
            : [
                {
                  label: REWIND_WORDS.REVERT,
                  symbol: GLYPH.REWIND,
                  destructive: true,
                  onPress: () => setAsked({ reply: id, line }),
                },
              ]),
        ];
      };

      /** Mark as unread on a message of a Manager's chat, anyone's, where the page offers it; never on the greeting or a line still on its way, which the chat holds no row of. */
      const readActs = (item: SaidItem): readonly HeldAct[] => {
        const sentAt = item.at;
        const kept = chatMessages?.has(item.place.row) === true;

        if (markUnread === undefined || !kept || sentAt === undefined) return [];

        return [
          {
            label: INBOX_READ_MARK.UNREAD,
            symbol: GLYPH.MARK_UNREAD,
            onPress: () => markUnread(item.place.row, sentAt),
          },
        ];
      };

      return message.kind === TRANSCRIPT_ITEM.FOOT
        ? turnActs(message.place.message, message.copy)
        : [...lineActs(message), ...readActs(message)];
    },
    [
      agentId,
      byId,
      chatMessages,
      composer,
      forks,
      markUnread,
      points,
      rewinds,
      router,
      standing,
      taskId,
    ],
  );

  const ask = revertAsk(
    asked === undefined ? undefined : points.revertTakes.get(asked.reply),
    false,
  );

  // Note that a question whose line is no longer where it was, dropped or rewound elsewhere, asks nothing.
  const stands = asked !== undefined && points.revertsAt.get(asked.reply) === asked.line;

  return {
    more,
    reverting: {
      title: ask.title,
      message: ask.body,
      act: ask.verb,
      presented: stands && rewinds,
      onAct: () => {
        setAsked(undefined);

        if (stands) revert(asked.line);
      },
      onDismiss: () => setAsked(undefined),
    },
  };
}
