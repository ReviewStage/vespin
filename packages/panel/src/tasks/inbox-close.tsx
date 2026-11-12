import { messageFailureWords } from "@repo/features/agent-refusal-words";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
} from "@repo/features/agent-view";
import { RESOLVE } from "@repo/features/inbox-ask-words";
import { RETRY } from "@repo/features/inbox-list-model";
import {
  INBOX_STATUS,
  INBOX_TAKE_BACK,
  type InboxItem,
  type InboxStatus,
} from "@repo/features/inbox-wire";
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
import { pressTakeBack, type TakeBackUndoRefusal, type TakeBackWrite } from "../undo-stack.js";

/**
 * inbox-close.tsx -- open Inbox items resolved without an answer, at once and with Undo, from every place that offers it: an item's menus, its question card, the list's head, a chosen row's menu, and E.
 *
 * Resolve is one act wherever it is pressed: it asks nothing, the items
 * read resolved at once in every read the window draws, and one toast
 * offers Undo (`packages/panel/AGENTS.md`'s Confirms), as ⌘Z does for as
 * long as it keeps the entry, its toast gone or not (`undo-stack.ts`'s
 * take-back entries). Each close goes to the service at once, and its Undo
 * takes it back there by its key (`AGENTS_INBOX_TAKE_BACK`): the item open
 * again, its question asking again. One whose agent was told, an agent waiting to hear
 * back, cannot be taken back, and its Undo says so, as it does of an item
 * changed since.
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

/** What a toast says of a resolve's Undo the service did not take, by why. */
const RESOLVE_UNTAKEN = {
  unreached: "Could not undo resolving.",
  told: "Can't undo: the agent was already told.",
  movedOn: "Can't undo: it changed since you resolved it.",
} as const;

/** How one take-back answered: taken back, refused as told to its agent or as moved on, or not reached, so it may be asked again. */
const TOOK_BACK = {
  ...INBOX_TAKE_BACK,
  UNREACHED: "unreached",
} as const;

export type TookBack = (typeof TOOK_BACK)[keyof typeof TOOK_BACK];

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

/** The mutation a settle is taken back on. */
export type TakeBackDoor = Send<typeof ACT_KIND.AGENTS_INBOX_TAKE_BACK>;

/** The mutations a resolve is sent on: the close, and the take-back its Undo asks. */
interface ResolveDoors {
  readonly close: Send<typeof ACT_KIND.AGENTS_INBOX_CLOSE>;
  readonly takeBack: TakeBackDoor;
}

/** One press's settles, a resolve or a nod: the open items it settles, and the key each settle goes under, by the item's place. */
export interface Settles {
  readonly items: readonly InboxItem[];
  readonly keys: readonly string[];
}

/** What one close answered: the item as the service answered it, or why the service was not reached. */
type CloseAnswer = AgentInboxAnsweredView | { readonly failure: AgentCallFailure };

/** How each settle answered being taken back, by its item's place. */
export function tookBack(
  takeBack: TakeBackDoor,
  { items, keys }: Settles,
): Promise<readonly TookBack[]> {
  return Promise.all(
    items.map((item, at) =>
      takeBack({ itemId: item.id, clientKey: keys[at] ?? "" }).then(
        (answer): TookBack => ("failure" in answer ? TOOK_BACK.UNREACHED : answer.outcome),
        (): TookBack => TOOK_BACK.UNREACHED,
      ),
    ),
  );
}

/** What a settle's Undo says where the service did not take it back, in its own words: not reached, told to its agent, or moved on. */
export interface UntakenWords {
  readonly unreached: string;
  readonly told: string;
  readonly movedOn: string;
}

/**
 * What an Undo of settles says where it did not take each back: the Undo
 * not reached, asked again for those alone; one whose agent was told; or one
 * changed since. None where each was taken back.
 */
export function untakenSettles(
  { items, keys }: Settles,
  answers: readonly TookBack[],
  words: UntakenWords,
  surface: FailureSurface,
): TakeBackUndoRefusal<Settles> | undefined {
  const missed = <Item,>(_: Item, at: number) => answers[at] === TOOK_BACK.UNREACHED;

  if (answers.some((answer) => answer === TOOK_BACK.UNREACHED)) {
    return {
      words: words.unreached,
      failure: { surface, cause: words.unreached },
      retry: {
        label: RETRY,
        change: { items: items.filter(missed), keys: keys.filter(missed) },
      },
    };
  }

  const said = answers.includes(TOOK_BACK.TOLD)
    ? words.told
    : answers.includes(TOOK_BACK.MOVED_ON)
      ? words.movedOn
      : undefined;

  return said === undefined
    ? undefined
    : { words: said, failure: { surface, cause: said, refused: true } };
}

/**
 * A resolve as the undo stack holds it (`undo-stack.ts`'s `TakeBackWrite`):
 * each close sent at once, and taken back by its key whenever its Undo asks.
 * Note that a take-back that did not reach the service is asked again for
 * those alone.
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
      // Note that a close the service never answered may have landed, so only a refusal of every one is whole.
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
    untakenSettles(resolving, answers, RESOLVE_UNTAKEN, FAILURE_SURFACE.INBOX_CLOSE),
} satisfies TakeBackWrite<ResolveDoors, Settles, readonly CloseAnswer[], readonly TookBack[]>;

/** The Inbox's resolves, each taken back by the service whenever its Undo asks. */
export function useInboxResolver(): InboxResolver {
  const { mutateAsync: close } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_CLOSE));
  const { mutateAsync: takeBack } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_TAKE_BACK));
  const out = useRef(new Set<string>());

  return useCallback(
    (items: readonly InboxItem[]) => {
      const open = items.filter(
        (item) => item.status === INBOX_STATUS.OPEN && !out.current.has(item.id),
      );

      if (open.length === 0) return;

      for (const item of open) out.current.add(item.id);
      const resolving = { items: open, keys: open.map(() => crypto.randomUUID()) };
      void pressTakeBack(RESOLVE_WRITE, { close, takeBack }, resolving).then(() => {
        for (const item of open) out.current.delete(item.id);
      });
    },
    [close, takeBack],
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
