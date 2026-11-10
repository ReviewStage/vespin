import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
} from "@repo/features/agent-view";
import { RESOLVE } from "@repo/features/inbox-ask-words";
import { INBOX_STATUS, type InboxItem, type InboxStatus } from "@repo/features/inbox-wire";
import { cardTitle } from "@repo/features/plain-words";
import { FAILURE_SURFACE, type FailureSurface } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActKind } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { type ActResult, type ActVariables, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import type { MenuAction } from "../desktop/action-menu.js";
import type { ShortcutSubject } from "../shortcut-target.js";
import { type HeldUndoRefusal, type HeldWrite, pressHeld } from "../undo-stack.js";
import { messageFailureWords } from "./agent-model.js";

/**
 * inbox-close.tsx -- open Inbox items resolved without an answer, at once and with Undo, from every place that offers it: an item's menus, its question card, the list's head, a chosen row's menu, and E.
 *
 * Resolve is one act wherever it is pressed: it asks nothing, the items
 * read resolved at once in every read the window draws, and one toast
 * offers Undo for its hold (`packages/panel/AGENTS.md`'s Confirms), as ⌘Z does
 * (`undo-stack.ts`'s held entries). Its
 * agent must not hear of a resolve the reader takes back, so each close
 * goes to the host held (`AGENTS_INBOX_CLOSE`'s `held`): the host draws it
 * and keeps it from the service until the toast is gone, when it is let
 * go as sent, or until Undo, when it is let go as taken back and the item
 * stands again as it was (`AGENTS_INBOX_RELEASE`). A window leaving
 * while its toast stands lets its resolves go as sent, so a resolve the
 * reader left standing is never dropped; the host sends any it still holds
 * once it quits, or once a while passes with no word from its window.
 *
 * Each close goes under a key of its own, at the revision the item was
 * pressed on, so an agent's change since is never resolved unseen: the
 * service does not take it, the item lands as the service answered it, and
 * a toast says why. One the service did not answer is taken back.
 */

/** What a close the act channel refused hears, as the service not answering, with the error beneath. */
const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** What a toast says of a close the service did not take, by what had become of the item: still open, the agent having changed it; answered; or resolved. */
const NOT_TAKEN = {
  [INBOX_STATUS.OPEN]: "The agent changed this item before you resolved it.",
  [INBOX_STATUS.ANSWERED]: "This item was already answered.",
  [INBOX_STATUS.CLOSED]: "This item was already resolved.",
} as const satisfies Record<InboxStatus, string>;

/** What a toast says of an Undo that came after its host had sent a resolve on, as one held past the host's bound is. */
const TOO_LATE = "Too late to undo: the agent was already told.";

/** What a toast says of an Undo that did not reach the host, which may still hold the resolve, and what its action that asks again is called. */
const UNDO_UNREACHED = {
  WORDS: "Could not undo resolving. The agent is told in a minute unless you try again.",
  RETRY: "Try again",
} as const;

/** How one held settle answered being let go: still held, and let go now; sent on already; or not reached, so it may still be held. */
const RELEASED = {
  HELD: "held",
  LATE: "late",
  UNREACHED: "unreached",
} as const;

export type Released = (typeof RELEASED)[keyof typeof RELEASED];

/** What the Undo toast says: the one item by its title, or how many. */
function resolvedNote(items: readonly InboxItem[]): string {
  const [only] = items;
  return items.length === 1 && only !== undefined
    ? `Resolved “${cardTitle(only.title)}”`
    : `${countWords(items.length, TERM.INBOX_ITEM)} resolved`;
}

/** What one toast says of a resolve of several items the service refused some of: how many it took, and how many not. */
function closedNote(landed: number, refused: number): string {
  return landed === 0
    ? `Could not resolve ${countWords(refused, TERM.INBOX_ITEM)}`
    : `${countWords(landed, TERM.INBOX_ITEM)} resolved, ${refused} could not be`;
}

/** Why the service did not take one close, in a toast's words, or none where it took it. */
function refusalWords(
  answer: AgentInboxAnsweredView | { readonly failure: AgentCallFailure },
): string | undefined {
  if ("failure" in answer) return messageFailureWords(answer.failure);
  return answer.taken ? undefined : NOT_TAKEN[answer.item.status];
}

/** Resolves the open items given without an answer, at once, with Undo; one already on its way, or no longer open, is passed over. */
export type InboxResolver = (items: readonly InboxItem[]) => void;

/** How an act of `Kind` is sent: the `mutateAsync` of its kind's mutation (`act-mutations.ts`). */
export type Send<Kind extends PortActKind> = (
  variables: ActVariables<Kind>,
) => Promise<ActResult<Kind>>;

/** The mutation a held settle's hold is let go on. */
export type ReleaseDoor = Send<typeof ACT_KIND.AGENTS_INBOX_RELEASE>;

/** The mutations a resolve is sent on: the close, held, and the release that lets its hold go. */
interface ResolveDoors {
  readonly close: Send<typeof ACT_KIND.AGENTS_INBOX_CLOSE>;
  readonly release: ReleaseDoor;
}

/** One press's held settles, a resolve or a nod: the open items it settles, and the key each settle goes under, by the item's place. */
export interface HeldSettles {
  readonly items: readonly InboxItem[];
  readonly keys: readonly string[];
}

/** What one close answered: the item as the service answered it, or why the service was not reached. */
type CloseAnswer = AgentInboxAnsweredView | { readonly failure: AgentCallFailure };

/** How each of `keys`' holds answered being let go, as sent where `send`, else as taken back. */
export function released(
  release: ReleaseDoor,
  keys: readonly string[],
  send: boolean,
): Promise<readonly Released[]> {
  return Promise.all(
    keys.map((clientKey) =>
      release({ clientKey, send }).then(
        (found): Released => (found.held ? RELEASED.HELD : RELEASED.LATE),
        (): Released => RELEASED.UNREACHED,
      ),
    ),
  );
}

/** What a held settle's Undo says where it did not take it back, in its own words: not reached, so it may still be held; or too late, sent on already. */
export interface UnheldWords {
  readonly unreached: string;
  readonly late: string;
}

/**
 * What an Undo of held settles says where it did not take each back: the
 * Undo not reached, which may still be held, asked again for those alone;
 * or one the host had sent on already. None where each was taken back.
 */
export function unheldSettles(
  { items, keys }: HeldSettles,
  answers: readonly Released[],
  words: UnheldWords,
  surface: FailureSurface,
): HeldUndoRefusal<HeldSettles> | undefined {
  const missed = (_: unknown, at: number) => answers[at] === RELEASED.UNREACHED;
  if (answers.some((answer) => answer === RELEASED.UNREACHED)) {
    return {
      words: words.unreached,
      failure: { surface, cause: words.unreached },
      retry: {
        label: UNDO_UNREACHED.RETRY,
        change: { items: items.filter(missed), keys: keys.filter(missed) },
      },
    };
  }
  if (!answers.includes(RELEASED.LATE)) return undefined;
  return { words: words.late, failure: { surface, cause: words.late, refused: true } };
}

/**
 * A resolve as the undo stack holds it (`undo-stack.ts`'s `HeldWrite`): each
 * close sent held, let go as sent once its toast is gone, and taken back by
 * letting it go unsent. Note that an Undo the host did not hear may still be
 * held there, so its toast asks again for those alone; one the host had sent
 * on already says so.
 */
const RESOLVE_WRITE = {
  words: ({ items }) => resolvedNote(items),
  glyph: () => <GLYPH.RESOLVED />,
  // Note that one item's toast quotes its title, which a screen recording masks.
  unmasked: ({ items }) => items.length > 1,
  act: ({ close }, { items, keys }) =>
    Promise.all(
      items.map((item, at) =>
        close({
          itemId: item.id,
          revision: item.revision,
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
      // Note that a close the service never answered may still be held, so only a refusal of every one is whole.
      whole: answers.every((answer) => !("failure" in answer) && !answer.taken),
      words:
        items.length === 1
          ? first.words
          : closedNote(items.length - refused.length, refused.length),
      failure: {
        surface: FAILURE_SURFACE.INBOX_CLOSE,
        cause: first.answer,
        about: { inboxItemId: first.item.id, agentId: first.item.agentId },
      },
    };
  },
  unheld: (resolving, answers) =>
    unheldSettles(
      resolving,
      answers,
      { unreached: UNDO_UNREACHED.WORDS, late: TOO_LATE },
      FAILURE_SURFACE.INBOX_CLOSE,
    ),
} satisfies HeldWrite<ResolveDoors, HeldSettles, readonly CloseAnswer[], readonly Released[]>;

/** The Inbox's resolves, each held by the host until its Undo toast is gone. */
export function useInboxResolver(): InboxResolver {
  const { mutateAsync: close } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_CLOSE));
  const { mutateAsync: release } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_RELEASE));
  const out = useRef(new Set<string>());
  return useCallback(
    (items: readonly InboxItem[]) => {
      const open = items.filter(
        (item) => item.status === INBOX_STATUS.OPEN && !out.current.has(item.id),
      );
      if (open.length === 0) return;
      for (const item of open) out.current.add(item.id);
      const resolving = { items: open, keys: open.map(() => crypto.randomUUID()) };
      void pressHeld(RESOLVE_WRITE, { close, release }, resolving).then(() => {
        for (const item of open) out.current.delete(item.id);
      });
    },
    [close, release],
  );
}

/**
 * The items' resolve as a menu offers it: while one of them is open and the
 * surface hands a resolver, which one that answers nothing, an archived
 * task's say, hands none of. It names E where E resolves `subject`, the
 * chosen item; none where no key reaches what it resolves.
 */
export function resolveAction(
  items: readonly InboxItem[],
  onResolve: InboxResolver | undefined,
  subject?: ShortcutSubject | undefined,
): MenuAction | undefined {
  return onResolve === undefined || !items.some((item) => item.status === INBOX_STATUS.OPEN)
    ? undefined
    : {
        label: RESOLVE,
        icon: <GLYPH.RESOLVED />,
        onSelect: () => onResolve(items),
        ...(subject === undefined ? undefined : { command: APP_COMMAND.RESOLVE, subject }),
      };
}
