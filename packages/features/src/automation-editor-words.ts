/**
 * automation-editor-words.ts -- what an automation's editor offers and calls each choice, the desktop's and the phone's alike: the triggers, the schedule's kinds, days, and hourly minutes, a zone's name, GitHub's and Sentry's events and settings, and the form's group headings.
 */

import { SCHEDULE_KIND, type ScheduleKind } from "./automation-draft-model.js";
import { AUTOMATION_CALL_FAILURE, type AutomationCallFailure } from "./automation-view.js";
import {
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationTargetKind,
  type AutomationTriggerKind,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  type GitHubSender,
  type GitHubTriggerEvent,
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
} from "./automation-wire.js";
import { AUTOMATION_SAVE_REFUSAL_WORDS } from "./automation-words.js";
import { PRODUCT_NAME } from "./product-name.js";
import {
  SENTRY_LEVEL,
  SENTRY_TRIGGER_EVENT,
  type SentryLevel,
  type SentryTriggerEvent,
} from "./trigger-catalog.js";
import { IRREVERSIBLE_WORDS } from "./words.js";

/** One choice an editor's menu or switch offers: its value, its name, and the words under its name where its name alone cannot say it. */
interface EditorChoice<Value> {
  readonly value: Value;
  readonly label: string;
  readonly detail?: string;
}

/** The kinds of schedule as the picker offers them, in its order. */
export const SCHEDULE_KINDS: readonly EditorChoice<ScheduleKind>[] = [
  { value: SCHEDULE_KIND.HOURLY, label: "Hourly" },
  { value: SCHEDULE_KIND.DAILY, label: "Daily" },
  { value: SCHEDULE_KIND.WEEKDAYS, label: "Weekdays" },
  { value: SCHEDULE_KIND.WEEKLY, label: "Weekly" },
  { value: SCHEDULE_KIND.ONCE, label: "Once" },
  { value: SCHEDULE_KIND.CUSTOM, label: "Custom" },
];

/** What may fire an automation, as the Type picker names them. */
export const AUTOMATION_TRIGGERS: readonly EditorChoice<AutomationTriggerKind>[] = [
  { value: AUTOMATION_TRIGGER.SCHEDULE, label: "Schedule" },
  { value: AUTOMATION_TRIGGER.GITHUB, label: "GitHub event" },
  { value: AUTOMATION_TRIGGER.WEBHOOK, label: "Webhook" },
  { value: AUTOMATION_TRIGGER.INTEGRATION, label: "Sentry" },
];

/** The Sentry events the event menu offers, the recommended one first, an alert saying how it reaches us. */
export const SENTRY_EVENTS: readonly EditorChoice<SentryTriggerEvent>[] = [
  {
    value: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    label: "Alert triggered (recommended)",
    detail: `Set the alert rule's action to send a notification to the ${PRODUCT_NAME} integration.`,
  },
  { value: SENTRY_TRIGGER_EVENT.ISSUE_CREATED, label: "New issue" },
];

/** Sentry's levels as the level pills name them, least severe first. */
export const SENTRY_LEVELS: readonly EditorChoice<SentryLevel>[] = [
  { value: SENTRY_LEVEL.DEBUG, label: "Debug" },
  { value: SENTRY_LEVEL.INFO, label: "Info" },
  { value: SENTRY_LEVEL.WARNING, label: "Warning" },
  { value: SENTRY_LEVEL.ERROR, label: "Error" },
  { value: SENTRY_LEVEL.FATAL, label: "Fatal" },
];

/** The GitHub events the event menu offers, in its order. */
export const GITHUB_EVENTS: readonly EditorChoice<GitHubTriggerEvent>[] = [
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, label: "Pull request opened or updated" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED, label: "Pull request opened" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED, label: "Pull request labeled" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_MERGED, label: "Pull request merged" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_OPENED, label: "Issue opened" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_LABELED, label: "Issue labeled" },
  { value: GITHUB_TRIGGER_EVENT.CHECK_FAILED, label: "Checks failed" },
  { value: GITHUB_TRIGGER_EVENT.PUSH, label: "Commits pushed" },
  { value: GITHUB_TRIGGER_EVENT.RELEASE_PUBLISHED, label: "Release published" },
];

/** Whose events a GitHub trigger may hear, as its switches name them. */
export const GITHUB_SENDERS: readonly EditorChoice<GitHubSender>[] = [
  { value: GITHUB_SENDER.PEOPLE, label: "From people" },
  { value: GITHUB_SENDER.APP_AGENTS, label: `From ${PRODUCT_NAME}'s agents` },
  { value: GITHUB_SENDER.OTHER_BOTS, label: "From other bots" },
];

/** The moments of a pull request an update may fire on, as its switches name them. */
export const PULL_REQUEST_MOMENTS: readonly EditorChoice<PullRequestMoment>[] = [
  { value: PULL_REQUEST_MOMENT.OPENED, label: "When opened" },
  { value: PULL_REQUEST_MOMENT.READY, label: "When marked ready" },
  {
    value: PULL_REQUEST_MOMENT.PUSHED,
    label: "When pushed to",
    detail: `Never for a push by ${PRODUCT_NAME}'s agents.`,
  },
];

/** The GitHub events a pull request's drafts and forks speak to. */
export const PULL_REQUEST_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_MERGED,
]);

/** A GitHub trigger's other switches, as each names itself. */
export const GITHUB_SWITCH_WORDS = {
  SKIP_DRAFTS: "Skip drafts",
  INCLUDE_FORKS: "Include forks",
  FORKS_DETAIL: "Its code comes from outside the repository, and the agent can push to it.",
  INCLUDE_PRERELEASES: "Include prereleases",
} as const;

