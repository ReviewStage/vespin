import { describe, expect, it } from "vitest";
import {
  IOS_APP_LINK_COMPONENTS,
  iosAgentPullRequestOf,
  iosAppRouteOf,
  iosAppRouteOfAddress,
  iosHostConnectCode,
  iosRouteAgent,
  iosRouteHidesTabs,
  iosRouteOnTab,
} from "./ios-app-links.js";
import { readLink } from "./link-grammar.js";

/**
 * ios-app-links.test.ts -- the links the association hands the app are the
 * links the app routes, read through Apple's own matching: components in
 * order, the first match deciding, each `*` any run of characters and each
 * `?` any one.
 */

/** Whether Apple would open `path` in the app, as its components decide. */
function claimed(path: string): boolean {
  const match = IOS_APP_LINK_COMPONENTS.find((component) => {
    const pattern = component["/"]
      .split("*")
      .map((literal) => literal.replace(/[.+^$()[\]{}|\\]/gu, "\\$&").replaceAll("?", "."))
      .join(".*");

    return new RegExp(`^${pattern}$`, "u").test(path);
  });

  return match !== undefined && match.exclude !== true;
}

// Note that the regression these catch is the two lists drifting: a link claimed that the app
// cannot route lands nowhere, and one routed but not claimed never arrives by a tap.
describe("a vespin.dev link", () => {
  it.each([
    ["/acme/inbox", "/inbox"],
    ["/acme/inbox/item-1", "/inbox/item-1"],
    ["/acme/task/task-1/inbox/item-1", "/inbox/item-1"],
    ["/acme/tasks", "/tasks"],
    ["/acme/task/42", "/tasks/42?workspace=acme"],
    ["/acme/task/task-1/page/page-1", "/tasks/page/page-1?task=task-1"],
    ["/acme/task/42/page/page-1", "/tasks/page/page-1?task=42&workspace=acme"],
    ["/acme/task/task-1/version/3", undefined],
    ["/acme/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/task/task-1/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/agent/agent-1/page/page-1", "/tasks/agent/agent-1/page?page=page-1"],
    ["/acme/agent/agent-1/message/message-1", "/tasks/agent/agent-1?message=message-1"],
    ["/acme/task/task-1/agent/agent-1/changes", undefined],
    ["/acme/person/user-1", "/tasks/person/user-1"],
    ["/acme/person/user-1#machine-device-1", "/tasks/person/user-1"],
    ["/acme/settings", undefined],
  ])("%s opens in the app at %s, and only then", (path, route) => {
    const read = readLink(`https://vespin.dev${path}`);
    expect(read === undefined ? undefined : iosAppRouteOf(read.place, read.workspace)).toBe(route);
    expect(claimed(path)).toBe(route !== undefined);
  });
});

// Note that the regression this catches is a pairing's link left to Safari, or one the app is handed and cannot read.
it("a machine's pairing link opens in the app with its code", () => {
  expect(claimed("/connect/BCDF-GHJK")).toBe(true);
  expect(iosHostConnectCode("https://vespin.dev/connect/bcdf-ghjk")).toBe("BCDFGHJK");
  expect(iosHostConnectCode("https://vespin.dev/acme/task/42")).toBeUndefined();
});

// Note that the regression these catch is a pull request a link names opening another pull request, as one agent's
// two did, or leaving the app for GitHub though it stands in a workspace, or its diff, which the app does not draw,
// opening on the app's screen.
describe("a pull request's address", () => {
  it.each([
    ["https://github.com/acme/relay/pull/42", "acme-ws", "/tasks/pull/acme-ws/acme/relay/42"],
    ["https://github.com/Acme/Relay/pull/43/", "acme-ws", "/tasks/pull/acme-ws/Acme/Relay/43"],
    ["https://github.com/acme/relay/pull/42/files", "acme-ws", undefined],
    ["https://github.com/acme/relay/pull/42", undefined, undefined],
  ])("%s in %s opens in the app at %s", (address, workspaceId, route) => {
    expect(iosAppRouteOfAddress(address, workspaceId)).toBe(route);
  });

  it("names a vespin.dev place by the route its link opens", () => {
    expect(iosAppRouteOfAddress("https://vespin.dev/acme/task/42", undefined)).toBe(
      "/tasks/42?workspace=acme",
    );
  });
});

