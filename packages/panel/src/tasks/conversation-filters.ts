/**
 * conversation-filters.ts -- the Pull request tab's Conversation filters, Hide bots and Hide resolved: what each leaves out, how many it would, and the choice kept across launches, with which of the view's two sections stand folded.
 *
 * They are stage-cli's: Hide bots leaves out every comment and review an
 * App's bot wrote, a review's threads with it; Hide resolved leaves out
 * every resolved review thread, and a review whose every thread was
 * resolved goes with them, whatever else it says, as stage-cli drops one.
 * A comment is never resolved, so Hide resolved leaves every comment
 * standing. Each counts what it would leave out on its own, whether the
 * other is on or not: Hide bots the comments and reviews, Hide resolved
 * the threads.
 *
 * The choice is the member's, one of the account's view choices
 * (`VIEW_CHOICE_KEY.CONVERSATION_FILTERS`, `../view-choices.ts`), so it
 * follows them to every device. One choice holds for every pull request,
 * both off until changed, and a change in one tab is drawn at once in every
 * other. What an earlier build kept in this window's storage moves up to
 * the account once, each part read on its own, so one that no longer reads
 * leaves the other as it was kept.
 *
 * Whether the Description and the Conversation stand open is kept beside
 * them on the same terms: one choice for each section, never one for each
 * pull request, both open until folded, as the sidebar keeps a group's
 * fold for every task in it.
 */

import type { ConversationEntry, ReviewThread } from "@repo/features/agent-wire";
import { VIEW_CHOICE_KEY, type ViewChoiceValue } from "@repo/features/view-choice-wire";
import { Effect, Option, Schema } from "effect";
import { useCallback, useRef } from "react";
import { selectFixtureStaged, useAppStateSlice } from "../use-app-state.js";
import { keptKey, useKeptLeaving } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";

/** A kept filter read on its own: as kept where it reads, its default where it is missing or does not. */
function keptOr<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  fallback: S["Type"] & S["Encoded"],
) {
  return schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(fallback))),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );
}

/** Both filters off and both sections open, as the conversation draws until told otherwise. */
const DEFAULT_CHOICES = {
  hideBots: false,
  hideResolved: false,
  descriptionOpen: true,
  conversationOpen: true,
} as const;

/** The choices as an earlier build kept them in this window's storage, each part read on its own. */
const keptChoicesSchema = Schema.Struct({
  hideBots: keptOr(Schema.Boolean, DEFAULT_CHOICES.hideBots),
  hideResolved: keptOr(Schema.Boolean, DEFAULT_CHOICES.hideResolved),
  descriptionOpen: keptOr(Schema.Boolean, DEFAULT_CHOICES.descriptionOpen),
  conversationOpen: keptOr(Schema.Boolean, DEFAULT_CHOICES.conversationOpen),
});

/** The Conversation view's kept choices: its two filters, and whether each of its sections stands open. */
type ConversationChoices = ViewChoiceValue<typeof VIEW_CHOICE_KEY.CONVERSATION_FILTERS>;

/** What the filters leave out of a conversation. */
export type ConversationFilters = Pick<ConversationChoices, "hideBots" | "hideResolved">;

/** Where an earlier build kept the choice in this window's storage, one for every pull request, moved up to the account once. */
const KEPT_CHOICES = keptKey("app.conversation-filters", Schema.fromJsonString(keptChoicesSchema));

/** How many entries each filter would leave out of a conversation, each counted on its own. */
export interface ConversationHidden {
  /** The comments and reviews an App's bot wrote. */
  readonly bots: number;
  /** The resolved review threads, a bot's among them. */
  readonly resolved: number;
}

/** The threads a review started, none on a comment. */
function threadsOf(entry: ConversationEntry): readonly ReviewThread[] {
  return entry.threads ?? [];
}

/** How many entries each filter would leave out of the conversation given. */
export function conversationHidden(conversation: readonly ConversationEntry[]): ConversationHidden {
  let bots = 0;
  let resolved = 0;

  for (const entry of conversation) {
    if (entry.by.bot) bots += 1;
    resolved += threadsOf(entry).filter((thread) => thread.resolved).length;
  }

  return { bots, resolved };
}

/** Nothing brought into view, which the filters leave as they find it. */
const NONE_KEPT: ReadonlySet<string> = new Set();

/**
 * The conversation as the filters leave it: an entry left out whole, or a
 * review standing with only its threads still open. What a link or a View
 * in Conversation brought into view (`kept`: a thread by its id, an entry by
 * its page) stands whatever the filters say, a thread with the review it is
 * on.
 */
export function filteredConversation(
  conversation: readonly ConversationEntry[],
  filters: ConversationFilters,
  kept: ReadonlySet<string> = NONE_KEPT,
): readonly ConversationEntry[] {
  const keeps = (thread: ReviewThread) => thread.id !== undefined && kept.has(thread.id);

  return conversation.flatMap((entry): ConversationEntry[] => {
    const threads = threadsOf(entry);
    const keptEntry = kept.has(entry.url);

    if (filters.hideBots && entry.by.bot && !keptEntry && !threads.some(keeps)) return [];

    if (!filters.hideResolved || threads.length === 0) return [entry];
    const open = threads.filter((thread) => !thread.resolved || keeps(thread));

    // Note that a review whose every thread was resolved goes with them, as stage-cli drops one, unless it was brought into view.
    if (open.length === 0) return keptEntry ? [entry] : [];

    return open.length === threads.length ? [entry] : [{ ...entry, threads: open }];
  });
}

/** The Conversation's filters and sections' folds, and the door that changes them for every conversation. */
export interface ConversationFiltersControl {
  readonly filters: ConversationChoices;
  readonly change: (change: Partial<ConversationChoices>) => void;
}

export function useConversationFilters(): ConversationFiltersControl {
  const choice = useAccountChoice(
    VIEW_CHOICE_KEY.CONVERSATION_FILTERS,
    null,
    DEFAULT_CHOICES,
    useAppStateSlice(selectFixtureStaged) === true,
    useKeptLeaving(KEPT_CHOICES),
  );

  // Note that a change is made over the choice held now, so every conversation's tab draws it at once, and a filter changed in one never undoes a section folded in another; and that it is one door across draws, read through a ref, so an effect that hands it on runs only as what it reads moves.
  const changeNow = useRef(choice.change);
  changeNow.current = choice.change;

  const change = useCallback(
    (changed: Partial<ConversationChoices>) =>
      changeNow.current((held) => ({ ...held, ...changed })),
    [],
  );

  return { filters: choice.value, change };
}