/** Where a run lands, as the Runs land in picker names them. */
export const AUTOMATION_TARGETS: readonly EditorChoice<AutomationTargetKind>[] = [
  { value: AUTOMATION_TARGET.NEW_AGENT, label: "New agent each run" },
  { value: AUTOMATION_TARGET.SAME_AGENT, label: "Same agent" },
];

/** The editor's rows and what they say beside or under themselves, the desktop's and the phone's alike. */
export const AUTOMATION_EDITOR_WORDS = {
  NEW: "New automation",
  EDIT: "Edit automation",
  NAME: "Name",
  NAME_PLACEHOLDER: "Untitled automation",
  OWNER: "Owner",
  PERSONAL_OWNER_DETAIL: "Only you can change it. Owners and admins can see it.",
  /** Who may change a workspace's automation besides its owners and admins, where the reader made it. */
  YOU: "You",
  /** Who may change it, where someone else made it. */
  ITS_CREATOR: "Its creator",
  TYPE: "Type",
  EVENT: "Event",
  RUNS: "Runs",
  TIME: "Time",
  DAY: "Day",
  DATE: "Date",
  MINUTES_PAST: "Minutes past the hour",
  CRON: "Cron",
  TIME_ZONE: "Time zone",
  SEARCH_ZONES: "Search time zones",
  NO_ZONES: "No time zones match",
  PROMPT_PLACEHOLDER: "Find the flakiest test in CI this week and fix it.",
  REPOSITORY: "Repository",
  NO_REPOSITORY: "None",
  TASK_REPOSITORY: "Its task's repository.",
  RUNS_LAND_IN: "Runs land in",
  FIRST_RUN_DETAIL: "Started by its first run. Later runs are sent to it.",
  AGENT_DETAIL: "Each run is sent to it as a message, on its own model.",
  MODEL: "Model",
  EFFORT: "Effort",
  DEFAULT_MODEL: "Your default model.",
  MARK_DONE: "Mark finished runs Done",
  SLACK_RESULT: "Send the result to me on Slack",
  SAVE: "Save",
  SAVING: "Saving",
  CREATE: "Create",
  CREATING: "Creating",
} as const;

/** What the Owner row says under itself where the workspace owns it: who sees, runs, and changes it. */
export function workspaceOwnerDetail(workspaceName: string, changers: string): string {
  return `Everyone in ${workspaceName} can see and run it. ${changers}, owners, and admins can change it.`;
}

/** The schedule's next run, as its Runs row says under itself: "Next: Mon, Nov 24 at 9:00 AM". */
export function nextRunWords(when: string): string {
  return `Next: ${when}`;
}

/** A webhook trigger's rows, as the desktop's editor says them: its address, its secret shown once, and New secret, which asks first. */
export const WEBHOOK_WORDS = {
  ADDRESS: "Address",
  ADDRESS_DETAIL:
    "POST with the secret as Authorization: Bearer. The body shows in the run's transcript, so keep secrets out of it.",
  SAVE_FIRST: "Save to get its address and secret.",
  COPY_ADDRESS: "Copy address",
  SECRET: "Secret",
  COPY_SECRET: "Copy secret",
  SECRET_ONCE: "You won't be able to see this again. Copy it into your sender now.",
  DONE: "Done",
  NEW_SECRET: "New secret",
  NEW_SECRET_TITLE: "Make a new secret?",
  NEW_SECRET_BODY: `The secret your sender uses now stops working until you give it the new one, which ${PRODUCT_NAME} shows you once. ${IRREVERSIBLE_WORDS}`,
  NEW_SECRET_VERB: "Make secret",
  NEW_SECRET_RUNNING: "Making",
} as const;

/** A Sentry trigger's rows, as the desktop's editor says them. */
export const SENTRY_WORDS = {
  NOT_INSTALLED: "Sentry isn't installed",
  INSTALL: "Install Sentry",
  INSTALL_DETAIL: `Its events reach ${PRODUCT_NAME} through the workspace's Sentry, installed on the workspace's Settings page on the web.`,
  WITHHELD: `${PRODUCT_NAME} cannot receive Sentry events here. Choose another trigger.`,
  PROJECTS: "Projects",
  PROJECTS_DETAIL: "Project slugs, comma-separated.",
  ENVIRONMENTS: "Environments",
  ENVIRONMENTS_DETAIL: "Comma-separated.",
  ALL: "All",
  LEVELS: "Levels",
  LEVELS_DETAIL: "None picked for every level.",
} as const;

/** The agent a same-agent automation's runs go to, as its picker names what is not one of the listed agents. */
export const RUNS_AGENT_WORDS = {
  AGENT: "Agent",
  FIRST_RUN: "Started by its first run",
  NO_LONGER_LISTED: "An agent no longer listed",
} as const;

/** Why New secret made none, as its question goes on saying. */
export const NEW_SECRET_REFUSAL_WORDS = {
  ...AUTOMATION_SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The secret could not be made. Try again.",
} as const satisfies Record<AutomationCallFailure, string>;

/** The days of the week as cron numbers them, Sunday at 0. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The minutes past the hour an hourly schedule offers. */
export const HOURLY_MINUTES = [0, 15, 30, 45] as const;

/** The form's groups, by their headings, in the order the form stands them. */
export const AUTOMATION_EDITOR_SECTION = {
  SHARING: "Sharing",
  TRIGGER: "Trigger",
  PROMPT: "Prompt",
  WHERE_IT_RUNS: "Where it runs",
} as const;

/** A minute past the hour as the hourly picker names it: "At :15". */
export function hourlyLabel(minute: number): string {
  return `At :${String(minute).padStart(2, "0")}`;
}

/** A zone as the zone picker names it, its underscores read as spaces: "America/New York". */
export function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}
