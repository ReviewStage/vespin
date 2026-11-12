/**
 * handoff.ts -- what the window hands off to the member's iPhone: the thread, task, agent, or pull request it shows, told to the shell each time it changes.
 *
 * What the window shows is the most specific link at hand, as the keyboard
 * stands outside the side panel, that the phone draws a screen for
 * (`links-at-hand.ts`, `desktopHandoffOf`): the agent of a task's work
 * column, the side panel's pull request where the panel leads, else the
 * task, or the Inbox's thread. So a page or a file open beside a task hands
 * off the task, and a window showing nothing the phone draws hands off
 * nothing. A shell with nowhere to hand it, the web's, is told nothing, and
 * nothing is worked out for it.
 */

import { desktopHandoffOf, type HandoffReads } from "@repo/features/ios-system-activity";
import type { ReadLink } from "@repo/features/link-grammar";
import { useEffect } from "react";
import { appPlatform } from "./app-platform.js";

/** The page the first of `shown` the phone draws hands off; none where it draws none of them. */
function handedOff(shown: readonly ReadLink[], reads: HandoffReads): string | undefined {
  for (const link of shown) {
    const activity = desktopHandoffOf(link, reads);

    if (activity !== undefined) return activity.webpageUrl;
  }

  return undefined;
}

/** Tells the shell the page `shown` hands off, most specific first, or none, each time that changes. */
export function useHandoff(shown: () => readonly ReadLink[], reads: HandoffReads): void {
  const webpageUrl = appPlatform().handoff === undefined ? undefined : handedOff(shown(), reads);

  useEffect(() => {
    const tell = appPlatform().handoff;

    if (tell === undefined) return;

    if (webpageUrl === undefined) {
      tell(null);

      return;
    }

    tell({ webpageUrl });
  }, [webpageUrl]);
}
