import { describe, expect, it } from "vitest";
import { inboxPushOfRequest, inboxPushResponseOf } from "./inbox-push-wire.js";

/**
 * Where a tap or an action on a notification takes the app, and what it
 * sends there, read from the request as `expo-notifications` hands it over:
 * a push's payload written as the service sends it, Apple's `aps` and all,
 * and the share sheet's local notification. Synthetic ids throughout.
 */

const APS = { alert: { title: "Which queue?" }, "mutable-content": 1, badge: 2 };

const DECIDE = {
  aps: { ...APS, category: "inbox-decide" },
  kind: "ask",
  itemId: "item-1",
  messageId: "message-1",
  agentId: "agent-1",
  taskId: "task-1",
  revision: 3,
  ask: "decide",
  options: ["Postgres outbox", "Redis"],
  recommended: ["Postgres outbox"],
};

const POST = {
  aps: { ...APS, category: "inbox-reply" },
  kind: "post",
  itemId: "item-2",
  messageId: "message-2",
  agentId: "agent-2",
  revision: 1,
};

const RUN_FAILED = {
  aps: { ...APS, category: "agent-run-failed" },
  kind: "run-failed",
  agentId: "agent-3",
  taskId: "task-3",
  turnId: "turn-3",
};

/** A delivered push's request: its whole payload on the trigger, and its content's data read from the payload's absent `body`. */
function pushed<Payload>(payload: Payload) {
  return { content: { data: null }, trigger: { type: "push", payload } };
}

/** A local notification's request, posted with no trigger, its payload as its content's data. */
function posted<Data>(data: Data) {
  return { content: { data }, trigger: { class: "UNNotificationTrigger", type: "unknown" } };
}

const TAP = { actionId: "expo.modules.notifications.actions.DEFAULT" };

describe("inboxPushResponseOf", () => {
  it.each([
    {
      name: "a tap on an ask opens its thread",
      request: pushed(DECIDE),
      action: TAP,
      response: { route: "/inbox/item-1" },
    },
    {
      name: "a decide's button sends the option at its place",
      request: pushed(DECIDE),
      action: { actionId: "1" },
      response: {
        route: "/inbox/item-1",
        press: { kind: "choose", itemId: "item-1", messageId: "message-1", option: "Redis" },
      },
    },
    {
      name: "a button past the options only opens the thread",
      request: pushed(DECIDE),
      action: { actionId: "2" },
      response: { route: "/inbox/item-1" },
    },
    {
      name: "a reply typed in place sends its words, trimmed",
      request: pushed(POST),
      action: { actionId: "reply", text: "  Ship it.\n" },
      response: {
        route: "/inbox/item-2",
        press: { kind: "reply", itemId: "item-2", text: "Ship it." },
      },
    },
    {
      name: "a reply of nothing only opens the thread",
      request: pushed(POST),
      action: { actionId: "reply", text: "   " },
      response: { route: "/inbox/item-2" },
    },
    {
      name: "a failed run opens its agent's page",
      request: pushed(RUN_FAILED),
      action: TAP,
      response: { route: "/tasks/agent/agent-3" },
    },
    {
      name: "a task the share sheet started opens its agent's page",
      request: posted({ kind: "share-started", taskId: "task-4", agentId: "agent-4" }),
      action: TAP,
      response: { route: "/tasks/agent/agent-4" },
    },
    {
      name: "a task the share sheet started with no agent opens the task",
      request: posted({ kind: "share-started", taskId: "task-5" }),
      action: TAP,
      response: { route: "/tasks/task-5" },
    },
    {
      name: "a settled thread's background push opens nothing",
      request: pushed({
        aps: { "content-available": 1, badge: 0 },
        kind: "settled",
        itemId: "item-1",
      }),
      action: TAP,
      response: undefined,
    },
    {
      name: "a payload that is not the service's opens nothing",
      request: pushed({ aps: APS, kind: "ask", itemId: "item-1" }),
      action: TAP,
      response: undefined,
    },
  ])("$name", ({ request, action, response }) => {
    expect(inboxPushResponseOf(inboxPushOfRequest(request), action)).toEqual(response);
  });
});
