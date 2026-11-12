/**
 * link-places.ts -- every place a link names, each declared once with the routes its params are read from: a task's comment thread, section, and page, an agent's tab, message, worker, Changes, and review thread, and each routed place's own page.
 *
 * A link place is a place a link names within a task's own place, or an
 * agent's page, which its step does not stand at: a section and a comment
 * thread open the task's Overview, a page opens the side panel on it, and an
 * agent's place opens its tab in the column, or its tab of the side panel,
 * on its task.
 * Its route is where its params are read (`panel-router.tsx`), so a link is
 * opened by matching it on the route tree, whichever door hands it: a press
 * in the window, the desktop's `SHOW_LINK`, or a page loaded at its address.
 * A link to a routed place's own page, a task, a version, Home, the Board, a
 * person, the Inbox or an item of it, an Automations page, or Admin, is
 * matched the same way and opened through the door that place has; a page
 * loaded there stands as that routed place, its link said through
 * load-link, so it lands on nothing here.
 *
 * - Opened in the window, its link, canonical as `linkOf` writes it, is
 *   matched here and opened through the Tasks tab's doors, which navigate
 *   once, straight to the step's address, with what it opens in typed
 *   history state (`window-history.ts`'s `onVisitTask`), so it never
 *   passes through its own route.
 * - Loaded at its own address, or landed on by the browser on an entry
 *   holding no step, the route standing reads it (`link-landings.ts`),
 *   and the step then takes the address in place, as every load settles.
 */

import {
  decodedStep,
  isLinkDestination,
  LINK_DESTINATION,
  type LinkDestination,
  type LinkDestinationKind,
  linkOf,
  type ReadLink,
} from "@repo/features/link-grammar";
import type { HistoryLocation, RegisteredRouter, RouteIds } from "@tanstack/react-router";
import { type PlaceParams, placeParamsOf } from "./place-params.js";

/** A route of the panel's tree, by its id. */
export type PanelRouteId = RouteIds<RegisteredRouter["routeTree"]>;

/** What a link place reads of an address its route matched: its params, its query as its route's schema read it, and its fragment, without its `#`. */
interface LinkAddress {
  readonly params: PlaceParams;
  readonly search: Readonly<Record<string, unknown>>;
  readonly hash: string;
}

/**
 * A link place's declaration: the kind of place it is, the routes it stands
 * at, and the place it reads there, none where the address is another place
 * of the same route's. `ownPlaceRoutes` are routes a routed place stands at
 * as its own page, at which a link opened in the window is matched but a
 * page loaded or landed is not, since there the routed place stands
 * (`routed-places.ts`), and `lands` answers whether a link's place is one a
 * load lands on at its route rather than at such a page.
 */
interface LinkDestinationDeclaration {
  readonly kind: LinkDestinationKind;
  readonly routes: readonly PanelRouteId[];
  readonly ownPlaceRoutes?: readonly PanelRouteId[];
  readonly lands?: (place: LinkDestination) => boolean;
  readonly read: (at: LinkAddress) => LinkDestination | undefined;
  /** What a link to it opens on the Tasks tab where its place is the task the tab shows (`ON_STANDING_TASK`). */
  readonly onStandingTask: OnStandingTask;
}

/**
 * What a link to a place of the task the Tasks tab shows, with nothing
 * standing over its plan, opens there: a tab of the panel beside it, the
 * task's Overview at what it names, or, as any other place, the window
 * going there.
 */
export const ON_STANDING_TASK = {
  BESIDE: "beside",
  OVERVIEW: "overview",
  GO: "go",
} as const;

export type OnStandingTask = (typeof ON_STANDING_TASK)[keyof typeof ON_STANDING_TASK];

/** The thread a task's address names in its query (`?comment=`), as its route's schema reads it. */
function commentOf(search: LinkAddress["search"]): string | undefined {
  const { comment } = search;

  return typeof comment === "string" ? comment : undefined;
}

