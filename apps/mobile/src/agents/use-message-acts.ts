/**
 * use-message-acts.ts -- what an agent's messages offer past copying and sharing them, as the panel's message actions offer it: a line of the member's Edit, and an agent's finished turn Fork to new agent and Rewind conversation to here.
 *
 * Where each lands is the panel's (`@repo/features/agent-rewind-model`'s
 * `rewindPoints` and `editsInPlace`): Edit on a person's line that opened a
 * turn, never a comment's, a Slack message's, one said on a call, or files
 * alone; Rewind conversation to here on a reply some such line follows.
 * Every message of a Manager's chat, of any author's, offers Reply first,
 * which quotes it whole into the composer as the panel's Reply does.
 * Edit and Rewind are offered only while the agent takes messages, not archived and
 * with no call of this phone's standing into it, as the service refuses a
 * rewind under a call. Rewind asks first, in the panel's words
 * (`revertAsk`), and sends the panel's `AGENTS_REWIND`; only the
 * conversation goes back from the phone, the files staying as they are.
 * Edit lays the line's words in the composer, which sends them in its place
 * (`use-agent-composer.ts`), a Manager's chat message edited as the line it
 * went as (its row's `lineId`); a line that carried files is written again only
 * on the desktop and the web, since the phone does not read a line's files
 * back into its field. Fork to new agent opens New agent as the panel's
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

/** What Reply on a chat message says, as the panel's does. */
const REPLY_WORD = "Reply";

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
  readonly composer: Pick<AgentComposer, "editMessage" | "reply">;
  readonly calling: boolean;
  /** Each message of a Manager's chat by its row's id, to the transcript line it went as (`lineId`), which its Edit takes the Manager back to, or null for one that went as none, such as the Manager's own; none for any other agent. */
  readonly chatLines?: ReadonlyMap<string, string | null> | undefined;
}): MessageActs {
  const { agentId, agent, transcript, readerId, composer, calling, chatLines } = input;
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

      /** A line's Edit, where it opened a turn a person wrote, carried words alone, and the agent takes messages. */
      const lineActs = (item: SaidItem): readonly HeldAct[] => {
        // Note that a chat message stands under its row's id, and is edited as the transcript line it went as, so one with no line, the Manager's own, offers no Edit.
        const id = chatLines === undefined ? item.place.row : chatLines.get(item.place.row);

        if (id === undefined || id === null) return [];
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

      /** Reply on a chat message of any author's, which quotes its words whole into the composer, as every message of the panel's chat offers it; none for a message of no words, or outside a Manager's chat. */
      const replyActs = (item: SaidItem): readonly HeldAct[] =>
        // Note that the greeting and a message still on its way are no row of the chat, so they offer none.
        chatLines?.has(item.place.row) !== true || item.words.trim() === ""
          ? []
          : [
              {
                label: REPLY_WORD,
                symbol: GLYPH.REPLY,
                onPress: () => composer.reply(item.words),
              },
            ];

      /** A finished turn's Fork to new agent and Rewind conversation to here, in the panel's order, each where it is offered. */
      const turnActs = (id: string, words: string): readonly HeldAct[] => {
        const line = rewinds ? points.revertsAt.get(id) : undefined;

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

      return message.kind === TRANSCRIPT_ITEM.FOOT
        ? turnActs(message.place.message, message.copy)
        : [...replyActs(message), ...lineActs(message)];
    },
    [agentId, byId, chatLines, composer, forks, points, rewinds, router, taskId],
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
