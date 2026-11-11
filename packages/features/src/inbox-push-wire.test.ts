import { describe, expect, it } from "vitest";
import { inboxPushResponseOf } from "./inbox-push-wire.js";

/**
 * Where a tap or an action on a push takes the app, and what it sends there,
 * read from payloads written as the service sends them, Apple's `aps` and
 * all. Synthetic ids throughout.
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

const TAP = { actionId: "expo.modules.notifications.actions.DEFAULT" };

describe("inboxPushResponseOf", () => {
  it.each([
    {
      name: "a tap on an ask opens its thread",
      payload: DECIDE,
      action: TAP,
      response: { route: "/inbox/item-1" },
    },
    {
      name: "a decide's button sends the option at its place",
      payload: DECIDE,
      action: { actionId: "1" },
      response: {
        route: "/inbox/item-1",
        press: { kind: "choose", itemId: "item-1", messageId: "message-1", option: "Redis" },
      },
    },
    {
      name: "a button past the options only opens the thread",
      payload: DECIDE,
      action: { actionId: "2" },
      response: { route: "/inbox/item-1" },
    },
    {
      name: "a reply typed in place sends its words, trimmed",
      payload: POST,
      action: { actionId: "reply", text: "  Ship it.\n" },
      response: {
        route: "/inbox/item-2",
        press: { kind: "reply", itemId: "item-2", text: "Ship it." },
      },
    },
    {
      name: "a reply of nothing only opens the thread",
      payload: POST,
      action: { actionId: "reply", text: "   " },
      response: { route: "/inbox/item-2" },
    },
    {
      name: "a failed run opens its agent's page",
      payload: RUN_FAILED,
      action: TAP,
      response: { route: "/tasks/agent/agent-3" },
    },
    {
      name: "a task the share sheet started opens its agent's page",
      payload: { kind: "share-started", taskId: "task-4", agentId: "agent-4" },
      action: TAP,
      response: { route: "/tasks/agent/agent-4" },
    },
    {
      name: "a task the share sheet started with no agent opens the task",
      payload: { kind: "share-started", taskId: "task-5" },
      action: TAP,
      response: { route: "/tasks/task-5" },
    },
    {
      name: "a settled thread's background push opens nothing",
      payload: { aps: { "content-available": 1, badge: 0 }, kind: "settled", itemId: "item-1" },
      action: TAP,
      response: undefined,
    },
    {
      name: "a payload that is not the service's opens nothing",
      payload: { aps: APS, kind: "ask", itemId: "item-1" },
      action: TAP,
      response: undefined,
    },
  ])("$name", ({ payload, action, response }) => {
    expect(inboxPushResponseOf(payload, action)).toEqual(response);
  });
});