/** An agent's place as its route's params name it, under the task an address names it under or none, read through the link grammar's own schema; none where they name no such place. */
function agentPlaceOf(params: PlaceParams, fields: Readonly<Record<string, unknown>>) {
  const { workspace, taskId, agentId } = params;

  if (workspace === undefined || agentId === undefined) return undefined;
  const place = { ...fields, ...(taskId !== undefined && { planId: taskId }), agentId };

  return isLinkDestination(place) ? place : undefined;
}

/** The place a route's params spell, read through the link grammar's own schema; none where they spell no place. */
function placeOf(fields: Readonly<Record<string, unknown>>): LinkDestination | undefined {
  return isLinkDestination(fields) ? fields : undefined;
}

/** A task's own place the task's address names with no comment thread in its query and no section in its fragment, as `readLink` reads it. */
function taskPlaceOf({ params, search, hash }: LinkAddress): LinkDestination | undefined {
  if (params.taskId === undefined || commentOf(search) !== undefined || hash !== "") {
    return undefined;
  }

  return placeOf({ kind: LINK_DESTINATION.TASK, planId: params.taskId });
}

/** An Inbox item as its route's params name it: under its task, under its agent, or by its id alone. */
function inboxItemOf({ taskId, agentId, itemId }: PlaceParams): LinkDestination | undefined {
  if (taskId !== undefined)
    return placeOf({ kind: LINK_DESTINATION.INBOX_ITEM, planId: taskId, itemId });

  if (agentId !== undefined) {
    return placeOf({ kind: LINK_DESTINATION.INBOX_ITEM, agentId, itemId });
  }

  return placeOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId });
}

/** An Admin view as its route's params name it: an account's, a workspace's, a day's, a section, or its Overview. */
function adminOf({ userId, workspaceId, day, section }: PlaceParams): LinkDestination | undefined {
  const view =
    userId !== undefined
      ? { userId }
      : workspaceId !== undefined
        ? { workspaceId }
        : day !== undefined
          ? { day }
          : section !== undefined
            ? { section }
            : {};

  return placeOf({ kind: LINK_DESTINATION.ADMIN, ...view });
}

/**
 * Every link place's declaration. A link place moved onto the router is an
 * entry here beside its route; whatever reads it reads this, so `satisfies`
 * refuses an entry missing an answer.
 */
