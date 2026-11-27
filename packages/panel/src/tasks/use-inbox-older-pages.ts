/**
 * use-inbox-older-pages.ts -- the window's Inbox's reads of the account's settled items older than its feed holds, a page at a time, from the service into the host, while All is shown.
 *
 * The paging itself is the one every client's list reads by
 * (`@repo/features/settled-paging`, over `inbox-older-pages.ts`'s ask):
 * this hands it the window's act port and tells it, each draw, the account
 * whose All is shown, or none while another view, a narrowed task, or no
 * Inbox is, so All shown anew reads from the newest page. The page lands on
 * app state (`LIVE_READ.INBOX_OLDER`), never here; the list's last run tells
 * the paging as it comes to its end (`onAtEnd`). Beside the paging it
 * keeps whether a page is out, which the list's end draws a placeholder row
 * for while the next page is read, and whether the last was read.
 */

import { inboxOlderPageAsk } from "@repo/features/inbox-older-pages";
import { type SettledPageAsk, settledPaging } from "@repo/features/settled-paging";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useMemo, useState } from "react";
import { askAct } from "../act.js";

/** What All's list reads of the paging: the door its end tells, and whether a page is out now. */
export interface InboxOlderPages {
  readonly onAtEnd: (atEnd: boolean) => void;
  readonly reading: boolean;
}

/** The pages read of the account's older Inbox items while `shown` for `accountId`, and what All's list reads of them. */
export function useInboxOlderPages(accountId: string | undefined, shown: boolean): InboxOlderPages {
  const [reading, setReading] = useState(false);

  // Note that the ask is watched rather than the paging, which alone says when a page is asked, so the row drawn while one is out follows the very asks it makes.
  const [paging] = useState(() => {
    const ask = inboxOlderPageAsk((page) => askAct(ACT_KIND.AGENTS_INBOX_OLDER_PAGE, page));

    const watched: SettledPageAsk<string> = (scope, before) => {
      setReading(true);

      return ask(scope, before).finally(() => setReading(false));
    };

    return settledPaging(watched);
  });

  // Note that All shown anew reads from its newest page, and All let go stops paging.
  useEffect(() => {
    paging.show(shown ? accountId : undefined);
  });

  // Note that a list let go stops paging, so an answer landing after it reads no page more.
  useEffect(() => () => paging.show(undefined), [paging]);

  return useMemo(() => ({ onAtEnd: paging.onRunEnd, reading }), [paging, reading]);
}
