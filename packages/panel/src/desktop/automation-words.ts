/**
 * automation-words.ts -- an automation's owner and next run in the few words every place naming it says them, the Automations list's row and an automation's card, what the list says while it is read, and what deleting one asks.
 */

import { AUTOMATION_NEXT, automationNext } from "@repo/features/automation-list-model";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { momentText, scheduledText } from "@repo/features/time-format";
import { CONFIRM_LOSS, type DialogQuestion } from "@repo/ui";

/** What the Automations list says to a reader while it is first read, on its page and in the frame standing while the page's code loads. */
export const READING_AUTOMATIONS = "Reading your automations…";

/** What deleting an automation asks, from its editor's ⋯ and its row's menu alike: what goes, and what stays. */
export function automationDeleteQuestion(name: string | undefined): DialogQuestion {
  return {
    title: `Delete ${name ?? "this automation"}?`,
    body: "Its schedule stops and its run history goes. Agents its runs started stay.",
    verb: "Delete automation",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    titleReplayMasked: name !== undefined,
  };
}

/** What a next run is said after, so its day and time read as the one run to come, not the schedule. */
const NEXT_LABEL = "Next: ";

/** A run due at `at`, in a few words, its day and time always said: "Next: Today 3:00 PM", "Next: Mon 1:00 PM". */
function dueText(at: number, now: number): string {
  return `${NEXT_LABEL}${scheduledText(at, now)}`;
}

/** When an automation runs next, in a few words; none for one an event fires, whose trigger already says when. */
export function automationNextText(automation: AutomationSummary, now: number): string | undefined {
  const next = automationNext(automation);

  switch (next.kind) {
    case AUTOMATION_NEXT.OFF:
      return "Off";
    case AUTOMATION_NEXT.RAN:
      return "Ran once";
    case AUTOMATION_NEXT.EVENT:
      return undefined;
    case AUTOMATION_NEXT.UNSCHEDULED:
      return "Not scheduled";
    case AUTOMATION_NEXT.AT:
      return dueText(next.at, now);
  }
}

/** An owner as a place names it: the workspace by its name, a personal one the reader made as Only you, and one a teammate made, an admin's to see, as Personal. */
export function automationOwnerName(
  owner: AutomationScope,
  workspaceName: string | undefined,
  mine: boolean,
): string {
  if (owner === AUTOMATION_SCOPE.WORKSPACE) return workspaceName ?? "Workspace";

  return mine ? "Only you" : "Personal";
}

/**
 * Whom an automation is for, said after a comma in a line that names
 * something else first, what fires it or who made it, where a dot would
 * otherwise set the owner apart: "for Acme", "just for you", "just for its
 * creator".
 */
export function automationOwnerFor(
  owner: AutomationScope,
  workspaceName: string | undefined,
  mine: boolean,
): string {
  if (owner === AUTOMATION_SCOPE.WORKSPACE) return `for ${workspaceName ?? "the workspace"}`;

  return mine ? "just for you" : "just for its creator";
}

/**
 * An automation's line under its name in a row with no room for the owner's
 * and the next run's columns, a phone's: when it runs next, where it is set
 * to, before what fires it, so the line's end is cut rather than the time.
 * A run due in another year names its year, since the row has no hint to
 * say it whole as the wide row's column does. One turned off or waiting on an
 * event says what fires it alone, its switch saying the rest.
 */
export function automationNarrowLine(
  automation: AutomationSummary,
  trigger: string,
  now: number,
): string {
  const next = automationNext(automation);

  if (next.kind !== AUTOMATION_NEXT.AT) return trigger;
  const sameYear = new Date(next.at).getFullYear() === new Date(now).getFullYear();
  const when = sameYear ? dueText(next.at, now) : `${NEXT_LABEL}${momentText(next.at)}`;

  return `${when} (${trigger})`;
}