export const LINK_ROUTED_PLACE = {
  COMMENT: {
    kind: LINK_DESTINATION.COMMENT,
    onStandingTask: ON_STANDING_TASK.OVERVIEW,
    routes: ["/places/$workspace/task/$taskId/"],
    read: ({ params, search }) => {
      const threadId = commentOf(search);

      return params.taskId === undefined || threadId === undefined
        ? undefined
        : { kind: LINK_DESTINATION.COMMENT, planId: params.taskId, threadId };
    },
  },
  SECTION: {
    kind: LINK_DESTINATION.SECTION,
    onStandingTask: ON_STANDING_TASK.OVERVIEW,
    routes: ["/places/$workspace/task/$taskId/"],
    // Note that a comment thread named beside a fragment is the comment's link, as `readLink` reads it.
    read: ({ params, search, hash }) => {
      const anchor = decodedStep(hash)?.toLowerCase();

      if (params.taskId === undefined || commentOf(search) !== undefined) return undefined;

      return anchor === undefined || anchor === ""
        ? undefined
        : { kind: LINK_DESTINATION.SECTION, planId: params.taskId, anchor };
    },
  },
  PAGE: {
    kind: LINK_DESTINATION.PAGE,
    onStandingTask: ON_STANDING_TASK.BESIDE,
    routes: [
      "/places/$workspace/task/$taskId/page/$pageId",
      "/places/$workspace/agent/$agentId/page/$pageId",
    ],
    // A page an older link names under the agent that showed it opens on the agent's task, once read.
    read: ({ params }) => {
      const { taskId, agentId, pageId } = params;

      if (pageId === undefined) return undefined;

      if (taskId !== undefined) return { kind: LINK_DESTINATION.PAGE, planId: taskId, pageId };

      return agentId === undefined ? undefined : { kind: LINK_DESTINATION.PAGE, agentId, pageId };
    },
  },
  AGENT: {
    kind: LINK_DESTINATION.AGENT,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: ["/places/$workspace/task/$taskId/agent/$agentId/"],
    // Note that an agent's own address is its page's (`ROUTED_PLACE.AGENT`), which a load there stands as a link said, as it always has.
    ownPlaceRoutes: ["/places/$workspace/agent/$agentId/"],
    lands: (place) => "planId" in place,
    read: ({ params }) => agentPlaceOf(params, { kind: LINK_DESTINATION.AGENT }),
  },
  MESSAGE: {
    kind: LINK_DESTINATION.MESSAGE,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [
      "/places/$workspace/task/$taskId/agent/$agentId/message/$messageId",
      "/places/$workspace/agent/$agentId/message/$messageId",
    ],
    read: ({ params }) =>
      agentPlaceOf(params, { kind: LINK_DESTINATION.MESSAGE, messageId: params.messageId }),
  },
  WORKER: {
    kind: LINK_DESTINATION.WORKER,
    onStandingTask: ON_STANDING_TASK.BESIDE,
    routes: [
      "/places/$workspace/task/$taskId/agent/$agentId/worker/$callId",
      "/places/$workspace/agent/$agentId/worker/$callId",
    ],
    read: ({ params }) =>
      agentPlaceOf(params, { kind: LINK_DESTINATION.WORKER, callId: params.callId }),
  },
  CHANGES: {
    kind: LINK_DESTINATION.CHANGES,
    onStandingTask: ON_STANDING_TASK.BESIDE,
    routes: [
      "/places/$workspace/task/$taskId/agent/$agentId/changes/",
      "/places/$workspace/agent/$agentId/changes/",
    ],
    read: ({ params }) => agentPlaceOf(params, { kind: LINK_DESTINATION.CHANGES }),
  },
  PULL_REQUEST_THREAD: {
    kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
    onStandingTask: ON_STANDING_TASK.BESIDE,
    routes: [
      "/places/$workspace/task/$taskId/agent/$agentId/changes/$view/thread/$threadId",
      "/places/$workspace/agent/$agentId/changes/$view/thread/$threadId",
    ],
    // Note that a view no Pull request tab has is no review thread's, which the grammar's schema refuses.
    read: ({ params }) =>
      agentPlaceOf(params, {
        kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
        threadId: params.threadId,
        view: params.view,
      }),
  },
  // A routed place's own page, which its link opens through the Tasks tab's door for it wherever the window stands, and
  // which a page loaded there stands as its routed place, said through load-link as it always has (`routes` holds none).
  TASK: {
    kind: LINK_DESTINATION.TASK,
    onStandingTask: ON_STANDING_TASK.OVERVIEW,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/task/$taskId/"],
    read: taskPlaceOf,
  },
  VERSION: {
    kind: LINK_DESTINATION.VERSION,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/version-history/$workspace/task/$taskId/version/$revision/"],
    read: ({ params }) =>
      placeOf({
        kind: LINK_DESTINATION.VERSION,
        planId: params.taskId,
        revision: Number(params.revision),
      }),
  },
  HOME: {
    kind: LINK_DESTINATION.HOME,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/"],
    read: () => ({ kind: LINK_DESTINATION.HOME }),
  },
  BOARD: {
    kind: LINK_DESTINATION.BOARD,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/tasks"],
    read: () => ({ kind: LINK_DESTINATION.BOARD }),
  },
  PERSON: {
    kind: LINK_DESTINATION.PERSON,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/person/$userId"],
    read: ({ params }) => placeOf({ kind: LINK_DESTINATION.PERSON, userId: params.userId }),
  },
  INBOX: {
    kind: LINK_DESTINATION.INBOX,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/inbox/", "/places/$workspace/inbox/task/$taskId"],
    read: ({ params }) =>
      placeOf({
        kind: LINK_DESTINATION.INBOX,
        ...(params.taskId !== undefined && { planId: params.taskId }),
      }),
  },
  INBOX_ITEM: {
    kind: LINK_DESTINATION.INBOX_ITEM,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: [
      "/places/$workspace/inbox/$itemId",
      "/places/$workspace/task/$taskId/inbox/$itemId",
      "/places/$workspace/agent/$agentId/inbox/$itemId",
    ],
    read: ({ params }) => inboxItemOf(params),
  },
  AUTOMATIONS: {
    kind: LINK_DESTINATION.AUTOMATIONS,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/automation-pages/automations/"],
    read: () => ({ kind: LINK_DESTINATION.AUTOMATIONS }),
  },
  AUTOMATION: {
    kind: LINK_DESTINATION.AUTOMATION,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/automation-pages/automation/$automationId/"],
    read: ({ params }) =>
      placeOf({ kind: LINK_DESTINATION.AUTOMATION, automationId: params.automationId }),
  },
  AUTOMATION_RUN: {
    kind: LINK_DESTINATION.AUTOMATION_RUN,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: ["/places/$workspace/automation-pages/automation/$automationId/run/$runId"],
    read: ({ params }) =>
      placeOf({
        kind: LINK_DESTINATION.AUTOMATION_RUN,
        automationId: params.automationId,
        runId: params.runId,
      }),
  },
  ADMIN: {
    kind: LINK_DESTINATION.ADMIN,
    onStandingTask: ON_STANDING_TASK.GO,
    routes: [],
    ownPlaceRoutes: [
      "/places/$workspace/admin/",
      "/places/$workspace/admin/$section",
      "/places/$workspace/admin/user/$userId",
      "/places/$workspace/admin/workspace/$workspaceId",
      "/places/$workspace/admin/day/$day",
    ],
    read: ({ params }) => adminOf(params),
  },
} as const satisfies { readonly [Name in string]: LinkDestinationDeclaration };

