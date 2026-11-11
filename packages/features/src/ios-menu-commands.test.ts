import { describe, expect, it } from "vitest";
import { MENU_SUBJECT, type MenuFocus, menuFocusOf } from "./ios-menu-commands.js";

/**
 * ios-menu-commands.test.ts -- what the iPad menu bar acts on is read off the
 * route expo-router hands the app: a thread, a task, an agent, or nothing.
 */

const nothing: MenuFocus = { kind: MENU_SUBJECT.NONE };

describe("menuFocusOf", () => {
  it.each<[string, string | undefined, MenuFocus]>([
    ["/inbox/thread-1", undefined, { kind: MENU_SUBJECT.THREAD, id: "thread-1" }],
    ["/inbox", "thread-2", { kind: MENU_SUBJECT.THREAD, id: "thread-2" }],
    ["/inbox", "", nothing],
    ["/tasks/42", undefined, { kind: MENU_SUBJECT.TASK, id: "42" }],
    ["/tasks", "task-1", { kind: MENU_SUBJECT.TASK, id: "task-1" }],
    ["/tasks/agent/agent-1/pull/7", undefined, { kind: MENU_SUBJECT.AGENT, id: "agent-1" }],
    ["/tasks/page/page-1", "task-1", nothing],
    ["/search", undefined, nothing],
    // expo-router hands a decoded path, so an id holding `%` is read as itself, never decoded again.
    ["/tasks/100%", undefined, { kind: MENU_SUBJECT.TASK, id: "100%" }],
  ])("reads %s with selected %s as its focus", (pathname, selected, focus) => {
    expect(menuFocusOf(pathname, selected)).toEqual(focus);
  });
});
