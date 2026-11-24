/**
 * automation-words.ts -- what deleting an automation asks, from its editor's ⋯ and its row's menu alike; the words every place naming an automation says are `@repo/features/automation-words`.
 */

import { AUTOMATION_DELETE_WORDS, automationDeleteTitle } from "@repo/features/automation-words";
import { CONFIRM_LOSS, type DialogQuestion } from "@repo/ui";

/** What deleting an automation asks, from its editor's ⋯ and its row's menu alike: what goes, and what stays. */
export function automationDeleteQuestion(name: string | undefined): DialogQuestion {
  return {
    title: automationDeleteTitle(name),
    body: AUTOMATION_DELETE_WORDS.BODY,
    verb: AUTOMATION_DELETE_WORDS.VERB,
    running: AUTOMATION_DELETE_WORDS.RUNNING,
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    titleReplayMasked: name !== undefined,
  };
}