const DECLARATIONS: readonly LinkDestinationDeclaration[] = Object.values(LINK_ROUTED_PLACE);

/** A link a link place's route reads, by the declaration that read it. */
export interface RoutedLink {
  readonly name: LinkDestinationName;
  readonly declared: (typeof LINK_ROUTED_PLACE)[keyof typeof LINK_ROUTED_PLACE];
  readonly link: ReadLink;
}

/** What the matching reads of the router: its reading of a location, by its route schemas' readers of a query, and its routes, matched with each one's schema reading the query. */
export type LinkRouter = Pick<RegisteredRouter, "matchRoutes" | "parseLocation" | "history">;

/** The tree's own name of a link place's declaration. */
export type LinkDestinationName = keyof typeof LINK_ROUTED_PLACE;

/** Whether a declaration reads the route `id`: one it stands at, or, for a link opened in the window rather than a page landing, a routed place's own page it is matched at. */
function readsAt(declared: LinkDestinationDeclaration, id: string, landing: boolean): boolean {
  const own = landing ? [] : (declared.ownPlaceRoutes ?? []);

  return [...declared.routes, ...own].some((each) => each === id);
}

/**
 * The link place at a location, matched on the route tree as the router
 * reads a location (`parseLocation`, then `matchRoutes`), as a page
 * `landing` there or a link opened in the window; none where it stands at
 * no link place's route. Note that the fragment is read as the location
 * holds it, without its `#`, because the router's reading decodes it and a
 * section's anchor is decoded once, by its declaration.
 */
