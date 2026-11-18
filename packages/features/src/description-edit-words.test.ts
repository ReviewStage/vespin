import assert from "node:assert/strict";
import { test } from "vitest";
import { lastEditConflict } from "./description-edit-words.js";
import { DESCRIPTION_ACTOR } from "./task-wire.js";

const READER = "a1b2c3d4-0000-4000-8000-000000000001";

test("a conflict with the reader's own save elsewhere says so, rather than naming them as another writer", () => {
  const own = {
    actor: DESCRIPTION_ACTOR.DEVELOPER,
    by: { userId: READER, name: "Ada Lovelace" },
    at: 1,
    duringCall: false,
  };

  assert.deepEqual(lastEditConflict(own, READER), {
    note: "You changed this section elsewhere while you were editing.",
    take: "Use the other",
  });
});
