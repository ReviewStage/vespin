import { describe, expect, it } from "vitest";
import {
  MENU_OWN_PAGE,
  MENU_SUBJECT,
  type MenuFocus,
  type MenuOwnPage,
  type MenuRouteParams,
  menuFocusOf,
  menuOwnPageOf,
} from "./ios-menu-commands.js";

/**
 * ios-menu-commands.test.ts -- what the iPad menu bar acts on is read off the
 * route expo-router hands the app: a thread, a task, an agent, or nothing,
 * and the page a pushed pull request or page opens in the browser as itself.
 */

const nothing: MenuFocus = { kind: MENU_SUBJECT.NONE };

describe("menuFocusOf", () => {
  it.each<[string, MenuRouteParams, MenuFocus]>([
    ["/inbox/thread-1", {}, { kind: MENU_SUBJECT.THREAD, id: "thread-1" }],
    ["/inbox", { selected: "thread-2" }, { kind: MENU_SUBJECT.THREAD, id: "thread-2" }],
    ["/inbox", { selected: "" }, nothing],
    ["/tasks/42", {}, { kind: MENU_SUBJECT.TASK, id: "42" }],
    ["/tasks", { selected: "task-1" }, { kind: MENU_SUBJECT.TASK, id: "task-1" }],
    ["/tasks/agent/agent-1/pull/7", {}, { kind: MENU_SUBJECT.AGENT, id: "agent-1" }],
    ["/tasks/agent/agent-1/page", { page: "page-1" }, { kind: MENU_SUBJECT.AGENT, id: "agent-1" }],
    // A page pushed over a task acts on that task, never on the page's own word.
    ["/tasks/page/page-1", { task: "task-1" }, { kind: MENU_SUBJECT.TASK, id: "task-1" }],
    ["/tasks/history/task-1", {}, { kind: MENU_SUBJECT.TASK, id: "task-1" }],
    ["/tasks/version/task-1", {}, { kind: MENU_SUBJECT.TASK, id: "task-1" }],
    [
      "/tasks/pull/ws/acme/relay/42",
      { agent: "agent-1" },
      { kind: MENU_SUBJECT.AGENT, id: "agent-1" },
    ],
    ["/tasks/pull/ws/acme/relay/42", {}, nothing],
    ["/search", {}, nothing],
    // expo-router hands a decoded path, so an id holding `%` is read as itself, never decoded again.
    ["/tasks/100%", {}, { kind: MENU_SUBJECT.TASK, id: "100%" }],
  ])("reads %s with %o as its focus", (pathname, params, focus) => {
    expect(menuFocusOf(pathname, params)).toEqual(focus);
  });
});

describe("menuOwnPageOf", () => {
  it.each<[string, MenuRouteParams, MenuOwnPage | undefined]>([
    [
      "/tasks/pull/ws/acme/relay/42",
      { agent: "agent-1" },
      { kind: MENU_OWN_PAGE.PULL_REQUEST, repository: "acme/relay", number: 42 },
    ],
    [
      "/tasks/page/page-1",
      { task: "task-1", workspace: "ws" },
      { kind: MENU_OWN_PAGE.TASK_PAGE, taskId: "task-1", pageId: "page-1", workspaceId: "ws" },
    ],
    [
      "/tasks/agent/agent-1/page",
      { page: "page-1" },
      { kind: MENU_OWN_PAGE.AGENT_PAGE, pageId: "page-1" },
    ],
    ["/tasks/agent/agent-1", {}, undefined],
  ])("reads %s with %o as the page it opens", (pathname, params, page) => {
    expect(menuOwnPageOf(pathname, params)).toEqual(page);
  });
});
