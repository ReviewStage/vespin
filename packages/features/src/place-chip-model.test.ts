import assert from "node:assert/strict";
import { test } from "vitest";
import { ENTITY_KIND, type Entity, type KnownNames } from "./entity-kind.js";
import { heldChipName, namedPlainLinks } from "./place-chip-model.js";

const NONE: ReadonlyMap<string, string> = new Map();

/** The names a client holds: task 42's title, as an iOS chip finds a task by its number, and version 3 of it. */
const KNOWN: KnownNames = {
  tasks: new Map([["42", "Teammate invitations"]]),
  agents: NONE,
  agentModels: NONE,
  pages: NONE,
  pagesTaskId: undefined,
  inboxItems: NONE,
  people: NONE,
  automations: NONE,
};

const TASK: Entity = { kind: ENTITY_KIND.PLAN, taskId: "42" };
const VERSION: Entity = { kind: ENTITY_KIND.VERSION, taskId: "42", revision: 3 };
const UNHELD: Entity = { kind: ENTITY_KIND.PLAN, taskId: "43" };

test("a chip says the name held for what it names where that is live or the link was bare, and its own words otherwise", () => {
  // A task's title is live, so it wins over a bare link's kind and over the words it was labeled with.
  assert.equal(heldChipName(TASK, "Task", true, KNOWN), "Teammate invitations");
  assert.equal(heldChipName(TASK, "Invites", false, KNOWN), "Teammate invitations");
  // A version's name is no live one, so a label stands, and only a bare link takes the name held.
  assert.equal(heldChipName(VERSION, "the draft", false, KNOWN), "the draft");
  assert.equal(heldChipName(VERSION, "Version", true, KNOWN), "Teammate invitations, version 3");
  // A task the client holds no name of keeps its kind, as one still found, one the reader may not open, or one deleted.
  assert.equal(heldChipName(UNHELD, "Task", true, KNOWN), "Task");
});

test("plain words say each place of ours spelled bare by its chip's name, a task's number found first, and leave every other address as written", () => {
  const names = {
    known: { ...KNOWN, tasks: new Map([["task-id-42", "Teammate invitations"]]) },
    taskIdOf: ({ workspace, number }: { workspace: string; number: number }) =>
      workspace === "acme" && number === 42 ? "task-id-42" : undefined,
  };

  assert.equal(
    namedPlainLinks(
      "Open https://vespin.dev/acme/task/42, then https://vespin.dev/acme/task/STAG-7 and https://example.com/docs.",
      names,
    ),
    "Open Teammate invitations, then Task and https://example.com/docs.",
  );
});
