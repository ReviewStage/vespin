/**
 * search-go-to-model.ts -- the places the iOS app's Search tab goes to beside what it finds, as ⌘K goes somewhere by name: each place's words, under Go to before anything is typed and as a "Go to …" command once something is, the few a query narrows them to, and the row that starts a task on what was typed.
 *
 * The places are those a phone reaches only through a bar's button or
 * Settings today, so the finder offers them by name; the phone holds which
 * of them the account reaches, such as the Merge queue while its experiment
 * is on, and hands that set in.
 */

import { MERGE_QUEUE_PAGE_WORDS } from "./merge-queue-model.js";

/** A place Search goes to by name. */
export const GO_TO = {
  MERGE_QUEUE: "merge_queue",
  AUTOMATIONS: "automations",
  SETTINGS: "settings",
} as const;

export type GoTo = (typeof GO_TO)[keyof typeof GO_TO];

/** Each place's name, as its own page heads it. */
export const GO_TO_TITLE = {
  [GO_TO.MERGE_QUEUE]: MERGE_QUEUE_PAGE_WORDS.TITLE,
  [GO_TO.AUTOMATIONS]: "Automations",
  [GO_TO.SETTINGS]: "Settings",
} as const satisfies Record<GoTo, string>;

/** The finder's own words: the places' heading before anything is typed, and the heading they stand under once something is, as ⌘K lists them among its Commands; the row that starts a task, and the Managers' heading. */
export const GO_TO_WORDS = {
  TITLE: "Go to",
  COMMANDS: "Commands",
  START: "Start a task",
  /** The workspace's Managers, listed before anything is typed, as the panel's sidebar lists them. */
  MANAGERS: "Managers",
} as const;

/** What a place's row says among the Commands once something is typed, as ⌘K says a place it goes to: "Go to" and the place, as it stands mid-sentence ("Go to settings"). */
export function goToCommandLabel(place: GoTo): string {
  return `${GO_TO_WORDS.TITLE} ${GO_TO_TITLE[place].toLowerCase()}`;
}

/** The places `reached` holds that `typed` names, in their order: every one before anything is typed, else those whose command ("Go to settings") holds what was typed, whatever its case, as ⌘K finds a place by its command's words. */
export function goToShown(reached: readonly GoTo[], typed: string): readonly GoTo[] {
  const words = typed.trim().toLowerCase();

  if (words === "") return reached;

  return reached.filter((place) => goToCommandLabel(place).toLowerCase().includes(words));
}

/** The row that starts a task on what was typed, which New task opens with; none while nothing is typed. */
export function startTaskLabel(typed: string): string | undefined {
  const words = typed.trim();

  return words === "" ? undefined : `${GO_TO_WORDS.START}: “${words}”`;
}
