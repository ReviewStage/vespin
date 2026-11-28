/**
 * inbox-older-pages.ts -- the paging of an Inbox's settled items older than the account's feed holds, as every client's All asks for them: the shared settled paging (`settled-paging.ts`) over the host's older-page act.
 *
 * The account's feed holds every open item and the settled ones of its
 * window; an Inbox listing every item reads those older a page at a time
 * from the host (`AGENTS_INBOX_OLDER_PAGE`), which holds them beside the
 * feed for the session (`LIVE_READ.INBOX_OLDER`) and answers only the
 * cursor the next page reads past. The paging is scoped to the account
 * signed in, so a session signing in reads from the newest page again, and
 * each client's hook shows it while its list shows All and lets it go
 * otherwise, so All shown anew reads from the newest page.
 */

import type { AgentInboxOlderPageAnswer, AgentInboxOlderPageParams } from "./agent-view.js";
import type { SettledPageAsk } from "./settled-paging.js";

/** The paging's ask of the account's older Inbox items, through `act`, the host's `AGENTS_INBOX_OLDER_PAGE` as the client calls it; the account is the paging's scope alone, since the host reads for the account signed in. */
export function inboxOlderPageAsk(
  act: (page: AgentInboxOlderPageParams) => Promise<AgentInboxOlderPageAnswer>,
): SettledPageAsk<string> {
  return (_accountId, before) => act(before === undefined ? {} : { before });
}
