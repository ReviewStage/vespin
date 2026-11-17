/**
 * sandbox-owners.test.ts -- whom each sandbox is billed to, over a real dialect: the first record of a name stands, and it outlives its agent. Synthetic accounts, agents, and sandbox names throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openAgentOnOwnTask, openWorkspace } from "../../testing/index.js";
import { recordSandboxOwner, sandboxOwner } from "../sandbox-owners.js";

const FIRST = new Date("2026-11-15T12:00:00Z");
const LATER = new Date("2026-11-15T13:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

it.layer(getTestDB())("a sandbox's owner", (it) => {
  it.effect("recorded twice keeps its first record", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const [acme, globex] = [yield* openWorkspace(owner), yield* openWorkspace(owner)];
      const sandboxName = `workspace-drive-${randomUUID()}`;
      const first = { sandboxName, organizationId: acme, agentId: null, userId: owner };

      yield* recordSandboxOwner({ ...first, createdAt: FIRST });
      yield* recordSandboxOwner({ ...first, organizationId: globex, createdAt: LATER });

      assert.deepEqual(
        yield* sandboxOwner(sandboxName),
        Option.some({ ...first, createdAt: FIRST }),
      );
    }),
  );

  it.effect("outlives the agent it was opened for", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      const agentId = yield* openAgentOnOwnTask(owner, acme);
      const sandboxName = `agent-sandbox-${randomUUID()}`;

      const record = {
        sandboxName,
        organizationId: acme,
        agentId,
        userId: owner,
        createdAt: FIRST,
      };

      yield* recordSandboxOwner(record);
      yield* Effect.flatMap(Database, (db) =>
        db.delete(agentTable).where(eq(agentTable.id, agentId)),
      );

      assert.deepEqual(yield* sandboxOwner(sandboxName), Option.some(record));
    }),
  );
});
