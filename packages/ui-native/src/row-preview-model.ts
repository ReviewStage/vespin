// row-preview-model.ts -- what a row's long press preview says: a thread's newest messages as plain words, and an agent's latest step read off the transcript the app already holds.

import type { InboxThreadMessage } from "@repo/features/inbox-list-model";
import type { ModelProvider } from "@repo/features/models-wire";
import { plainWords } from "@repo/features/plain-words";
import { TRANSCRIPT_ITEM, type TranscriptItem } from "./transcript-model.js";

/** How many of a thread's newest messages its preview draws: enough to read where it stands at a glance, as Mail's preview shows a message's start. */
const PREVIEW_MESSAGES = 3;

/** What parts an answer's stamp from the words sent with it. */
const STAMP_PART = " · ";

/** One message as a thread's preview draws it: its writer, when, and its words on a line or two. */
export interface PreviewMessage {
  readonly id: string;
  readonly writer: string;
  /** Whether the agent wrote it, whose tile stands beside it rather than a member's face. */
  readonly agent: boolean;
  /** A member writer's sign-in picture, where one is known. */
  readonly picture?: string | undefined;
  /** The provider whose harness the agent writer runs in, whose mark its tile wears; none for a member, or where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly at: number;
  readonly words: string;
}

/**
 * A thread's newest messages as its preview draws them, oldest first: each
 * said as plain words (`plainWords`), an answer's stamp before them ("Chose
 * 7 days · and say it in the docs"), and a message that says nothing in
 * words, a file sent alone, passed over.
 */
export function previewMessages(
  messages: readonly InboxThreadMessage[],
  pictureOf: (userId: string | undefined) => string | undefined = () => undefined,
  harness?: ModelProvider | undefined,
): readonly PreviewMessage[] {
  return messages
    .map((message) => ({
      id: message.id,
      writer: message.writer.name,
      agent: message.writer.agent,
      picture: message.writer.agent ? undefined : pictureOf(message.writer.userId),
      harness: message.writer.agent ? harness : undefined,
      at: message.at,
      words: [message.stamp?.words, plainWords(message.words)]
        .filter((part) => part !== undefined && part !== "")
        .join(STAMP_PART),
    }))
    .filter((message) => message.words !== "")
    .slice(-PREVIEW_MESSAGES);
}

/** An item's step as the preview says it, where it is one of the agent's own: its words, a call's line, or a fold's summary. */
function stepOf(item: TranscriptItem): string | undefined {
  switch (item.kind) {
    case TRANSCRIPT_ITEM.WORDS:
      return plainWords(item.words);
    case TRANSCRIPT_ITEM.CALL: {
      const { verb, subject } = item.line;

      return subject === undefined || subject === "" ? verb : `${verb} ${subject}`;
    }

    case TRANSCRIPT_ITEM.FOLD:
      return item.summary;
    default:
      return undefined;
  }
}

/**
 * The agent's latest step, as the panel's card says one: its last words as
 * plain words, or its last call's line, or the fold its last calls stand
 * in; a line someone sent it, what a call showed, and the line a working
 * transcript ends on are passed over. Nothing where it has done nothing yet.
 */
export function latestStep(items: readonly TranscriptItem[]): string | undefined {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at];
    const step = item === undefined ? undefined : stepOf(item);

    if (step !== undefined && step !== "") return step;
  }

  return undefined;
}
