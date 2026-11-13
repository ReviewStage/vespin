/**
 * use-service-task-search.ts -- ⌘K's search of the account's tasks past the list the window holds: the words typed, asked of the host once typing pauses.
 *
 * The window's own search filters the tasks its list holds, and answers at
 * once. The host keeps only some of the account's tasks live, so the words
 * typed are asked of it too (`TASKS_SEARCH`), which reads the few tasks the
 * service finds by them and draws each the list holds not into it as a cold
 * task, where the window's own search then finds it beside the rest, one row
 * each, and opens it as any. Nothing is read back here: the answer arrives as
 * the list's.
 */

import { TASK_SEARCH_QUERY_MAX_CHARS } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect } from "react";
import { tellAct } from "../act.js";

/** How long typing pauses before its words are asked of the host, so a word typed out reads once rather than once a letter. */
const SEARCH_PAUSE_MILLIS = 250;

/** Asks the host for the tasks `query` finds past its list once typing pauses, while `asked`; see the module's head. */
export function useServiceTaskSearch(query: string, asked: boolean): void {
  const words = query.trim().slice(0, TASK_SEARCH_QUERY_MAX_CHARS);

  useEffect(() => {
    if (!asked || words.length === 0) return;

    const pause = setTimeout(
      () => tellAct(ACT_KIND.TASKS_SEARCH, { query: words }),
      SEARCH_PAUSE_MILLIS,
    );

    return () => clearTimeout(pause);
  }, [asked, words]);
}
