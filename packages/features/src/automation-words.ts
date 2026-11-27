/**
 * automation-words.ts -- an automation's owner and next run in the few words every place naming it says them, a list's row and an automation's card on the desktop and the phone alike, what the list says while it is read, why a Run now or a switch did not land, and the phone's Automations pages' words.
 */

import {
  AUTOMATION_NEXT,
  automationNext,
  automationRanLine,
  automationRunLine,
  automationTriggerText,
} from "./automation-list-model.js";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationView,
} from "./automation-view.js";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "./automation-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import { momentText, scheduledText } from "./time-format.js";

/** What the Automations list says to a reader while it is first read, on its page and in the frame standing while the page's code loads. */
export const READING_AUTOMATIONS = "Reading your automations…";

/** Why a save did not land, as the editor says it, and the words a Run now's and a switch's refusals start from. */
export const AUTOMATION_SAVE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The automation could not be saved. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "Choose the repository whose events start it.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: `${PRODUCT_NAME} cannot reach that repository from this workspace on GitHub.`,
  [AUTOMATION_CALL_FAILURE.INVALID]:
    "The automation could not be saved as written. Check its schedule and prompt.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can change it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** Why a Run now did not start a run, as the line under the name says it. */
export const AUTOMATION_RUN_REFUSAL_WORDS = {
  ...AUTOMATION_SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Could not run it now. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can run it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** Why a Delete did not land, as its question goes on saying until it is tried again or let go. */
export const AUTOMATION_DELETE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.INVALID]: "The automation could not be deleted. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can delete it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** What deleting an automation asks, from its page and its row alike: what goes, and what stays. */
export const AUTOMATION_DELETE_WORDS = {
  BODY: "Its schedule stops and its run history goes. Agents its runs started stay.",
  VERB: "Delete automation",
  RUNNING: "Deleting",
} as const;

/** The question's title, naming the automation where it is known. */
export function automationDeleteTitle(name: string | undefined): string {
  return `Delete ${name ?? "this automation"}?`;
}

/** The automations the list suggests under its own, and what a Sentry one says while the workspace has no Sentry: the press that connects it, for an owner or an admin, or whom a member asks. */
export const AUTOMATION_SUGGESTION_WORDS = {
  SUGGESTED: "Suggested",
  CONNECT_SENTRY: "Connect Sentry",
  ASK_SENTRY: "Ask an owner or admin to connect Sentry",
} as const;

/** Take over, which an owner or an admin offers on an automation whose creator left the workspace: the act, and what a refusal says. */
export const AUTOMATION_TAKE_OVER_WORDS = {
  ACT: "Take over",
  REFUSED: "Couldn't take over this automation.",
} as const;

/** Why a switch did not move, as its notice says it; none where it moved. */
export function automationToggleRefusal(
  answer: AutomationView | { readonly failure: AutomationCallFailure },
  enabled: boolean,
): string | undefined {
  if (!("failure" in answer)) return undefined;

  if (answer.failure === AUTOMATION_CALL_FAILURE.NOT_PERMITTED) {
    return AUTOMATION_SAVE_REFUSAL_WORDS[AUTOMATION_CALL_FAILURE.NOT_PERMITTED];
  }

  return enabled ? "Could not turn it on. Try again." : "Could not turn it off. Try again.";
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

/** What the phone's Automations pages say, in the panel's words where it has them. */
export const AUTOMATION_PHONE_WORDS = {
  TITLE: "Automations",
  FAILED: "The automations could not be read.",
  EMPTY: "No automations yet.",
  /** Why the phone offers no New automation and no editor. */
  MADE_ELSEWHERE: `Automations are made and changed in ${PRODUCT_NAME} on the desktop or the web.`,
  GONE: AUTOMATION_SAVE_REFUSAL_WORDS[AUTOMATION_CALL_FAILURE.NOT_FOUND],
  RUN_NOW: "Run now",
  TURN_ON: "Turn on",
  TURN_OFF: "Turn off",
  /** Its switch's row on its page. */
  ON: "On",
  TRIGGER: "Trigger",
  PROMPT: "Prompt",
  RUNS: "Recent runs",
  NO_RUNS: "No runs yet.",
  RUNS_FAILED: "The runs could not be read.",
  READING_RUNS: "Reading the runs…",
  NEVER_RAN: "Hasn't run yet",
  NO_REPOSITORY: "Works in no repository",
  /** Its page's ⋯ and its acts, the panel's own words. */
  MORE: "More",
  EDIT: "Edit",
  COPY_LINK: "Copy link",
  DELETE: "Delete",
  /** A schedule's next runs, said under what fires it. */
  NEXT_RUNS: "Next runs",
  /** The address a webhook trigger is called at, and its row's act. */
  WEBHOOK_URL: "Webhook URL",
  COPY_URL: "Copy URL",
  /** Where its runs work and land, its page's group under the prompt, as the editor names the group and its rows. */
  WHERE_IT_RUNS: "Where it runs",
  REPOSITORY: "Repository",
  NO_REPOSITORY_VALUE: "None",
  RUNS_LAND_IN: "Runs land in",
  NEW_AGENT: "New agent each run",
  SAME_AGENT: "Same agent",
  FIRST_RUN_AGENT: "Started by its first run",
  MODEL: "Model",
  DEFAULT_MODEL: "Your default",
  ARCHIVE_SUCCESSFUL: "Mark finished runs Done",
  SLACK_DELIVERY: "Send the result on Slack",
  YES: "On",
  NO: "Off",
  /** Who it is for and who made it, its page's last group. */
  SHARING: "Sharing",
  OWNER: "Owner",
  CREATED_BY: "Created by",
  FORMER_MEMBER: "Former member",
  /** The press under its newest runs that opens every run it made. */
  ALL_RUNS: "All runs",
} as const;

/** What a phone's row says of an automation turned off before what fires it, since the row stands no switch. */
const OFF_WORD = "Off";

/**
 * An automation's line under its name on a phone, whose row stands no
 * switch: when it runs next and what fires it, or, turned off, that it is
 * off before what fires it; and a one-time automation that ran, under
 * Finished, what its run started (`automationRanLine`), since nothing will
 * fire it again.
 */
export function automationPhoneLine(automation: AutomationSummary, now: number): string {
  const trigger = automationTriggerText(automation.trigger, automation.repositories ?? []);
  const ran = automationNext(automation).kind === AUTOMATION_NEXT.RAN ? automation.lastRun : null;

  if (ran !== null) return automationRanLine(ran);

  return automation.enabled
    ? automationNarrowLine(automation, trigger, now)
    : `${OFF_WORD} · ${trigger}`;
}

/** What the list's last group is called, the one-time automations that ran, folded as their history. */
export const AUTOMATION_FINISHED = "Finished";

/** How an automation's newest run went, in a few words: "Last run: Finished", or that it has not run. */
export function automationLastRunWords(automation: AutomationSummary): string {
  const run = automation.lastRun;

  return run === null ? AUTOMATION_PHONE_WORDS.NEVER_RAN : `Last run: ${automationRunLine(run)}`;
}

/** Where an automation's runs work, as its page says under its prompt: its task, else its repositories, else none. */
export function automationWhereWords(automation: AutomationSummary): string {
  if (automation.taskName !== null) return `On ${automation.taskName}`;
  const repositories = automation.repositories ?? [];

  return repositories.length === 0
    ? AUTOMATION_PHONE_WORDS.NO_REPOSITORY
    : `In ${repositories.join(", ")}`;
}