function routedAt(
  router: LinkRouter,
  location: HistoryLocation,
  landing: boolean,
): RoutedLink | undefined {
  const { pathname, search } = router.parseLocation(location);
  const matches = router.matchRoutes(pathname, search);
  const leaf = matches.at(-1);

  if (leaf === undefined) return undefined;
  const params = placeParamsOf(matches);
  const hash = location.hash.replace(/^#/u, "");
  const at: LinkAddress = { params, search: leaf.search, hash };

  for (const [name, declared] of Object.entries(LINK_ROUTED_PLACE)) {
    if (!readsAt(declared, leaf.routeId, landing)) continue;
    const place = declared.read(at);

    if (place !== undefined && params.workspace !== undefined && isPlaceName(name)) {
      return { name, declared, link: { workspace: params.workspace, place } };
    }
  }

  return undefined;
}

/** Whether a key is a declaration's name. */
function isPlaceName(name: string): name is LinkDestinationName {
  return name in LINK_ROUTED_PLACE;
}

/** The location a URL names, as a history would hold it, its state none of the window's. */
function locationOf(url: URL): HistoryLocation {
  const { pathname, search, hash } = url;

  return { href: `${pathname}${search}${hash}`, pathname, search, hash, state: { __TSR_index: 0 } };
}

/** The workspace the window's router stands in, by its address; none where it names none, as `/app` does. */
function standingWorkspace(router: LinkRouter): string | undefined {
  return placeParamsOf(router.matchRoutes(router.history.location.pathname)).workspace;
}

/**
 * The link place a link names, matched on the route tree at its canonical
 * address (`linkOf`), every older spelling read already; none where it is
 * no link place. A link naming no workspace, as a mention's, is matched
 * under `standingIn`, the workspace the window stands under, and still names
 * none, as its doors read it.
 */
export function routedLinkOf(
  router: LinkRouter,
  link: ReadLink,
  standingIn: string | undefined,
): RoutedLink | undefined {
  const under = link.workspace === "" ? standingIn : link.workspace;

  if (under === undefined || under === "") return undefined;
  const routed = routedAt(router, locationOf(new URL(linkOf(link.place, under))), false);

  return routed === undefined
    ? undefined
    : { ...routed, link: { ...routed.link, workspace: link.workspace } };
}

/**
 * The link place a link pressed in the window names, or a place a part
 * there names as a link to it would, matched on the route tree as
 * `routedLinkOf` matches it, under the workspace the window's router stands
 * in where it names none, since a press is read where it was pressed.
 */
export function routedPressOf(router: LinkRouter, link: ReadLink): RoutedLink | undefined {
  return routedLinkOf(router, link, standingWorkspace(router));
}

/** Whether a link's place is one a link place's route opens, so a page loaded at its address lands there and leaves the open to it. */
export function opensAtItsRoute(link: ReadLink): boolean {
  const declared: LinkDestinationDeclaration | undefined = DECLARATIONS.find(
    (each) => each.kind === link.place.kind,
  );

  if (declared === undefined || declared.routes.length === 0) return false;

  return declared.lands?.(link.place) ?? true;
}

/**
 * What a link to `place` opens on the Tasks tab, by its declaration: where
 * the place is of the task the tab shows (`standingTask`), with nothing over
 * its plan, its declaration's answer, a page an older link names under its
 * agent being no task's; anywhere else the window goes there.
 */
export function onTasksTab(
  place: LinkDestination,
  standingTask: string | undefined,
): OnStandingTask {
  const standing = standingTask !== undefined && "planId" in place && place.planId === standingTask;

  const declared: LinkDestinationDeclaration | undefined = DECLARATIONS.find(
    (each) => each.kind === place.kind,
  );

  return standing && declared !== undefined ? declared.onStandingTask : ON_STANDING_TASK.GO;
}

/** The link place a page loaded at `location`, or landed on by the browser, stands at: one a link place's route opens, never a routed place's own page; none elsewhere. */
export function landedLinkOf(
  router: LinkRouter,
  location: HistoryLocation,
): RoutedLink | undefined {
  return routedAt(router, location, true);
}
