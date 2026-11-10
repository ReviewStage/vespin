import assert from "node:assert/strict";
import { test } from "vitest";
import { ENTITY_KIND, entityWordHeard } from "./entity-kind.js";

/**
 * entity-kind.test.ts -- a screen reader hears an entity's kind before its name,
 * unless the name already starts with it: a place named for its kind says it
 * once, and one labeled with words of its own still says what it is.
 */

test("a place labeled with words of its own still says its kind", () => {
  assert.equal(entityWordHeard(ENTITY_KIND.INBOX, "my queue"), "Inbox");
  assert.equal(entityWordHeard(ENTITY_KIND.AUTOMATIONS, "the nightly jobs"), "automations");
  assert.equal(entityWordHeard(ENTITY_KIND.CHANGES, "Ada's diff"), "changes");
});

test("a name that already starts with its kind says it once", () => {
  assert.equal(entityWordHeard(ENTITY_KIND.INBOX, "Inbox"), undefined);
  assert.equal(entityWordHeard(ENTITY_KIND.APP, "Vespin"), undefined);
  assert.equal(entityWordHeard(ENTITY_KIND.CHANGES, "Changes by Ada"), undefined);
  assert.equal(entityWordHeard(ENTITY_KIND.MESSAGE, "Message from Ada"), undefined);
  assert.equal(entityWordHeard(ENTITY_KIND.INBOX, "Inbox (team)"), undefined);
  assert.equal(entityWordHeard(ENTITY_KIND.AUTOMATIONS, "Automations."), undefined);
});

test("a name that only begins with the kind's letters still says its kind", () => {
  assert.equal(entityWordHeard(ENTITY_KIND.PLAN, "Taskbar polish"), "task");
  assert.equal(entityWordHeard(ENTITY_KIND.PULL_REQUEST, "#42 Fix the refresh"), "pull request");
});
