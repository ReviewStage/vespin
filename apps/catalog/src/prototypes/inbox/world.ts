/**
 * world.ts -- what a design's member has done since it opened: the replies
 * they wrote, the options they chose, the messages they forked from, and
 * what the agent answered a beat later.
 *
 * Each design holds a world of its own, so switching designs starts afresh.
 * The agent's answer is written at once but shown only once its moment
 * passes, read off `@repo/ui`'s second clock, so no timer is armed here.
 */

import { useSecond } from "@repo/ui";
import { useState } from "react";
import {
  AGENT_ANSWER,
  type AgentState,
  AUTHOR,
  type Author,
  CHAT,
  CHAT_KIND,
  type ChatItem,
  decidedAnswer,
  NOW,
  THREADS,
  type Thread,
  type ThreadId,
  type ThreadMessage,
  timeIn,
} from "./data";

/** How long the agent takes to answer a reply, in real milliseconds. */
const ANSWER_DELAY_MS = 2200;

/** When the page loaded, so a new message's time counts on from the prototype's "now". */
const LOADED = Date.now();

interface Added {
  readonly id: string;
  /** The thread it was written on, or none for a line written in the chat itself. */
  readonly thread: ThreadId | undefined;
  readonly author: Author;
  readonly text: string;
  /** The real time it may be shown from. */
  readonly showAt: number;
}

export interface World {
  /** A thread as it stands now, its messages in `state`'s times and the member's own after them. */
  readonly thread: (id: ThreadId) => Thread;
  /** The option chosen on a thread's ask, if one was. */
  readonly decided: (id: ThreadId) => string | undefined;
  /** Whether the agent's answer to a reply is still on its way. */
  readonly answering: (id: ThreadId) => boolean;
  /** The agent's chat, oldest first, with every reply and answer in it. */
  readonly chat: readonly ChatItem[];
  /** The ids of the messages forked from. */
  readonly forked: ReadonlySet<string>;
  /** The threads opened at least once, which read as seen. */
  readonly seen: ReadonlySet<ThreadId>;
  readonly reply: (id: ThreadId, text: string) => void;
  /** Writes in the chat itself, on no thread, the agent answering `answer` where given. */
  readonly say: (text: string, answer?: string) => void;
  readonly decide: (id: ThreadId, label: string) => void;
  readonly fork: (messageId: string) => void;
  readonly see: (id: ThreadId) => void;
}

/** The prototype's time for a real one: its "now", moved on by what has passed since the page loaded. */
function prototypeTime(real: number): number {
  return NOW + (real - LOADED);
}

function threadOf(id: ThreadId): Thread {
  const thread = THREADS.find((each) => each.id === id);
  if (thread === undefined) throw new Error(`No thread ${id}`);
  return thread;
}

export function useWorld(state: AgentState): World {
  const second = useSecond();
  const [added, setAdded] = useState<readonly Added[]>([]);
  const [choices, setChoices] = useState<ReadonlyMap<ThreadId, string>>(new Map());
  const [forked, setForked] = useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = useState<ReadonlySet<ThreadId>>(new Set());
  const shown = added.filter((each) => each.showAt <= second);

  const send = (id: ThreadId | undefined, text: string, answer: string) => {
    const at = Date.now();
    setAdded((was) => [
      ...was,
      { id: `sent-${at}`, thread: id, author: AUTHOR.MEMBER, text, showAt: at },
      {
        id: `answer-${at}`,
        thread: id,
        author: AUTHOR.AGENT,
        text: answer,
        showAt: at + ANSWER_DELAY_MS,
      },
    ]);
  };

  const thread = (id: ThreadId): Thread => {
    const base = threadOf(id);
    const messages: ThreadMessage[] = [
      ...base.messages.map((message) => ({ ...message, at: timeIn(state, message.at) })),
      ...shown
        .filter((each) => each.thread === id)
        .map((each) => ({
          id: each.id,
          author: each.author,
          text: each.text,
          at: prototypeTime(each.showAt),
          sentToChat: each.author === AUTHOR.MEMBER,
        })),
    ];
    return { ...base, openedAt: timeIn(state, base.openedAt), messages };
  };

  const chat: ChatItem[] = [
    ...CHAT.map((item) => ({ ...item, at: timeIn(state, item.at) })),
    ...shown.map((each) => ({
      id: each.id,
      kind:
        each.author === AUTHOR.AGENT
          ? CHAT_KIND.TURN
          : each.thread === undefined
            ? CHAT_KIND.MEMBER
            : CHAT_KIND.THREAD_REPLY,
      at: prototypeTime(each.showAt),
      text: each.text,
      ...(each.thread === undefined ? {} : { thread: each.thread }),
    })),
  ];

  return {
    thread,
    decided: (id) => choices.get(id),
    answering: (id) =>
      added.some(
        (each) => each.thread === id && each.author === AUTHOR.AGENT && each.showAt > second,
      ),
    chat,
    forked,
    seen,
    reply: (id, text) => send(id, text, AGENT_ANSWER[state]),
    say: (text, answer) => send(undefined, text, answer ?? AGENT_ANSWER[state]),
    decide: (id, label) => {
      setChoices((was) => new Map(was).set(id, label));
      send(id, `Chose “${label}”.`, decidedAnswer(label));
    },
    fork: (messageId) => setForked((was) => new Set(was).add(messageId)),
    see: (id) => setSeen((was) => (was.has(id) ? was : new Set(was).add(id))),
  };
}
