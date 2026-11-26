/**
 * inbox-runs.ts -- which of the Inbox's runs, Pinned and Everything else, the reader folded, kept on this device across launches, as the panel keeps them on each Mac (`app.inboxFoldedRuns`).
 *
 * The folds are held in memory and kept in the app's `NSUserDefaults`
 * through React Native's `Settings` for the next launch, as the Automations
 * tab's order is (`automations-order.ts`), so the list and the thread's
 * steps, which leave a folded run's threads out, hear a fold as it is made.
 */

import { INBOX_RUNS, type InboxRun } from "@repo/features/inbox-list-model";
import { heldValue, useHeldValue } from "@repo/ui-native";
import { useCallback } from "react";
import { Settings } from "react-native";

/** The defaults key the folded runs are kept under. */
const FOLDED_KEY = "inboxFoldedRuns";

/** The runs folded at launch: those kept that this build knows, none where nothing was kept. */
function launchFolded(): ReadonlySet<InboxRun> {
  const kept: unknown = Settings.get(FOLDED_KEY);
  const runs = Array.isArray(kept) ? kept : [];

  return new Set(INBOX_RUNS.filter((run) => runs.includes(run)));
}

/** The runs folded as the device holds them now, held here rather than read back from `Settings`, whose copy lands on the native side only later. */
const folded = heldValue<ReadonlySet<InboxRun>>(launchFolded());

/** The runs folded, and the press that folds a run or opens it, kept and heard by every screen reading them. */
export interface InboxRunFolds {
  readonly folded: ReadonlySet<InboxRun>;
  readonly onFold: (run: InboxRun, shut: boolean) => void;
}

/** The Inbox's folded runs as the device keeps them, and the door that folds one or opens it. */
export function useInboxRunFolds(): InboxRunFolds {
  const kept = useHeldValue(folded);

  const onFold = useCallback((run: InboxRun, shut: boolean) => {
    const next = new Set(folded.read());

    if (shut) next.add(run);
    else next.delete(run);

    Settings.set({ [FOLDED_KEY]: [...next] });
    folded.set(next);
  }, []);

  return { folded: kept, onFold };
}
