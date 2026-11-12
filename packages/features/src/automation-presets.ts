import { AGENT_TOOL } from "./agent-tools.js";
import { AUTOMATION_PRESET, type AutomationPresetName } from "./automation-preset-name.js";
import { SCHEDULE_PRESET } from "./automation-schedule.js";
import {
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationTargetKind,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
  type IntegrationTrigger,
} from "./automation-wire.js";
import { INBOX_BOUNDS, INBOX_TOOL } from "./inbox-wire.js";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "./trigger-catalog.js";

export { AUTOMATION_PRESET, type AutomationPresetName } from "./automation-preset-name.js";

/**
 * automation-presets.ts -- the automations the Automations list suggests: each preset's fields filled in, and the one door that names them.
 *
 * A preset is nothing but the fields of an ordinary automation filled in.
 * The list suggests it as a card, and a press opens a new automation's page
 * filled in from it (`automation-draft-model.ts`'s `presetDraft`), to look
 * over, change, and Create. It runs on the one path every automation runs
 * on (`automation-runs.ts`), and nothing reads a preset's fields after it is
 * saved, so the member's edits are the automation and no second copy of what
 * it does is kept; an automation made from a card keeps only the preset's
 * key. Which presets a list suggests, such as one only while the workspace
 * has an experiment on, or what one needs connected first, is the list's to
 * say, since the experiments and the workspace's integrations are a package
 * above this one.
 *
 * Memory digest has an agent post the memories the workspace kept or
 * corrected that week as one Inbox thread every Monday, and forget those
 * the member marks (`list_memories` and `forget_memory`,
 * `packages/service/src/agents/memory-tools.ts`), so what the agents
 * learned quietly is seen, and what is wrong goes.
 *
 * Triage a red main has an agent find why a check failed on the default
 * branch and post it as one Inbox thread, with a fix where it is small and
 * clear. A GitHub trigger keeps to branches by their names alone
 * (`automation-github.ts`'s `triggerMatches`), and the editor neither shows
 * nor writes them, so the preset names the two a default branch is almost
 * always called, and its agent stops on any other. Every run goes to the
 * one agent, which holds the threads it posted (an agent posts on its own
 * threads alone), so a check that fails again is a message on the thread
 * that reported it rather than a thread of its own.
 *
 * Investigate Sentry alerts has an agent read the issue an alert fired on,
 * and open a fix or post what it found. It listens for an alert rule
 * firing, never for a new issue, which fires on every new error, and each
 * issue fires it once within its subject cooldown (`AutomationGuards`).
 */

/**
 * What fires a preset's automation: a schedule, as five-field cron read in
 * the member's own zone; a GitHub event, on the branches it names; or an
 * integration's event, unfiltered.
 */
export type AutomationPresetTrigger =
  | { readonly kind: typeof AUTOMATION_TRIGGER.SCHEDULE; readonly cron: string }
  | {
      readonly kind: typeof AUTOMATION_TRIGGER.GITHUB;
      readonly event: GitHubTriggerEvent;
      readonly branches: readonly string[];
    }
  | IntegrationTrigger;

/** A preset as the list suggests it: the automation's own fields, filled in. */
export interface AutomationPreset {
  readonly name: string;
  /** What the Automations list says the preset does, on its card. */
  readonly description: string;
  readonly trigger: AutomationPresetTrigger;
  readonly prompt: string;
  /** Where its runs land: a new agent each, or the one agent every run goes to. */
  readonly target: AutomationTargetKind;
  readonly archiveSuccessful: boolean;
  /** Whether its runs work in a repository; one that needs none starts with none chosen. */
  readonly inRepository: boolean;
  /** Whether it is the workspace's where the workspace is shared, since what it watches is everyone's; the maker's own otherwise. */
  readonly forWorkspace: boolean;
}

/** The days a digest looks back over, as its weekly schedule spaces its runs. */
const DIGEST_DAYS = 7;

/** The names a repository's default branch is almost always given, which Triage a red main keeps to. */
const DEFAULT_BRANCH_NAMES: readonly string[] = ["main", "master"];

/** What the Memory digest's agent is told: the week's memories posted as one thread, and the ones the member marks forgotten. */
const MEMORY_DIGEST_PROMPT = `Post the memories this workspace kept or corrected in the last ${DIGEST_DAYS} days as one Inbox thread, so its members see what the agents learned, and delete the ones they mark.

1. Call \`${AGENT_TOOL.LIST_MEMORIES}\` with \`since\` set to ${DIGEST_DAYS} days before now, as a time with its offset, and read every page through \`nextOffset\`. A memory whose \`keptAt\` is before that time was corrected this week; every other one is new.
2. If it answers no memories, or the memory tools are refused or unavailable, stop here and post nothing.
3. Post one thread with \`${INBOX_TOOL.POST}\`, titled "Memory digest" with the week it covers, such as "Memory digest, Nov 2 to 9". Group the memories by the task each came from, under a heading that mentions that task, and put the memories with no task last, under "No task". Quote each memory word for word as a block quote, with its id in code after it, and mark the ones corrected this week as corrected.
4. End the thread with a decide ask, \`multiple: true\`, asking which memories to delete, with one option per memory: its label the memory's opening words, and its detail its id. Recommend none. A decide holds 2 to ${INBOX_BOUNDS.MAX_OPTIONS} options, so where the week kept one memory, offer it beside "Keep it", and where it kept more than ${INBOX_BOUNDS.MAX_OPTIONS}, number the memories in the thread and ask for an answer in their own words naming the numbers to delete instead.
5. Once a member answers, call \`${AGENT_TOOL.FORGET_MEMORY}\` with the id of each memory they chose, and nothing else. Then reply on the thread under the same key, quoting each memory you deleted, and saying which, if any, were refused and why. Where they chose none, reply that nothing was deleted.

Change no memory but the ones a member chose to delete, and post nothing else.`;

