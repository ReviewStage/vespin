/**
 * manager-overview.tsx -- a Manager's page's main panel: what the Manager is doing, beside its chat.
 *
 * A Manager's page (`desktop-agent-page.tsx`) stands its chat in a column at
 * its right and this panel in the room it leaves, under the page's head,
 * which names the Manager, so the panel draws no title of its own: it is a
 * page under the window's toolbar (`PAGE_FRAME.TOOLBAR`), named for a
 * reader by its label, its content across the whole room it has.
 */

import { DetailPage, PAGE_FRAME, PAGE_WIDTH } from "@repo/ui";

/** What the panel is called, said to a reader as its region's name. */
const OVERVIEW = "Overview";

/** A Manager's overview, under the page's head and beside its chat. */
export function ManagerOverview(): React.JSX.Element {
  return (
    <DetailPage frame={PAGE_FRAME.TOOLBAR} label={OVERVIEW} width={PAGE_WIDTH.FULL}>
      {null}
    </DetailPage>
  );
}
