import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
} from "@repo/features/manager-face";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { archiveAgent, createAgent } from "../agent-store.js";

/**
 * The face a new Manager is given, over a real dialect: none that another
 * standing Manager of its workspace wears while one is free, whatever
 * another workspace's Managers wear, and an archived one's face free again.
 * Synthetic accounts.
 */

/** Every face there is: each character in each color. */
const EVERY_FACE: readonly ManagerFace[] = Object.values(MANAGER_FACE_CHARACTER).flatMap(
  (character) => Object.values(MANAGER_FACE_COLOR).map((color) => ({ character, color })),
);

const faceKey = (face: ManagerFace | null | undefined) =>
  face === null || face === undefined ? "none" : JSON.stringify([face.character, face.color]);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openManager = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const started = yield* createAgent(userId, {
      taskId: null,
      workspaceId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      descriptionSnapshot: null,
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      kind: AGENT_KIND.MANAGER,
    });

    return Option.getOrThrow(started).agent;
  });

it.layer(getTestDB())("a new Manager's face", (it) => {
  it.effect(
    "takes a face no standing Manager of its workspace wears, the last free one too, and an archived one's again",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);

        const made = [];

        for (let count = 1; count < EVERY_FACE.length; count++) {
          made.push(yield* openManager(owner, workspaceId));
        }

        const worn = new Set(made.map((agent) => faceKey(agent.face)));
        const free = EVERY_FACE.find((face) => !worn.has(faceKey(face)));
        assert.equal(worn.size, EVERY_FACE.length - 1);
        assert.ok(free !== undefined);

        // Another workspace's Manager wearing the one free face takes nothing from this one's.
        const other = yield* openManager(owner, elsewhere);
        yield* db.update(agentTable).set({ face: free }).where(eq(agentTable.id, other.id));
        const last = yield* openManager(owner, workspaceId);
        assert.equal(faceKey(last.face), faceKey(free));

        const [archived] = made;
        assert.ok(archived !== undefined);
        yield* archiveAgent(owner, archived.id, true);
        const next = yield* openManager(owner, workspaceId);
        assert.equal(faceKey(next.face), faceKey(archived.face));
      }),
  );
});
