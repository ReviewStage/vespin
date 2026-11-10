import assert from "node:assert/strict";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { test } from "vitest";
import { LINK_ROUTE, linkRoute } from "./link-route.js";

/**
 * Where the window opens an app link: a page of Settings in Settings, on
 * the reader's own copy of the workspace its slug names; a place of an
 * experiment that is off nowhere; anything else on the Plans tab, whose
 * read decides. Synthetic workspaces.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const WINDOW = { workspaces: [ACME], adminOn: false };

test("a link to a page of Settings opens it on the workspace its slug names, where the account is in it", () => {
  assert.deepEqual(
    linkRoute(
      { workspace: "acme", place: { kind: LINK_DESTINATION.SETTINGS, page: "workspace" } },
      WINDOW,
    ),
    {
      kind: LINK_ROUTE.SETTINGS,
      settings: { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id },
    },
  );
  assert.deepEqual(
    linkRoute(
      { workspace: "someone-elses", place: { kind: LINK_DESTINATION.SETTINGS, page: "workspace" } },
      WINDOW,
    ),
    { kind: LINK_ROUTE.SETTINGS, settings: { page: SETTINGS_VIEW.WORKSPACE } },
  );
});

test("a link to Settings with no page, or a page this window does not know, opens Settings on its page list, at its first page", () => {
  for (const place of [
    { kind: LINK_DESTINATION.SETTINGS },
    { kind: LINK_DESTINATION.SETTINGS, page: "billing" },
  ] as const) {
    assert.deepEqual(linkRoute({ workspace: "acme", place }, WINDOW), {
      kind: LINK_ROUTE.SETTINGS,
      settings: { page: SETTINGS_VIEW.ACCOUNT, listed: true, workspaceId: ACME.id },
    });
  }
});

test("an automation, no experiment now, opens on the Plans tab", () => {
  const automation = { kind: LINK_DESTINATION.AUTOMATION, automationId: "a1" } as const;

  assert.deepEqual(linkRoute({ workspace: "acme", place: automation }, WINDOW), {
    kind: LINK_ROUTE.TASKS,
  });
});

test("a link to the Admin place or one of its views opens nowhere for a reader who is no admin, and on the Plans tab for an admin", () => {
  for (const place of [
    { kind: LINK_DESTINATION.ADMIN },
    { kind: LINK_DESTINATION.ADMIN, section: "cost" },
    { kind: LINK_DESTINATION.ADMIN, userId: "u1" },
  ] as const) {
    assert.deepEqual(linkRoute({ workspace: "acme", place }, WINDOW), {
      kind: LINK_ROUTE.NOT_PERMITTED,
    });
    assert.deepEqual(linkRoute({ workspace: "acme", place }, { ...WINDOW, adminOn: true }), {
      kind: LINK_ROUTE.TASKS,
    });
  }
});

test("a task, an agent, or an Inbox item opens on the Plans tab, whatever workspace its slug names", () => {
  for (const place of [
    { kind: LINK_DESTINATION.TASK, planId: "p1" },
    { kind: LINK_DESTINATION.AGENT, agentId: "a1" },
    { kind: LINK_DESTINATION.INBOX_ITEM, agentId: "a1", itemId: "i1" },
  ] as const) {
    assert.deepEqual(linkRoute({ workspace: "someone-elses", place }, WINDOW), {
      kind: LINK_ROUTE.TASKS,
    });
  }
});
