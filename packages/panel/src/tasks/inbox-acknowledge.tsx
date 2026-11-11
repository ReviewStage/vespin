/**
 * inbox-acknowledge.tsx -- notices acknowledged by hand, Got it, at once and with Undo, from every place that settles one by a press: the Got it on a notice's card and Mark as read on its row, the selection, U, and Mark all as read.
 *
 * Got it is undone as Resolve is (`inbox-close.tsx`): the notices read
 * settled at once in every read the window draws, and one toast offers
 * Undo, as ⌘Z does for as long as it keeps the entry, its toast gone or not
 * (`undo-stack.ts`'s take-back entries). Each nod goes to the service at
 * once, and its Undo takes it back there by its key
 * (`AGENTS_INBOX_TAKE_BACK`), the notice waiting on the reader again; one
 * whose agent was told, a notice waiting to hear back, cannot be, and its
 * Undo says so. A read mark the same press made keeps its own Undo where it
 * offers one, and this Undo leaves it as it stands, so a notice taken back
 * waits on the reader again, read.
 *
 * Each nod goes under a key of its own, at the revision the notice was
 * pressed on, so an agent's change since is never acknowledged unseen: the
 * service does not take it, and a toast says why. One a member or another
 * window settled first is passed over quietly, since what the press asked
 * already stands.
 */

import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
} from "@repo/features/agent-view";
import { INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { acknowledgedNote } from "@repo/features/inbox-write-words";
import { cardTitle } from "@repo/features/plain-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { pressTakeBack, type TakeBackWrite } from "../undo-stack.js";
import {
  type Send,
  type Settles,
  type TakeBackDoor,
  type TookBack,
  tookBack,
  untakenSettles,
} from "./inbox-close.js";

/** What a nod the act channel refused hears, as the service not answering, with the error beneath. */
const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** What a toast says of a nod the service did not take on a notice still open: its agent changed it since it was shown. */
const CHANGED = "The agent changed this item before you pressed Got it.";

/** What a Got it's Undo says where the service did not take it back. */
const ACKNOWLEDGE_UNTAKEN = {
  unreached: "Could not undo Got it.",
  told: "Can't undo: the agent was already told.",
  movedOn: "Can't undo: it changed since you pressed Got it.",
} as const;

/** Acknowledges the notices given, at once, with Undo; one already on its way is passed over. */
export type InboxAcknowledger = (items: readonly InboxItem[]) => void;

/** The mutations a Got it is sent on: the nod, and the take-back its Undo asks. */
interface AcknowledgeDoors {
  readonly nod: Send<typeof ACT_KIND.AGENTS_INBOX_ANSWER>;
  readonly takeBack: TakeBackDoor;
}

/** What one nod answered: the item as the service answered it, or why the service was not reached. */
type NodAnswer = AgentInboxAnsweredView | { readonly failure: AgentCallFailure };

/** What the Undo toast says: the one notice by its title, or how many. */
function acknowledgedWords(items: readonly InboxItem[]): string {
  const [only] = items;
  return items.length === 1 && only !== undefined
    ? `Got it: “${cardTitle(only.title)}”`
    : `Got it: ${countWords(items.length, TERM.INBOX_ITEM)}`;
}

/** Why the service did not take one nod, in a toast's words; none where it took it, or where the notice was settled first, which is what the press asked. */
function refusalWords(answer: NodAnswer): string | undefined {
  if ("failure" in answer) return messageFailureWords(answer.failure);
  return answer.taken || answer.item.status !== INBOX_STATUS.OPEN ? undefined : CHANGED;
}

/**
 * A Got it as the undo stack holds it (`undo-stack.ts`'s `TakeBackWrite`):
 * each nod sent at once, and taken back by its key whenever its Undo asks,
 * as a resolve is.
 */
const ACKNOWLEDGE_WRITE = {
  words: ({ items }) => acknowledgedWords(items),
  glyph: () => <GLYPH.DONE />,
  // Note that one notice's toast quotes its title, which a screen recording masks.
  unmasked: ({ items }) => items.length > 1,
  act: ({ nod }, { items, keys }) =>
    Promise.all(
      items.map((item, at) =>
        nod({
          itemId: item.id,
          revision: item.revision,
          reply: INBOX_REPLY.ACKNOWLEDGED,
          clientKey: keys[at] ?? "",
        }).catch(unreached),
      ),
    ),
  undo: ({ takeBack }, settles) => tookBack(takeBack, settles),
  refused: ({ items }, answers) => {
    const refused = answers.flatMap((answer, at) => {
      const words = refusalWords(answer);
      const item = items[at];
      return words === undefined || item === undefined ? [] : [{ words, answer, item }];
    });
    const [first] = refused;
    if (first === undefined) return undefined;
    return {
      // Note that a nod the service never answered may have landed, so only a refusal of every one is whole.
      whole: answers.every((answer) => !("failure" in answer) && !answer.taken),
      words:
        items.length === 1
          ? first.words
          : acknowledgedNote(items.length - refused.length, refused.length),
      failure: {
        surface: FAILURE_SURFACE.INBOX_ANSWER,
        cause: first.answer,
        about: { inboxItemId: first.item.id, agentId: first.item.agentId },
      },
    };
  },
  unheld: (settles, answers) =>
    untakenSettles(settles, answers, ACKNOWLEDGE_UNTAKEN, FAILURE_SURFACE.INBOX_ANSWER),
} satisfies TakeBackWrite<AcknowledgeDoors, Settles, readonly NodAnswer[], readonly TookBack[]>;

/** The Inbox's Got its by hand, each taken back by the service whenever its Undo asks. */
export function useInboxAcknowledger(): InboxAcknowledger {
  const { mutateAsync: nod } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_ANSWER));
  const { mutateAsync: takeBack } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_TAKE_BACK));
  const out = useRef(new Set<string>());
  return useCallback(
    (items: readonly InboxItem[]) => {
      const nodding = items.filter((item) => !out.current.has(item.id));
      if (nodding.length === 0) return;
      for (const item of nodding) out.current.add(item.id);
      const settles = { items: nodding, keys: nodding.map(() => crypto.randomUUID()) };
      void pressTakeBack(ACKNOWLEDGE_WRITE, { nod, takeBack }, settles).then(() => {
        for (const item of nodding) out.current.delete(item.id);
      });
    },
    [nod, takeBack],
  );
}
