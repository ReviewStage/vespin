import { it } from "@effect/vitest";
import { hostConnectPath } from "@repo/features/host-wire";
import {
  ADMIN_LINK_SECTION,
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  PULL_REQUEST_THREAD_VIEW,
} from "@repo/features/link-grammar";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, type RouteIds } from "@tanstack/react-router";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createPanelRouter, type PanelRouter } from "./panel-router.js";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { stateWith } from "./testing/app-state.js";
import { readAppState } from "./testing/copy-feedback.js";

type PanelRouteId = RouteIds<PanelRouter["routeTree"]>;

/** Where an address must land: the route it names, the ids that route reads from it, and its search where it has one. */
interface Landing {
  readonly routeId: PanelRouteId;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly search?: Record<string, string>;
}

const W = "stage";

/** Every address `linkOf` writes, one row per spelling of each place kind, beside the route a hand reading of its path names. */
const LINKS: readonly (readonly [LinkDestination, Landing])[] = [
  [{ kind: LINK_DESTINATION.HOME }, { routeId: "/places/$workspace/", params: { workspace: W } }],
  [
    { kind: LINK_DESTINATION.BOARD },
    { routeId: "/places/$workspace/tasks", params: { workspace: W } },
  ],
  [
    { kind: LINK_DESTINATION.TASK, planId: "42" },
    { routeId: "/places/$workspace/task/$taskId/", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_DESTINATION.SECTION, planId: "42", anchor: "rollout" },
    { routeId: "/places/$workspace/task/$taskId/", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_DESTINATION.COMMENT, planId: "42", threadId: "1234" },
    {
      routeId: "/places/$workspace/task/$taskId/",
      params: { workspace: W, taskId: "42" },
      search: { comment: "1234" },
    },
  ],
  [
    { kind: LINK_DESTINATION.VERSION, planId: "42", revision: 3 },
    {
      routeId: "/version-history/$workspace/task/$taskId/version/$revision/",
      params: { workspace: W, taskId: "42", revision: "3" },
    },
  ],
  [
    { kind: LINK_DESTINATION.PAGE, planId: "42", pageId: "p1" },
    {
      routeId: "/places/$workspace/task/$taskId/page/$pageId",
      params: { workspace: W, taskId: "42", pageId: "p1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.PAGE, agentId: "a1", pageId: "p1" },
    {
      routeId: "/places/$workspace/agent/$agentId/page/$pageId",
      params: { workspace: W, agentId: "a1", pageId: "p1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.AGENT, agentId: "a1" },
    { routeId: "/places/$workspace/agent/$agentId/", params: { workspace: W, agentId: "a1" } },
  ],
  [
    { kind: LINK_DESTINATION.AGENT, planId: "42", agentId: "a1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/",
      params: { workspace: W, taskId: "42", agentId: "a1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.WORKER, agentId: "a1", callId: "c1" },
    {
      routeId: "/places/$workspace/agent/$agentId/worker/$callId",
      params: { workspace: W, agentId: "a1", callId: "c1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.WORKER, planId: "42", agentId: "a1", callId: "c1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/worker/$callId",
      params: { workspace: W, taskId: "42", agentId: "a1", callId: "c1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.CHANGES, agentId: "a1" },
    {
      routeId: "/places/$workspace/agent/$agentId/changes/",
      params: { workspace: W, agentId: "a1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.CHANGES, planId: "42", agentId: "a1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/changes/",
      params: { workspace: W, taskId: "42", agentId: "a1" },
    },
  ],
  [
    {
      kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
      agentId: "a1",
      threadId: "PRRT_kw1",
      view: PULL_REQUEST_THREAD_VIEW.FILES,
    },
    {
      routeId: "/places/$workspace/agent/$agentId/changes/$view/thread/$threadId",
      params: { workspace: W, agentId: "a1", view: "files", threadId: "PRRT_kw1" },
    },
  ],
  [
    {
      kind: LINK_DESTINATION.PULL_REQUEST_THREAD,
      planId: "42",
      agentId: "a1",
      threadId: "PRRT_kw1",
      view: PULL_REQUEST_THREAD_VIEW.CONVERSATION,
    },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/changes/$view/thread/$threadId",
      params: {
        workspace: W,
        taskId: "42",
        agentId: "a1",
        view: "conversation",
        threadId: "PRRT_kw1",
      },
    },
  ],
  [
    { kind: LINK_DESTINATION.MESSAGE, agentId: "a1", messageId: "m1" },
    {
      routeId: "/places/$workspace/agent/$agentId/message/$messageId",
      params: { workspace: W, agentId: "a1", messageId: "m1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.MESSAGE, planId: "42", agentId: "a1", messageId: "m1" },
    {
      routeId: "/places/$workspace/task/$taskId/agent/$agentId/message/$messageId",
      params: { workspace: W, taskId: "42", agentId: "a1", messageId: "m1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.INBOX },
    { routeId: "/places/$workspace/inbox/", params: { workspace: W } },
  ],
  [
    { kind: LINK_DESTINATION.INBOX, planId: "42" },
    { routeId: "/places/$workspace/inbox/task/$taskId", params: { workspace: W, taskId: "42" } },
  ],
  [
    { kind: LINK_DESTINATION.INBOX_ITEM, itemId: "i1" },
    { routeId: "/places/$workspace/inbox/$itemId", params: { workspace: W, itemId: "i1" } },
  ],
  [
    { kind: LINK_DESTINATION.INBOX_ITEM, planId: "42", itemId: "i1" },
    {
      routeId: "/places/$workspace/task/$taskId/inbox/$itemId",
      params: { workspace: W, taskId: "42", itemId: "i1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.INBOX_ITEM, agentId: "a1", itemId: "i1" },
    {
      routeId: "/places/$workspace/agent/$agentId/inbox/$itemId",
      params: { workspace: W, agentId: "a1", itemId: "i1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.AUTOMATIONS },
    { routeId: "/places/$workspace/automation-pages/automations/", params: { workspace: W } },
  ],
  [
    { kind: LINK_DESTINATION.AUTOMATION, automationId: "au1" },
    {
      routeId: "/places/$workspace/automation-pages/automation/$automationId/",
      params: { workspace: W, automationId: "au1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.AUTOMATION_RUN, automationId: "au1", runId: "r1" },
    {
      routeId: "/places/$workspace/automation-pages/automation/$automationId/run/$runId",
      params: { workspace: W, automationId: "au1", runId: "r1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.PERSON, userId: "u1" },
    { routeId: "/places/$workspace/person/$userId", params: { workspace: W, userId: "u1" } },
  ],
  [
    { kind: LINK_DESTINATION.SETTINGS },
    { routeId: "/$workspace/settings/", params: { workspace: W } },
  ],
  [
    { kind: LINK_DESTINATION.SETTINGS, page: "keyboard-shortcuts" },
    {
      routeId: "/$workspace/settings/$page",
      params: { workspace: W, page: "keyboard-shortcuts" },
    },
  ],
  [
    { kind: LINK_DESTINATION.ADMIN },
    { routeId: "/places/$workspace/admin/", params: { workspace: W } },
  ],
  [
    { kind: LINK_DESTINATION.ADMIN, section: ADMIN_LINK_SECTION.COST },
    { routeId: "/places/$workspace/admin/$section", params: { workspace: W, section: "cost" } },
  ],
  [
    { kind: LINK_DESTINATION.ADMIN, userId: "u1" },
    { routeId: "/places/$workspace/admin/user/$userId", params: { workspace: W, userId: "u1" } },
  ],
  [
    { kind: LINK_DESTINATION.ADMIN, workspaceId: "ws1" },
    {
      routeId: "/places/$workspace/admin/workspace/$workspaceId",
      params: { workspace: W, workspaceId: "ws1" },
    },
  ],
  [
    { kind: LINK_DESTINATION.ADMIN, day: "2026-11-05" },
    { routeId: "/places/$workspace/admin/day/$day", params: { workspace: W, day: "2026-11-05" } },
  ],
];

/** The deepest route the router matches `address` to, read as a window's router reads the address it opens at. */
function landingOf(address: string): Landing {
  const router = createPanelRouter(
    createMemoryHistory({ initialEntries: [address] }),
    new QueryClient(),
  );

  const { pathname, search } = router.latestLocation;
  const leaf = router.matchRoutes(pathname, search).at(-1);

  if (leaf === undefined) throw new Error(`No route matched ${address}`);

  return { routeId: leaf.routeId, params: leaf.params, search: leaf.search };
}

/** A link's address as a window holds it: its path, query, and fragment. */
function addressOf(link: string): string {
  const url = new URL(link);

  return `${url.pathname}${url.search}${url.hash}`;
}

describe("the panel's route tree", () => {
  it.each(LINKS)("names the address linkOf writes for %o", (place, landing) => {
    expect(landingOf(addressOf(linkOf(place, W)))).toEqual({ search: {}, ...landing });
  });

  it("names a pairing's address and the panel's own", () => {
    expect(landingOf(hostConnectPath("ABCDEFGH"))).toEqual({
      routeId: "/places/connect/$code",
      params: { code: "ABCD-EFGH" },
      search: {},
    });
    expect(landingOf("/app")).toEqual({ routeId: "/places/app", params: {}, search: {} });
  });

  it("names Settings under the panel's own address, as it stands while the window lists no workspace", () => {
    expect(landingOf("/app/settings")).toEqual({
      routeId: "/app/settings/",
      params: {},
      search: {},
    });
    expect(landingOf("/app/settings/appearance")).toEqual({
      routeId: "/app/settings/$page",
      params: { page: "appearance" },
      search: {},
    });
  });

  it("names the Automations pages no link names, the Runs tab, a new automation's page, and an automation's runs alone", () => {
    expect(landingOf(`/${W}/automations/runs`).routeId).toBe(
      "/places/$workspace/automation-pages/automations/runs",
    );
    expect(landingOf(`/${W}/automations/new`).routeId).toBe(
      "/places/$workspace/automation-pages/automations/new",
    );
    expect(landingOf(`/${W}/automation/au1/runs`)).toEqual({
      routeId: "/places/$workspace/automation-pages/automation/$automationId/runs",
      params: { workspace: W, automationId: "au1" },
      search: {},
    });
  });

  it("names an Inbox item chosen in a list narrowed to a task by its address, the task kept in its query", () => {
    expect(landingOf(`/${W}/inbox/i1?task=42`)).toEqual({
      routeId: "/places/$workspace/inbox/$itemId",
      params: { workspace: W, itemId: "i1" },
      search: { task: "42" },
    });
  });

  it("names the version history's places no link names, its list, a version's sections, and one of them", () => {
    expect(landingOf(`/${W}/task/42/versions`).routeId).toBe(
      "/version-history/$workspace/task/$taskId/versions",
    );
    expect(landingOf(`/${W}/task/42/version/3/sections`).routeId).toBe(
      "/version-history/$workspace/task/$taskId/version/$revision/sections",
    );
    expect(landingOf(`/${W}/task/42/version/3/section/Rollout%20plan`)).toEqual({
      routeId: "/version-history/$workspace/task/$taskId/version/$revision/section/$heading",
      params: { workspace: W, taskId: "42", revision: "3", heading: "Rollout plan" },
      search: {},
    });
  });

  it("covers every place kind", () => {
    const kinds = new Set(LINKS.map(([place]) => place.kind));
    expect([...kinds].sort()).toEqual(Object.values(LINK_DESTINATION).sort());
  });

  it.effect(
    "is made before the window's bridge stands without spoiling the window's first read",
    () =>
      Effect.gen(function* () {
        // The desktop's entry makes its router as the module loads, before its root installs the bridge (`window-root.tsx`).
        landingOf("/app");
        const state = stateWith({}, {});
        fakeAppBridge({
          requestAppState: () => Promise.resolve(state),
          onAppState: () => () => undefined,
        });

        expect(yield* Effect.promise(readAppState)).toEqual(state);
      }),
  );
});
