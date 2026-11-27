// inbox-settled-asks.ts -- what a thread's asks still show once answered, as the panel draws them: the ask's controls at the head of the reply that answered it, as the answer left them, and a mark on an ask the thread shows answered with no such card.

import { answeredDraft, answerOf, type InboxDraft } from "./inbox-draft.js";
import { type InboxKnownAsk, knownAsk } from "./inbox-list-model.js";
import { INBOX_ASK, INBOX_ASK_STATUS, type InboxAsk, type InboxMessage } from "./inbox-wire.js";

/**
 * The ask a member's reply answered, as its card stands at the head of that
 * reply: the ask, and the draft the answer left it holding (its picks, its
 * steps ticked and its press, its fields' values), which the card draws
 * checked and filled, taking nothing. `stamped` says whether the reply's
 * stamp still stands over it: a to-do's, which says how it was pressed,
 * since its steps alone do not; a pick's and a form's card says all its
 * stamp and values would.
 */
export interface InboxAnsweredAsk {
  readonly ask: InboxKnownAsk;
  readonly draft: InboxDraft;
  readonly stamped: boolean;
}

/** Whether an ask draws any controls once it no longer waits: every one but an `answer` of words alone, whose reply's words are the answer. */
export function askHasControls(ask: InboxAsk): boolean {
  return ask.type !== INBOX_ASK.ANSWER || ask.fields !== undefined;
}

/**
 * Each reply of the thread that answered an ask, by the reply's id, with
 * the ask as its card draws it, as the panel's `AnsweredCard` stands it.
 * None for a reply whose ask the read no longer carries, or this build
 * does not know, or one of words alone: its stamp and values say it.
 */
export function inboxAnsweredAsks(
  thread: readonly InboxMessage[],
): ReadonlyMap<string, InboxAnsweredAsk> {
  const byId = new Map(thread.map((message) => [message.id, message]));

  return new Map(
    thread.flatMap((message): (readonly [string, InboxAnsweredAsk])[] => {
      const answers = message.answers;
      const ask = answers === undefined ? undefined : byId.get(answers.ask)?.ask;

      if (answers === undefined || ask === undefined || !knownAsk(ask) || !askHasControls(ask)) {
        return [];
      }

      return [
        [
          message.id,
          { ask, draft: answeredDraft(ask, answers), stamped: ask.type === INBOX_ASK.DO },
        ],
      ];
    }),
  );
}

/**
 * The messages whose ask stands answered with no card at the head of a
 * reply to say so, by id, as the panel ends each with "Answered": an ask
 * of words alone, whose reply's words are the answer, and any ask whose
 * reply the read no longer carries.
 */
export function inboxAnsweredMarks(thread: readonly InboxMessage[]): ReadonlySet<string> {
  return new Set(
    thread.flatMap((message) => {
      const ask = message.ask;

      if (ask?.status !== INBOX_ASK_STATUS.ANSWERED) return [];

      const replied = answerOf(thread, message.id)?.answers !== undefined;

      return !replied || (knownAsk(ask) && !askHasControls(ask)) ? [message.id] : [];
    }),
  );
}
