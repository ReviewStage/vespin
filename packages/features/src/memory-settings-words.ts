/**
 * memory-settings-words.ts -- what Settings › Memory says, and how it orders the workspace's memories, on the desktop, the web, and the iOS app alike.
 */

import { DAY_MS } from "@repo/runtime/vocabulary";
import { MEMORY_SAVE_FAILURE, type MemorySaveAnswerView } from "./agent-view.js";
import { MEMORY_BOUNDS, MEMORY_RECALL_WINDOW_DAYS, type MemorySummary } from "./memory-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import { countWords, readFailedWords, readingWords, TERM } from "./words.js";

/** What the page says while it cannot read or write, and with nothing to show. */
export const MEMORY_PAGE_WORDS = {
  TITLE: "Memories",
  READING: readingWords(`${PRODUCT_NAME}'s memory`),
  FAILED: readFailedWords(`${PRODUCT_NAME}'s memory`),
  EMPTY: `${PRODUCT_NAME} hasn't remembered anything yet.`,
  FORGET_FAILED: "The memory could not be deleted. Try again.",
  NO_MATCH: "No memories match",
  SEARCH: "Search memories",
} as const;

/** What a memory's acts say, in its menu and the selection's bar. */
export const MEMORY_ACT = {
  EDIT: "Edit",
  FORGET: "Delete",
  COPY: "Copy text",
} as const;

/** What the button that keeps a new memory says. */
export const ADD_MEMORY = "Add memory";

/** What the card or page a memory's words are written in says: its head as it edits or adds, its hint, and its send. */
export const MEMORY_EDITOR_WORDS = {
  EDIT: "Edit memory",
  ADD: "New memory",
  PLACEHOLDER: "A fact your agents should remember",
  SAVE: "Save",
  GONE: "This memory no longer exists.",
  TOO_LONG: `A memory holds at most ${MEMORY_BOUNDS.MAX_CHARS.toLocaleString("en-US")} characters.`,
} as const;

/** What a save that came to no answer says. */
export const MEMORY_SAVE_FAILED = "The memory could not be saved. Try again.";

/** What a save the service refused says, by why. */
const MEMORY_SAVE_REFUSAL = {
  [MEMORY_SAVE_FAILURE.MEMORY_OFF]: "Turn on Memory in Settings › Experimental to save a memory.",
  [MEMORY_SAVE_FAILURE.NOT_FOUND]: MEMORY_EDITOR_WORDS.GONE,
  [MEMORY_SAVE_FAILURE.MEMORY_CREDENTIAL]:
    "That looks like it holds a credential, which a memory never keeps.",
  [MEMORY_SAVE_FAILURE.MEMORY_FULL]: `This workspace holds ${MEMORY_BOUNDS.MAX_MEMORIES.toLocaleString("en-US")} memories, the most it can. Delete one first.`,
  [MEMORY_SAVE_FAILURE.UNANSWERED]: MEMORY_SAVE_FAILED,
  // Note that a save is always a POST, so the method refused is never the window's; it reads as no answer.
  [MEMORY_SAVE_FAILURE.METHOD_NOT_ALLOWED]: MEMORY_SAVE_FAILED,
} as const satisfies Record<(typeof MEMORY_SAVE_FAILURE)[keyof typeof MEMORY_SAVE_FAILURE], string>;

/** What a save's answer says of why it kept nothing; none for a save that went. */
export function memorySaveRefusal(answer: MemorySaveAnswerView): string | undefined {
  return "failure" in answer ? MEMORY_SAVE_REFUSAL[answer.failure] : undefined;
}

/** What a memory's row says of its recalls where agents were handed it in none of the window: when last, or never. */
export const MEMORY_UNRECALLED_WORDS = {
  LAST: "Last recalled",
  NEVER: "Never recalled",
} as const;

/** What a caption says Recalls counts. */
export const MEMORY_RECALLS_WORDS = `Recalls count the last ${MEMORY_RECALL_WINDOW_DAYS} days`;

/** How often agents were handed a memory in the recall window, as a line says it: "3 recalls". */
export function recallsText(recalls: number): string {
  return `${recalls.toLocaleString("en-US")} ${recalls === 1 ? "recall" : "recalls"}`;
}

/** The memories as the page orders them: most recalled in the recall window first, then most recently kept or corrected, as the service lists them. */
export function memoriesByUse(memories: readonly MemorySummary[]): readonly MemorySummary[] {
  return [...memories].sort(
    (one, other) => other.recalls30d - one.recalls30d || other.updatedAt - one.updatedAt,
  );
}

