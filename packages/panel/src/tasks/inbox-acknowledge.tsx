/**
 * inbox-acknowledge.tsx -- notices acknowledged by hand, Got it, at once and with Undo, from every place that settles one by a press: the Got it on a notice's card and Mark as read on its row, the selection, U, and Mark all as read.
 *
 * Got it is held as Resolve is (`inbox-close.tsx`): the notices read
 * settled at once in every read the window draws, and one toast offers Undo
 * for the hold, as ⌘Z does (`undo-stack.ts`'s held entries). Each nod goes
 * to the host held (`AGENTS_INBOX_ANSWER`'s `held`), which keeps it from the
 * service until the toast is gone, so an Undo takes it back before the
 * service settles the notice for every member, finishes its task, or tells
 * its agent (`AGENTS_INBOX_RELEASE`). A read mark the same press made keeps
 * its own Undo where it offers one, and this Undo leaves it as it stands, so
 * a notice taken back waits on the reader again, read.
 *
 * Each nod goes under a key of its own, at the revision the notice was
 * pressed on, so an agent's change since is never acknowledged unseen: the
 * service does not take it, and a toast says why. One a member or another
 * window settled first is passed over quietly, since what the press asked
 * already stands.
 */

import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
} from "@repo/features/agent-view";
import { INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { cardTitle } from "@repo/features/plain-words";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { type HeldWrite, pressHeld } from "../undo-stack.js";
import { messageFailureWords } from "./agent-model.js";
import {
  type HeldSettles,
  type ReleaseDoor,
  type Released,
  released,
  type Send,
  unheldSettles,
} from "./inbox-close.js";
import { acknowledgedNote } from "./inbox-writes.js";

/** What a nod the act channel refused hears, as the service not answering, with the error beneath. */
const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** What a toast says of a nod the service did not take on a notice still open: its agent changed it since it was shown. */
const CHANGED = "The agent changed this item before you acknowledged it.";

/** What a held nod's Undo says where it did not take it back. */
const UNHELD = {
  unreached: "Could not undo acknowledging. It goes through in a minute unless you try again.",
  late: "Too late to undo: it was already acknowledged.",
} as const;

/** Acknowledges the notices given, at once, with Undo; one already on its way is passed over. */
export type InboxAcknowledger = (items: readonly InboxItem[]) => void;

/** The mutations a Got it is sent on: the nod, held, and the release that lets its hold go. */
interface AcknowledgeDoors {
  readonly nod: Send<typeof ACT_KIND.AGENTS_INBOX_ANSWER>;
  readonly release: ReleaseDoor;
}

/** What one nod answered: the item as the service answered it, or why the service was not reached. */
type NodAnswer = AgentInboxAnsweredView | { readonly failure: AgentCallFailure };

/** What the Undo toast says: the one notice by its title, or how many. */
function acknowledgedWords(items: readonly InboxItem[]): string {
  const [only] = items;
  return items.length === 1 && only !== undefined
    ? `Acknowledged “${cardTitle(only.title)}”`
    : `${countWords(items.length, TERM.INBOX_ITEM)} acknowledged`;
}

/** Why the service did not take one nod, in a toast's words; none where it took it, or where the notice was settled first, which is what the press asked. */
function refusalWords(answer: NodAnswer): string | undefined {
  if ("failure" in answer) return messageFailureWords(answer.failure);
  return answer.taken || answer.item.status !== INBOX_STATUS.OPEN ? undefined : CHANGED;
}

/**
 * A Got it as the undo stack holds it (`undo-stack.ts`'s `HeldWrite`): each
 * nod sent held, let go as sent once its toast is gone, and taken back by
 * letting it go unsent, as a resolve is.
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
          held: true,
        }).catch(unreached),
      ),
    ),
  letGo: ({ release }, { keys }) => void released(release, keys, true),
  undo: ({ release }, { keys }) => released(release, keys, false),
  refused: ({ items }, answers) => {
    const refused = answers.flatMap((answer, at) => {
      const words = refusalWords(answer);
      const item = items[at];
      return words === undefined || item === undefined ? [] : [{ words, answer, item }];
    });
    const [first] = refused;
    if (first === undefined) return undefined;
    return {
      // Note that a nod the service never answered may still be held, so only a refusal of every one is whole.
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
    unheldSettles(settles, answers, UNHELD, FAILURE_SURFACE.INBOX_ANSWER),
} satisfies HeldWrite<AcknowledgeDoors, HeldSettles, readonly NodAnswer[], readonly Released[]>;

/** The Inbox's Got its by hand, each held by the host until its Undo toast is gone. */
export function useInboxAcknowledger(): InboxAcknowledger {
  const { mutateAsync: nod } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_ANSWER));
  const { mutateAsync: release } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_RELEASE));
  const out = useRef(new Set<string>());
  return useCallback(
    (items: readonly InboxItem[]) => {
      const nodding = items.filter((item) => !out.current.has(item.id));
      if (nodding.length === 0) return;
      for (const item of nodding) out.current.add(item.id);
      const settles = { items: nodding, keys: nodding.map(() => crypto.randomUUID()) };
      void pressHeld(ACKNOWLEDGE_WRITE, { nod, release }, settles).then(() => {
        for (const item of nodding) out.current.delete(item.id);
      });
    },
    [nod, release],
  );
}
