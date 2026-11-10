/**
 * file-refusal.ts -- why the service read no file, listed no folder, or read no skills of a repository, as a command's failure a person reads.
 *
 * `vespin task cat|ls` and `vespin repo cat|ls|skills` read the same
 * answers (`@repo/features/task-wire`'s `TaskFileRefusal`), so they share
 * these words; a repository named by its full name rather than its task
 * says its own words where a task's would not fit.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { TASK_FILE_REFUSAL, type TaskFileRefusal } from "@repo/features/task-wire";
import { CommandFailed } from "./output.js";

/** Each refusal's words, for one read through its task. */
export const FILE_REFUSAL_WORDS = {
  [TASK_FILE_REFUSAL.SECRET]: "The file may hold a secret, so its contents are never read.",
  [TASK_FILE_REFUSAL.MISSING]: "Nothing of that kind stands at that path.",
  [TASK_FILE_REFUSAL.NOT_TEXT]: "The file is too large, or not text.",
  [TASK_FILE_REFUSAL.NO_REPOSITORY]: "The task has no repository yet.",
  [TASK_FILE_REFUSAL.NOT_REACHABLE]:
    "The workspace's GitHub installation does not reach the task's repository.",
  [TASK_FILE_REFUSAL.UNAVAILABLE]: "GitHub did not answer just now; try again shortly.",
} as const satisfies Record<TaskFileRefusal, string>;

/** A refused read as the command's failure in the words given, naming the branch GitHub found nothing on. */
export function fileRefused(
  refused: { readonly refusal: TaskFileRefusal; readonly branch?: string },
  words: Readonly<Record<TaskFileRefusal, string>> = FILE_REFUSAL_WORDS,
) {
  const said = words[refused.refusal];
  return new CommandFailed({
    exit:
      refused.refusal === TASK_FILE_REFUSAL.UNAVAILABLE ? CLI_EXIT.UNAVAILABLE : CLI_EXIT.REFUSED,
    message: refused.branch === undefined ? said : `${said} (read on ${refused.branch})`,
  });
}
