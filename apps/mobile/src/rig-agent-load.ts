// rig-agent-load.ts -- the rig's measure of an agent's page while its turn streams: how often the JS thread was held over 50 ms, for how long in all and at most, how many times the page and its composer drew, and how many changes of the document the app heard, over one window from the page's first draw, written to a file for `scripts/working-manager.sh`; nothing outside a fixture run that streams a turn.

import { useQueryClient } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useEffect } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { hostStateRootIn } from "./host/expo-file-system.js";
import { launchStreamTurn } from "./host/launch-arguments.js";

/** How long the page is measured over from its first draw, in milliseconds: long enough for hundreds of the stream's changes and a sentence typed among them. */
const WINDOW_MS = 60_000;

/** Where the measure is written, for the rig to read off the simulator (`scripts/working-manager.sh`). */
const RIG_FILE = `file://${hostStateRootIn(Paths.document.uri)}/rig/agent-load.json`;

/** Whether this run streams a turn, read once; never on a phone. */
const MEASURED = launchStreamTurn() !== undefined;

/** What one window held so far. */
const held = {
  longTasks: 0,
  longTaskMs: 0,
  longestMs: 0,
  pageDraws: 0,
  composerDraws: 0,
  changes: 0,
};

/** Whether the window opened, so it is opened once a run. */
let opened = false;

/** Counts one draw of the page, or of its composer, while the window stands; nothing outside the rig. */
export function rigAgentDrawn(part: "page" | "composer"): void {
  if (!MEASURED) return;

  if (part === "page") held.pageDraws += 1;
  else held.composerDraws += 1;
}

/**
 * Opens the rig's window as the page first draws, once a run: the long
 * tasks React Native reports (a stretch of 50 ms or more with no chance to
 * yield) and each change of the document written into the app's client, the
 * stream's among them, until the window ends, when the tally is written.
 */
export function useRigAgentLoad(): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!MEASURED || opened) return;
    opened = true;

    const watch = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        held.longTasks += 1;
        held.longTaskMs += entry.duration;
        held.longestMs = Math.max(held.longestMs, entry.duration);
      }
    });

    watch.observe({ type: "longtask" });
    const [key] = appStateQuery.queryKey;

    const heard = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.query.queryKey[0] === key) held.changes += 1;
    });

    setTimeout(() => {
      watch.disconnect();
      heard();
      const file = new File(RIG_FILE);
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      file.writeSync(JSON.stringify({ windowMs: WINDOW_MS, ...held }));
    }, WINDOW_MS);
  }, [client]);
}