/** What Triage a red main's agent is told: the failure's cause found and posted once, a repeat said on the thread that reported it. */
const RED_MAIN_TRIAGE_PROMPT = `A check failed on this repository's default branch. Find out why and tell the workspace once.

1. If the branch this run names is not the repository's default branch, stop here and post nothing.
2. Read the failed check's logs at the commit this run names. If the check has since passed on a newer commit of the branch, stop here and post nothing.
3. Call \`${INBOX_TOOL.LIST}\` for your own threads. If one already reports this check failing for the same cause, post nothing new: where a newer commit or a new finding changes what it says, post it under that thread's key, and otherwise post nothing at all.
4. Find the cause: the commit that broke the check and the lines involved. Say plainly when it looks flaky, such as a timeout or a test that passes on a rerun of the same commit, and why you think so.
5. Where the fix is small and clear, open a pull request with it. Otherwise open none and change nothing.
6. Post one thread with \`${INBOX_TOOL.POST}\`, titled with the check's name and the branch, such as "Unit tests failing on main", saying the cause, the commit that broke it, whether it looks flaky, and the pull request if you opened one.

Post nothing else.`;

/** What Investigate Sentry alerts' agent is told: the issue read, then a fix opened or what was found posted. */
const SENTRY_ALERT_INVESTIGATION_PROMPT = `A Sentry alert fired on the issue this run names. Find out what broke and fix it where the fix is clear.

1. Read the issue: its error, its stack trace, and its latest events, with the Sentry tools you have. Where you have none, work from what this run says of the issue.
2. Find the code the stack trace runs through in this repository, and the cause. If the issue is already fixed on the default branch, say so in step 4 and change nothing.
3. Where the fix is clear, open a pull request with it, naming the Sentry issue and its cause in its description.
4. Post one thread with \`${INBOX_TOOL.POST}\`, titled with the issue's error, saying what you found: the cause as far as you got, the lines involved, and the pull request if you opened one, or what would fix it if you did not.

Post nothing else.`;

/** The memories kept or corrected each week, posted to the Inbox every Monday at nine in the member's zone, the ones the member marks forgotten. */
function memoryDigestPreset(): AutomationPreset {
  return {
    name: "Memory digest",
    description:
      "Every Monday, posts the memories agents kept or corrected that week to your Inbox, and deletes the ones you mark.",
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: SCHEDULE_PRESET.WEEKLY },
    prompt: MEMORY_DIGEST_PROMPT,
    target: AUTOMATION_TARGET.NEW_AGENT,
    // Note that a run whose thread still asks is held back from its archive until it is answered (`run-archive.ts`).
    archiveSuccessful: true,
    inRepository: false,
    forWorkspace: false,
  };
}

/** A failed check on the default branch, its cause posted to the Inbox once by the one agent every run goes to. */
function redMainTriagePreset(): AutomationPreset {
  return {
    name: "Triage a red main",
    description:
      "When a check fails on the default branch, finds the cause and posts it to your Inbox, with a fix where it's small and clear.",
    trigger: {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.CHECK_FAILED,
      branches: DEFAULT_BRANCH_NAMES,
    },
    prompt: RED_MAIN_TRIAGE_PROMPT,
    target: AUTOMATION_TARGET.SAME_AGENT,
    // Note that the one agent every run goes to is kept, since it holds the threads a repeat failure is said on.
    archiveSuccessful: false,
    inRepository: true,
    forWorkspace: true,
  };
}

/** A Sentry alert's issue read, then a fix opened or what was found posted, by a new agent each. */
function sentryAlertInvestigationPreset(): AutomationPreset {
  return {
    name: "Investigate Sentry alerts",
    description:
      "When a Sentry alert fires, reads the issue and its stack trace, then opens a fix or posts what it found.",
    trigger: {
      kind: AUTOMATION_TRIGGER.INTEGRATION,
      provider: TRIGGER_PROVIDER.SENTRY,
      event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    },
    prompt: SENTRY_ALERT_INVESTIGATION_PROMPT,
    target: AUTOMATION_TARGET.NEW_AGENT,
    // Note that a run with a pull request open or a thread still asking is held back from its archive (`run-archive.ts`).
    archiveSuccessful: true,
    inRepository: true,
    forWorkspace: true,
  };
}

/** The preset a suggestion names, its fields filled in afresh. */
export function automationPreset(name: AutomationPresetName): AutomationPreset {
  switch (name) {
    case AUTOMATION_PRESET.MEMORY_DIGEST:
      return memoryDigestPreset();
    case AUTOMATION_PRESET.RED_MAIN_TRIAGE:
      return redMainTriagePreset();
    case AUTOMATION_PRESET.SENTRY_ALERT_INVESTIGATION:
      return sentryAlertInvestigationPreset();
  }
}
