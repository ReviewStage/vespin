/**
 * handoff.ts -- what the window hands off to the member's iPhone: the thread, task, agent, or pull request it shows, told to the shell each time it changes.
 *
 * What the window shows is the first link at hand as the keyboard stands
 * outside the side panel, the one ⇧⌘C copies (`links-at-hand.ts`): the
 * agent of a task's work column, the side panel's pull request where the
 * panel leads, else the task, or the Inbox's thread. It is handed off as
 * the phone's own screen for it is (`desktopHandoffOf`), and a place the
 * phone draws no screen for hands off nothing. A shell with nowhere to hand
 * it, the web's, is told nothing.
 */

import { desktopHandoffOf, type HandoffReads } from "@repo/features/ios-system-activity";
import type { ReadLink } from "@repo/features/link-grammar";
import { useEffect } from "react";
import { appPlatform } from "./app-platform.js";

/** Tells the shell what `shown` hands off, or none, each time that changes. */
export function useHandoff(shown: ReadLink | undefined, reads: HandoffReads): void {
  const activity = shown === undefined ? undefined : desktopHandoffOf(shown, reads);
  const webpageUrl = activity?.webpageUrl;
  const pullRequest = activity?.pullRequest;

  useEffect(() => {
    const tell = appPlatform().handoff;

    if (tell === undefined) return;

    if (webpageUrl === undefined) {
      tell(null);

      return;
    }

    tell(pullRequest === undefined ? { webpageUrl } : { webpageUrl, pullRequest });
  }, [webpageUrl, pullRequest]);
}
