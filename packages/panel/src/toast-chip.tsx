/**
 * toast-chip.tsx -- the pill a toast names the one thing it is about with: the thing's own glyph and name, as a mention of it reads.
 *
 * A toast that is about one task, agent, Inbox item, or pull request names
 * it as a pill in the line of its words (`@repo/ui`'s `Toast` `chip`), as a
 * mention names it in running words, rather than quoting its name: a title
 * wraps with the words, and a pull request's key is kept whole, as a
 * mention's is. One about many says how many in its words, and names none.
 */

import { ENTITY_KIND, ENTITY_WORD, type EntityKind } from "@repo/features/entity-kind";
import type { InboxItem } from "@repo/features/inbox-wire";
import { cardTitle } from "@repo/features/plain-words";
import { INLINE_REF_NAME, type ToastChip } from "@repo/ui";
import { EntityGlyph } from "./entities/entity-glyph.js";

/** The pill naming the one thing of `kind` called `name` that a toast is about, led by its kind's glyph. */
export function toastChip(kind: EntityKind, name: string): ToastChip {
  return { glyph: <EntityGlyph kind={kind} />, label: name, kind: ENTITY_WORD[kind] };
}

/** The pill naming the one Inbox item a toast is about, by the title its card reads; none where it is about several. */
export function inboxItemChip(items: readonly Pick<InboxItem, "title">[]): ToastChip | undefined {
  const [only, ...more] = items;

  return only === undefined || more.length > 0
    ? undefined
    : toastChip(ENTITY_KIND.INBOX_ITEM, cardTitle(only.title));
}

/** The pill naming the one pull request a toast is about, by its key, kept whole as a mention of it is. */
export function pullRequestChip(pullRequestNumber: number): ToastChip {
  return {
    ...toastChip(ENTITY_KIND.PULL_REQUEST, `#${pullRequestNumber}`),
    name: INLINE_REF_NAME.WHOLE,
  };
}
