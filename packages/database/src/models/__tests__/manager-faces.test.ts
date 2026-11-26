import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_KIND, type AgentKind } from "@repo/features/agent-wire";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  MANAGER_FACE_PICK_COLORS,
  type ManagerFace,
} from "@repo/features/manager-face";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { archiveAgent, createAgent, updateManagerFaceCommitted } from "../agent-store.js";

/**
 * The face a new Manager is given, over a real dialect: none that another
 * standing Manager of its workspace wears while one is free, whatever
 * another workspace's Managers wear, and an archived one's face free again;
 * and a face a member picks, its emoji too, worn as picked. Synthetic
 * accounts.
 */

/** Every face the service gives: each character in each color a face is given in, never `peach` and never an emoji. */
const EVERY_FACE: readonly ManagerFace[] = Object.values(MANAGER_FACE_CHARACTER).flatMap(
  (character) => MANAGER_FACE_PICK_COLORS.map((color) => ({ character, color })),
);

const faceKey = (face: ManagerFace | null | undefined) =>
  face === null || face === undefined
    ? "none"
    : JSON.stringify([face.character, face.color, face.emoji]);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openManager = (
  userId: string,
  workspaceId: string,
  kind: AgentKind = AGENT_KIND.MANAGER,
  face?: ManagerFace,
) =>
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
      kind,
      face,
    });

    return Option.getOrThrow(started).agent;
  });

it.layer(getTestDB())("a new Manager's face", (it) => {
  it.effect(
    "takes a face of the nine colors no standing Manager of its workspace wears, the last free one too, and an archived one's again",
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
        const given = new Set(EVERY_FACE.map(faceKey));
        assert.ok([...worn].every((face) => given.has(face)));
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

  it.effect(
    "wears a picked face though another Manager wears it, takes a new pick with its emoji, and leaves a coder and an outsider unchanged",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        const first = yield* openManager(owner, workspaceId);
        assert.ok(first.face !== null && first.face !== undefined);

        const twin = yield* openManager(owner, workspaceId, AGENT_KIND.MANAGER, first.face);
        assert.equal(faceKey(twin.face), faceKey(first.face));

        const picked = {
          character: MANAGER_FACE_CHARACTER.MUG,
          color: MANAGER_FACE_COLOR.TEAL,
          emoji: "🚀",
        };

        const changed = yield* updateManagerFaceCommitted(owner, twin.id, picked);
        assert.equal(faceKey(Option.getOrThrow(changed).agent.face), faceKey(picked));

        const coder = yield* openManager(owner, workspaceId, AGENT_KIND.CODER);
        assert.ok(Option.isNone(yield* updateManagerFaceCommitted(owner, coder.id, picked)));
        assert.ok(Option.isNone(yield* updateManagerFaceCommitted(outsider, first.id, picked)));
      }),
  );
});
