/**
 * inbox-item-links.ts -- what an address pressed on an Inbox item opens beside it, a place in the app by the declaration its route matched.
 *
 * The panel beside an item stands for the task that holds it, so a place in
 * the app opens there where that panel draws it, and
 * is otherwise the window's (`places/pressed-address.ts` states the choices
 * every surface answers by).
 */

import { LINK_PLACE, type LinkPlace, taskNumberOf } from "@repo/features/link-grammar";
import type { PagePlace } from "@repo/features/page-wire";
import type { LinkPlaceName } from "./places/link-places.js";
import {
  ADDRESS,
  type Address,
  beside,
  go,
  type HERE,
  NOTHING,
  type PlaceAddress,
  type Route,
  THING,
} from "./places/pressed-address.js";
import { type Holding, ofRepository, pullRequestBeside } from "./places/pull-request-beside.js";

/** An Inbox item a press comes from, and the task that holds it, which the panel beside it stands for. */
export type InboxItemHere = {
  readonly kind: typeof HERE.INBOX_ITEM;
  /** The task that holds the item; none before an item is chosen. */
  readonly taskId: string | undefined;
} & Holding;

/** What a place of the app pressed on an Inbox item opens, read as its declaration reads it, under the link's workspace. */
type ItemPlaceBeside = (place: LinkPlace, workspace: string, here: InboxItemHere) => Route;

/** Whether an agent a link names is one of what holds the item: by the task an older link names it under, else by the agent itself, among the agents given. */
function holdsAgent(
  at: { readonly planId?: string | undefined; readonly agentId: string },
  taskId: string | undefined,
  agentIds: readonly string[] | undefined,
): boolean {
  return at.planId === undefined ? agentIds?.includes(at.agentId) === true : at.planId === taskId;
}

/**
 * Each place of the app an Inbox item opens beside it, by the name of the
 * declaration its route matched (`LINK_ROUTED_PLACE`); every other place is
 * the window's.
 */
const ITEM_BESIDE: { readonly [Name in LinkPlaceName]?: ItemPlaceBeside } = {
  PAGE: (at, _workspace, here) => {
    // A page under a task named by a number no one found the task for is the window's, which finds it on the service.
    if (at.kind !== LINK_PLACE.PAGE || taskNumberOf(at) !== undefined) return NOTHING;
    // A page of the item's own task opens beside the item; another's opens there too, read on its own place,
    // as an older link's page an agent showed on itself is, so the reader stays on the item.
    const own = "planId" in at && at.planId === here.taskId;
    const place: PagePlace = "planId" in at ? { taskId: at.planId } : { agentId: at.agentId };
    return beside(
      own
        ? { kind: THING.PAGE, pageId: at.pageId }
        : { kind: THING.PAGE, pageId: at.pageId, place },
    );
  },
  // An archived agent's Changes still opens beside the item, as its older link under the task did.
  CHANGES: (at, _workspace, here) =>
    at.kind === LINK_PLACE.CHANGES && holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
      ? beside({ kind: THING.CHANGES, agentId: at.agentId })
      : NOTHING,
  // A review thread of an agent's pull request opens beside the item as its Changes does.
  PULL_REQUEST_THREAD: (at, _workspace, here) =>
    at.kind === LINK_PLACE.PULL_REQUEST_THREAD &&
    holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
      ? beside({ kind: THING.THREAD, agentId: at.agentId, threadId: at.threadId, view: at.view })
      : NOTHING,
  // An Inbox item is chosen in the Inbox the item stands in: one under its task, or one under an agent the item's task
  // holds; any other the window finds by its agent, or by the item alone.
  INBOX_ITEM: (at, _workspace, here) => {
    if (at.kind !== LINK_PLACE.INBOX_ITEM) return NOTHING;
    const { itemId } = at;
    if ("planId" in at) {
      return beside({ kind: THING.INBOX_ITEM, itemId, taskId: at.planId, agentId: undefined });
    }
    // An item named by its id alone is the window's to find, by asking the service whose it is.
    if (!("agentId" in at)) return NOTHING;
    const { agentId } = at;
    return here.taskId !== undefined && (here.heldIds ?? here.agentIds)?.includes(agentId) === true
      ? beside({ kind: THING.INBOX_ITEM, itemId, taskId: here.taskId, agentId })
      : NOTHING;
  },
  // An agent of the item's own task, archived or not, opens in its own tab on the task, never in the panel
  // beside the item, so a transcript reads in one place; another task's is the window's to open.
  AGENT: (at, workspace, here) => {
    if (at.kind !== LINK_PLACE.AGENT) return NOTHING;
    if (here.taskId === undefined || !holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)) {
      return NOTHING;
    }
    return go({
      workspace,
      place: { kind: LINK_PLACE.AGENT, planId: here.taskId, agentId: at.agentId },
    });
  },
};

/** A file pressed on an Inbox item, beside it: one of the item's repository, which the panel reads through what holds the item, and one of another repository, read through the item's workspace; an older link's, naming none, only where the item holds a repository. */
function fileBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.FILE }>,
  here: Holding,
): Route {
  const { path, lines, repository } = address;
  if (repository === undefined) {
    return here.repository !== null && here.repository !== undefined
      ? beside({ kind: THING.FILE, path, lines })
      : NOTHING;
  }
  return ofRepository(repository, here.repository)
    ? beside({ kind: THING.FILE, path, lines })
    : beside({ kind: THING.FILE, path, lines, repository });
}

/** A place in the app pressed on an Inbox item, by the declaration its route matched; one matching none is the window's. */
function itemPlace(address: PlaceAddress, here: InboxItemHere): Route {
  const { routed } = address;
  if (routed === undefined) return NOTHING;
  const { place, workspace } = routed.link;
  return ITEM_BESIDE[routed.name]?.(place, workspace, here) ?? NOTHING;
}

/** What an address pressed on an Inbox item opens: nothing before an item is chosen, since its panel stands for what holds the item. */
export function besideItem(address: Address, here: InboxItemHere): Route {
  if (here.taskId === undefined) return NOTHING;
  switch (address.kind) {
    case ADDRESS.PLACE:
      return itemPlace(address, here);
    case ADDRESS.PULL_REQUEST:
      return pullRequestBeside(address, here);
    // A file of the item's repository, which the panel reads through the task it stands for;
    // a file of another repository opens there too, read through the item's workspace.
    case ADDRESS.FILE:
      return fileBeside(address, here);
    case ADDRESS.WEB:
      return NOTHING;
  }
}