// Note that the regression this catches is an older link to an agent's pull request opening another pull
// request than the one it names, as the agent's two pull requests from two branches once did.
describe("an agent's pull request by its number", () => {
  const agent = { workspaceId: "acme-ws", repository: "acme/relay" };
  const listed = { number: 42, url: "https://github.com/Acme/Other/pull/42" };

  it.each([
    ["its listed pull request", listed, 42, { repository: "Acme/Other", number: 42 }],
    ["another of its numbers", listed, 41, { repository: "acme/relay", number: 41 }],
    ["one while none is listed", undefined, 41, { repository: "acme/relay", number: 41 }],
  ])("opens %s by its repository", (_name, line, number, opened) => {
    expect(iosAgentPullRequestOf(agent, line, number)).toEqual({
      workspaceId: "acme-ws",
      ...opened,
    });
  });

  it("names none while the agent is read", () => {
    expect(iosAgentPullRequestOf(undefined, listed, 42)).toBeUndefined();
  });
});

// Note that the regression this catches is a route renamed under a conversation, which would bring the tab bar back over its composer.
describe("the tab bar on a route", () => {
  it.each([
    ["/inbox", false],
    ["/inbox/thread-1", true],
    ["/tasks", false],
    ["/tasks/task-1", false],
    ["/tasks/agent/agent-1", true],
    ["/tasks/agent/agent-1/pull/42", true],
    ["/tasks/agent/agent-1/thread/message-1", true],
    ["/tasks/pull/acme-ws/acme/relay/42", true],
    ["/tasks/agent/agent-1/page", false],
    ["/tasks/page/page-1", false],
    ["/tasks/comments/thread-1", true],
    ["/tasks/person/user-1", false],
    ["/search", false],
  ])("on %s hidden is %s", (pathname, hidden) => {
    expect(iosRouteHidesTabs(pathname)).toBe(hidden);
  });
});

// Note that the regression this catches is the call bar standing over its own agent's page, whose composer already holds the call's presses, or missing from a page under it, which has no composer.
describe("the agent whose page a route is", () => {
  it.each([
    ["/tasks/agent/agent-1", "agent-1"],
    ["/tasks/agent/agent-1/pull/42", undefined],
    ["/tasks/agent", undefined],
    ["/tasks/task-1", undefined],
    ["/inbox/thread-1", undefined],
  ])("on %s is %s", (pathname, agent) => {
    expect(iosRouteAgent(pathname)).toBe(agent);
  });
});

// Note that the regression this catches is a route named on a tab whose stack does not mount it, such as a tab's root on another tab, which would open nothing.
describe("a route opened from a tab", () => {
  it.each([
    ["/tasks/task-1", "inbox", "/(inbox)/tasks/task-1"],
    ["/tasks/42?workspace=acme", "search", "/(search)/tasks/42?workspace=acme"],
    ["/tasks/agent/agent-1/pull/7", "inbox", "/(inbox)/tasks/agent/agent-1/pull/7"],
    ["/inbox/item-1", "tasks", "/(tasks)/inbox/item-1"],
    ["/tasks/task-1", undefined, "/(tasks)/tasks/task-1"],
    ["/inbox", "tasks", "/(inbox)/inbox"],
    ["/automations/automation-1", "inbox", "/(inbox)/automations/automation-1"],
    ["/automations", "tasks", "/(automations)/automations"],
    ["/start-task", "inbox", "/start-task"],
  ] as const)("%s from %s opens at %s", (route, standing, opened) => {
    expect(iosRouteOnTab(route, standing)).toBe(opened);
  });
});
