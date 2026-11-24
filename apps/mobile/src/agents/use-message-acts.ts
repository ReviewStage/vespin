/**
 * use-message-acts.ts -- what an agent's messages offer past copying and sharing them, as the panel's message actions offer it: a line of the member's Edit, and an agent's finished turn Fork to new agent and Rewind conversation to here.
 *
 * Where each lands is the panel's (`@repo/features/agent-rewind-model`'s
 * `rewindPoints` and `editsInPlace`): Edit on a person's line that opened a
 * turn, never a comment's, a Slack message's, one said on a call, or files
 * alone; Rewind conversation to here on a reply some such line follows.
 * Both are offered only while the agent takes messages, not archived and
 * with no call of this phone's standing into it, as the service refuses a
 * rewind under a call. Rewind asks first, in the panel's words
 * (`revertAsk`), and sends the panel's `AGENTS_REWIND`; only the
 * conversation goes back from the phone, the files staying as they are.
 * Edit lays the line's words in the composer, which sends them in its place
 * (`use-agent-composer.ts`); a line that carried files is written again only
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
} from "@repo/features/agent-rewind-model";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppTranscript } from "@repo/host/app-state";
import type { FollowedAgent } from "@repo/host/app-state-reads";
import { GLYPH, type HeldAct, type MessageItem, TRANSCRIPT_ITEM } from "@repo/ui-native";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
}): MessageActs {
  const { agentId, agent, transcript, readerId, composer, calling } = input;
  const acts = useHostActs();
  const write = useWrite();
  const router = useRouter();
  // The line a reply's Rewind conversation to here drops from, while its question stands, with the reply it was asked on.
  const [asked, setAsked] = useState<{ readonly reply: string; readonly line: string }>();
  const messages = transcript?.messages;
  const sending = transcript?.sending;

  const points = useMemo(
    () =>
      rewindPoints(
        messages ?? [],
        (sending ?? []).length > 0,
        readerId,
        new Set((sending ?? []).map((line) => line.clientKey)),
      ),
    [messages, sending, readerId],
  );

  const byId = useMemo(
    () => new Map((messages ?? []).map((message) => [message.id, message])),
    [messages],
  );

  const standing = agent !== undefined && agent.archivedAt === undefined;
  const rewinds = standing && !calling;
  const taskId = agent?.taskId;
  const forks = standing && taskId !== undefined;

  const fork = (messageId: string, words: string) =>
    router.push({
      pathname: "/start-agent",
      params: { task: taskId, forkOf: agentId, at: messageId, opening: messageOpening(words) },
    });

  const revert = (line: string) => {
    write(() => acts[ACT_KIND.AGENTS_REWIND]({ agentId, messageId: line }), {
      refused: (answer) => ("failure" in answer ? messageFailureWords(answer.failure) : undefined),
      unanswered: messageFailureWords(AGENT_CALL_FAILURE.UNANSWERED),
    });
  };

  /** A line's Edit, where it opened a turn a person wrote, carried words alone, and the agent takes messages. */
  const lineActs = (item: SaidItem): readonly HeldAct[] => {
    const id = item.place.row;
    const line = byId.get(id);
    const { words } = item;

    const offered =
      rewinds &&
      line !== undefined &&
      points.editable.has(id) &&
      editsInPlace(line, words.trim()) &&
      (item.pictures ?? []).length + (item.wordPictures?.size ?? 0) + (item.files ?? []).length ===
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

  const ask = revertAsk(
    asked === undefined ? undefined : points.revertTakes.get(asked.reply),
    false,
  );

  // Note that a question whose line is no longer where it was, dropped or rewound elsewhere, asks nothing.
  const stands = asked !== undefined && points.revertsAt.get(asked.reply) === asked.line;

  return {
    more: (item) =>
      item.kind === TRANSCRIPT_ITEM.FOOT ? turnActs(item.place.message, item.copy) : lineActs(item),
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
