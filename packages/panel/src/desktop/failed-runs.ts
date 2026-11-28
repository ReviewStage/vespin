/**
 * failed-runs.ts -- tells the developer in the window that a run of their own automation failed to start: whether the sidebar's Automations wears the failed mark.
 *
 * The window says a failed run by this mark alone, the OS's notification
 * saying it too while the window is behind (`@repo/host/agent-notices`); the
 * mark goes on saying it until the automation is opened. Main hands the window the
 * newest failed run of each of the account's own automations
 * (`AppInboxSlice.failedRuns`), and opening an automation sees its failure,
 * kept on the account as a read mark is, one of its view choices
 * (`VIEW_CHOICE_KEY.FAILED_RUNS_SEEN`, `../view-choices.ts`), so the mark
 * stays off on every device until another run of it fails. What an earlier
 * build kept in this window's storage moves up once. A `staged` run keeps
 * nothing, so its frames never wear a developer's choices.
 */

import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import { VIEW_CHOICE_KEY, type ViewChoiceValue } from "@repo/features/view-choice-wire";
import { Schema } from "effect";
import { useEffect, useRef } from "react";
import { keptKey, useKeptLeaving } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";

/** Where an earlier build kept the failures seen in the renderer's storage, moved up to the account once. */
const KEPT_SEEN = keptKey(
  "app.seenFailedRuns",
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/** The newest failed run seen of each automation, by the automation's id. */
type Seen = ViewChoiceValue<typeof VIEW_CHOICE_KEY.FAILED_RUNS_SEEN>;

/** None seen, one record for every draw. */
const NONE_SEEN: Seen = {};

/**
 * Whether a run of the account's own automation in the listed workspace
 * failed since that automation was last opened, among `failedRuns`, every
 * workspace's. The automation `opened` sees its newest failure as it opens.
 * Note that a failure is told by its run's id rather than its instant,
 * because two runs may fail within one millisecond.
 */
export function useFailedRunsMark(
  failedRuns: readonly AccountFailedRun[],
  workspaceId: string | undefined,
  opened: string | undefined,
  staged: boolean,
): boolean {
  const { value: seen, change } = useAccountChoice(
    VIEW_CHOICE_KEY.FAILED_RUNS_SEEN,
    null,
    NONE_SEEN,
    staged,
    useKeptLeaving(KEPT_SEEN),
  );

  // Note that only the listed workspace's runs are seen, because an editor left open across a switch shows no other's.
  const listed = failedRuns.filter(
    (run) => workspaceId === undefined || run.workspaceId === workspaceId,
  );

  const openedRun = listed.find((run) => run.automationId === opened);
  // The failure this surface last saw, so it is kept once while the account's read catches up with it.
  const saw = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Note that the guard goes as the automation closes, so opening it again keeps a failure whose keeping did not go.
    if (openedRun === undefined) {
      saw.current = undefined;

      return;
    }

    if (seen[openedRun.automationId] === openedRun.id || saw.current === openedRun.id) return;
    saw.current = openedRun.id;

    // Note that only the automations still failing are kept, in every workspace, because one whose failures aged out of the read has nothing left to mark; and that it is made over the failures seen as it is kept, so one seen on another device since stands.
    change((held) =>
      Object.fromEntries(
        failedRuns.flatMap((run) => {
          const runId =
            run.automationId === openedRun.automationId ? run.id : held[run.automationId];

          return runId === undefined ? [] : [[run.automationId, runId]];
        }),
      ),
    );
  }, [openedRun, failedRuns, seen, change]);

  return listed.some((run) => run.automationId !== opened && seen[run.automationId] !== run.id);
}
