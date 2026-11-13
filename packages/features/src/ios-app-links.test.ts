import { describe, expect, it } from "vitest";
import {
  IOS_APP_LINK_COMPONENTS,
  iosAppRouteOf,
  iosAppRouteOfAddress,
  iosHostConnectCode,
  iosRouteHidesTabs,
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
    ["/acme/task/task-1/page/page-1", undefined],
    ["/acme/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/task/task-1/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/agent/agent-1/page/page-1", undefined],
    ["/acme/task/task-1/agent/agent-1/changes", undefined],
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

// Note that the regression these catch is a pull request a chip names leaving the app for GitHub
// though the app draws it, or its diff, which the app does not draw, opening on the app's screen.
describe("a pull request's address", () => {
  const opened = [
    { agentId: "agent-1", pullRequest: { url: "https://github.com/acme/relay/pull/42" } },
  ];

  it.each([
    ["https://github.com/acme/relay/pull/42", "/tasks/agent/agent-1/pull/42"],
    ["https://github.com/Acme/Relay/pull/42/", "/tasks/agent/agent-1/pull/42"],
    ["https://github.com/acme/relay/pull/42/files", undefined],
    ["https://github.com/acme/relay/pull/43", undefined],
    ["https://github.com/acme/other/pull/42", undefined],
  ])("%s opens in the app at %s", (address, route) => {
    expect(iosAppRouteOfAddress(address, opened)).toBe(route);
  });

  it("names a vespin.dev place by the route its link opens", () => {
    expect(iosAppRouteOfAddress("https://vespin.dev/acme/task/42", opened)).toBe(
      "/tasks/42?workspace=acme",
    );
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
    ["/tasks/agent/agent-1/page", false],
    ["/tasks/page/page-1", false],
    ["/search", false],
  ])("on %s hidden is %s", (pathname, hidden) => {
    expect(iosRouteHidesTabs(pathname)).toBe(hidden);
  });
});
