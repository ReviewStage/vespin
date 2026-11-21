/**
 * automation-words.ts -- what deleting an automation asks, from its editor's ⋯ and its row's menu alike; the words every place naming an automation says are `@repo/features/automation-words`.
 */

import { CONFIRM_LOSS, type DialogQuestion } from "@repo/ui";

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