/**
 * The views the page lists the memories in, each for a job: every memory,
 * the ones agents kept lately, for a member to read over while a wrong one
 * is still young, and the ones no agent reaches, to prune.
 */
export const MEMORY_VIEW = {
  ALL: "all",
  NEW: "new",
  UNUSED: "unused",
} as const;

export type MemoryView = (typeof MEMORY_VIEW)[keyof typeof MEMORY_VIEW];

/** The views in the order the page offers them. */
export const MEMORY_VIEWS: readonly MemoryView[] = [
  MEMORY_VIEW.ALL,
  MEMORY_VIEW.NEW,
  MEMORY_VIEW.UNUSED,
];

/** What each view is called. */
export const MEMORY_VIEW_WORDS = {
  [MEMORY_VIEW.ALL]: "All",
  [MEMORY_VIEW.NEW]: "New",
  [MEMORY_VIEW.UNUSED]: "Unused",
} as const satisfies Record<MemoryView, string>;

/** How many days a memory counts as new after it was kept. */
export const MEMORY_NEW_DAYS = 7;

/**
 * Whether `memory` stands in `view` at `now`. New is kept in the last
 * `MEMORY_NEW_DAYS` days; Unused is recalled by no agent in the recall
 * window, though kept before it opened, so a memory too young to have been
 * reached is never offered to prune.
 */
function inView(memory: MemorySummary, view: MemoryView, now: number): boolean {
  if (view === MEMORY_VIEW.NEW) return memory.createdAt > now - MEMORY_NEW_DAYS * DAY_MS;

  if (view === MEMORY_VIEW.UNUSED) {
    return memory.recalls30d === 0 && memory.createdAt <= now - MEMORY_RECALL_WINDOW_DAYS * DAY_MS;
  }

  return true;
}

/** When a memory was last of use: last recalled, or kept where no agent ever recalled it. */
function lastUsed(memory: MemorySummary): number {
  return memory.lastRecalledAt ?? memory.createdAt;
}

/**
 * The memories `view` lists at `now`, in its order: All the most recalled
 * first (`memoriesByUse`), New the most recently kept first, and Unused the
 * longest out of use first, so what to prune leads.
 */
export function memoriesInView(
  memories: readonly MemorySummary[],
  view: MemoryView,
  now: number,
): readonly MemorySummary[] {
  if (view === MEMORY_VIEW.ALL) return memoriesByUse(memories);
  const listed = memories.filter((memory) => inView(memory, view, now));

  return view === MEMORY_VIEW.NEW
    ? listed.sort((one, other) => other.createdAt - one.createdAt)
    : listed.sort((one, other) => lastUsed(one) - lastUsed(other));
}

/** What the Unused view says over its memories, and its press that chooses them all. */
export function unusedWords(count: number) {
  return {
    line: `No agent recalled ${count === 1 ? "this memory" : `these ${countWords(count, TERM.MEMORY)}`} in the last ${MEMORY_RECALL_WINDOW_DAYS} days.`,
    choose: count === 1 ? "Select it" : `Select all ${count.toLocaleString("en-US")}`,
  } as const;
}

/** What a view with nothing in it says. */
export const MEMORY_VIEW_EMPTY = {
  [MEMORY_VIEW.ALL]: MEMORY_PAGE_WORDS.EMPTY,
  [MEMORY_VIEW.NEW]: `No memories kept in the last ${MEMORY_NEW_DAYS} days.`,
  [MEMORY_VIEW.UNUSED]: `Every memory was recalled in the last ${MEMORY_RECALL_WINDOW_DAYS} days.`,
} as const satisfies Record<MemoryView, string>;

/** What Delete asks, of `count` memories, and what it says of the `left` the reader may not delete. */
export function forgetQuestion(count: number, left: number) {
  const one = count === 1;
  const them = one ? "it" : "them";
  const body = `No agent will recall ${them} in any later task in this workspace, for anyone.`;

  const kept =
    left === 0
      ? ""
      : ` ${countWords(left, TERM.MEMORY)} you may not delete ${left === 1 ? "stays" : "stay"}.`;

  return {
    title: one ? "Delete this memory?" : `Delete ${countWords(count, TERM.MEMORY)}?`,
    body: `${body}${kept}`,
    verb: `${MEMORY_ACT.FORGET} ${one ? TERM.MEMORY.one : TERM.MEMORY.many}`,
    running: "Deleting",
  } as const;
}
