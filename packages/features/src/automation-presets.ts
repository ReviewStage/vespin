import { AGENT_TOOL } from "./agent-tools.js";
import { SCHEDULE_PRESET } from "./automation-schedule.js";
import { INBOX_BOUNDS, INBOX_TOOL } from "./inbox-wire.js";

/**
 * automation-presets.ts -- the automations the Automations list suggests: each preset's fields filled in, and the one door that names them.
 *
 * A preset is nothing but the fields of an ordinary automation filled in.
 * The list suggests it as a card, and a press opens a new automation's page
 * filled in from it (`automation-draft-model.ts`'s `presetDraft`), to look
 * over, change, and Create. It runs on the one path every automation runs
 * on (`automation-runs.ts`), and nothing reads a preset after it is saved,
 * so the member's edits are the automation and no second copy of what it
 * does is kept. Which presets a list suggests, such as one only while the
 * workspace has an experiment on, is the list's to say, since the
 * experiments are a package above this one.
 *
 * Memory digest, the one preset, has an agent post the memories the
 * workspace kept or corrected that week as one Inbox thread every Monday,
 * and forget those the member marks (`list_memories` and `forget_memory`,
 * `packages/service/src/agents/memory-tools.ts`), so what the agents
 * learned quietly is seen, and what is wrong goes.
 */

/** A preset as the list suggests it: the automation's own fields, filled in. */
export interface AutomationPreset {
  readonly name: string;
  /** What the Automations list says the preset does, on its card. */
  readonly description: string;
  /** The schedule it runs on, as five-field cron read in the member's own zone. */
  readonly cron: string;
  readonly prompt: string;
  readonly archiveSuccessful: boolean;
  /** Whether its runs work in a repository; one that needs none starts with none chosen. */
  readonly inRepository: boolean;
}

/** The days a digest looks back over, as its weekly schedule spaces its runs. */
const DIGEST_DAYS = 7;

/** What the Memory digest's agent is told: the week's memories posted as one thread, and the ones the member marks forgotten. */
const MEMORY_DIGEST_PROMPT = `Post the memories this workspace kept or corrected in the last ${DIGEST_DAYS} days as one Inbox thread, so its members see what the agents learned, and delete the ones they mark.

1. Call \`${AGENT_TOOL.LIST_MEMORIES}\` with \`since\` set to ${DIGEST_DAYS} days before now, as a time with its offset, and read every page through \`nextOffset\`. A memory whose \`keptAt\` is before that time was corrected this week; every other one is new.
2. If it answers no memories, or the memory tools are refused or unavailable, stop here and post nothing.
3. Post one thread with \`${INBOX_TOOL.POST}\`, titled "Memory digest" with the week it covers, such as "Memory digest, Nov 2 to 9". Group the memories by the task each came from, under a heading that mentions that task, and put the memories with no task last, under "No task". Quote each memory word for word as a block quote, with its id in code after it, and mark the ones corrected this week as corrected.
4. End the thread with a decide ask, \`multiple: true\`, asking which memories to delete, with one option per memory: its label the memory's opening words, and its detail its id. Recommend none. A decide holds 2 to ${INBOX_BOUNDS.MAX_OPTIONS} options, so where the week kept one memory, offer it beside "Keep it", and where it kept more than ${INBOX_BOUNDS.MAX_OPTIONS}, number the memories in the thread and ask for an answer in their own words naming the numbers to delete instead.
5. Once a member answers, call \`${AGENT_TOOL.FORGET_MEMORY}\` with the id of each memory they chose, and nothing else. Then reply on the thread under the same key, quoting each memory you deleted, and saying which, if any, were refused and why. Where they chose none, reply that nothing was deleted.

Change no memory but the ones a member chose to delete, and post nothing else.`;

/** The memories kept or corrected each week, posted to the Inbox every Monday at nine in the member's zone, the ones the member marks forgotten. */
function memoryDigestPreset(): AutomationPreset {
  return {
    name: "Memory digest",
    description:
      "Every Monday, posts the memories agents kept or corrected that week to your Inbox, and deletes the ones you mark.",
    cron: SCHEDULE_PRESET.WEEKLY,
    prompt: MEMORY_DIGEST_PROMPT,
    // Note that a run whose thread still asks is held back from its archive until it is answered (`run-archive.ts`).
    archiveSuccessful: true,
    inRepository: false,
  };
}

/** The presets the Automations list suggests, each by the name a new automation's page is opened from it with. */
export const AUTOMATION_PRESET = {
  MEMORY_DIGEST: "memory-digest",
} as const;

export type AutomationPresetName = (typeof AUTOMATION_PRESET)[keyof typeof AUTOMATION_PRESET];

/** The preset a suggestion names, its fields filled in afresh. */
export function automationPreset(name: AutomationPresetName): AutomationPreset {
  switch (name) {
    case AUTOMATION_PRESET.MEMORY_DIGEST:
      return memoryDigestPreset();
  }
}
