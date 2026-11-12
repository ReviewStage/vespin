import { describe, expect, it } from "vitest";
import { IOS_APP_LINK_COMPONENTS, iosAppRouteOf, iosAppRouteOfAddress } from "./ios-app-links.js";
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
    ["/acme/task/42", "/tasks/42"],
    ["/acme/task/task-1/page/page-1", undefined],
    ["/acme/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/task/task-1/agent/agent-1", "/tasks/agent/agent-1"],
    ["/acme/agent/agent-1/page/page-1", undefined],
    ["/acme/task/task-1/agent/agent-1/changes", undefined],
    ["/acme/settings", undefined],
  ])("%s opens in the app at %s, and only then", (path, route) => {
    const read = readLink(`https://vespin.dev${path}`);
    expect(read === undefined ? undefined : iosAppRouteOf(read.place)).toBe(route);
    expect(claimed(path)).toBe(route !== undefined);
  });
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
    expect(iosAppRouteOfAddress("https://vespin.dev/acme/task/42", opened)).toBe("/tasks/42");
  });
});
