/**
 * use-inbox-older-pages.ts -- the Inbox's reads of the account's settled items older than its feed holds, a page at a time, from the service into the host, while All is shown, as the panel's Inbox reads them.
 *
 * The paging itself is the one every client's list reads by
 * (`@repo/features/settled-paging`, over `inbox-older-pages.ts`'s ask):
 * this hands it the host's act port and tells it, each draw, the account
 * whose All is shown, or none while another scope is, so All shown anew
 * reads from the newest page. The page lands on the document
 * (`LIVE_READ.INBOX_OLDER`), never here, and is laid beside the feed's
 * items where the Inbox is grouped (`inbox-groups.tsx`); the list's last
 * row tells the paging as it comes and goes (`RowForEach`'s `onAtEnd`), and
 * the listing whether it draws any row (`onDrawn`), since a list drawing
 * none has no last row to come on screen. Beside the paging it keeps
 * whether a page is out, which the list's end stands a spinner for while
 * the next page is read, and whether the last page asked was not answered,
 * so a service that refuses is asked again only once the reader scrolls the
 * list's end away and back.
 */

import { inboxOlderPageAsk } from "@repo/features/inbox-older-pages";
import { type SettledPageAsk, settledPaging } from "@repo/features/settled-paging";
import { ACT_KIND } from "@repo/host/acts";
import { useEffect, useMemo, useState } from "react";
import { useHostActs } from "../host/host-provider.js";

/** What All's list reads of the paging: the door its last row tells, the door told whether it draws any row, and whether a page is out now. */
export interface InboxOlderPages {
  readonly onAtEnd: (atEnd: boolean) => void;
  readonly onDrawn: (drawsAny: boolean) => void;
  readonly reading: boolean;
}

/** The pages read of the account's older Inbox items while `shown` for `accountId`, and what All's list reads of them. */
export function useInboxOlderPages(accountId: string | undefined, shown: boolean): InboxOlderPages {
  const acts = useHostActs();
  const [reading, setReading] = useState(false);

  // Note that the ask is watched rather than the paging, which alone says when a page is asked, so the spinner stands for the very asks it makes.
  const [paged] = useState(() => {
    const ask = inboxOlderPageAsk((page) => acts[ACT_KIND.AGENTS_INBOX_OLDER_PAGE](page));
    // Whether the last page asked was not answered, so an end still standing on screen asks no page again until the reader scrolls it away and back.
    let failed = false;
    // How many pages were asked, so only the latest ask's answer settles the spinner and the failure, never one of an All let go that lands late.
    let asked = 0;

    const watched: SettledPageAsk<string> = (scope, before) => {
      asked += 1;
      const ours = asked;
      setReading(true);

      const settle = (refused: boolean) => {
        if (ours !== asked) return;
        failed = refused;
        setReading(false);
      };

      return ask(scope, before).then(
        (answer) => {
          settle("failure" in answer);

          return answer;
        },
        (cause: unknown) => {
          settle(true);

          throw cause;
        },
      );
    };

    const paging = settledPaging(watched);

    // Note that the list's last row tells it stands on every draw, and the spinner going after a page the service did not answer is a draw, so an end heard after a failure asks again only once the end left the screen, or the next draw would ask the same page at once, and again for as long as the service refuses it.
    const onAtEnd = (atEnd: boolean) => {
      if (!atEnd) failed = false;
      else if (failed) return;

      paging.onRunEnd(atEnd);
    };

    return { paging, onAtEnd };
  });

  const { paging, onAtEnd } = paged;

  // Note that All shown anew reads from its newest page, and All let go stops paging.
  useEffect(() => {
    paging.show(shown ? accountId : undefined);
  });

  // Note that a list let go stops paging, so an answer landing after it reads no page more.
  useEffect(() => () => paging.show(undefined), [paging]);

  return useMemo(() => ({ onAtEnd, onDrawn: paging.onDrawn, reading }), [onAtEnd, paging, reading]);
}
