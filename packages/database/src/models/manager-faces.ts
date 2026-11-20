/**
 * manager-faces.ts -- the face a new Manager wears: its id hashed into the faces, stepped past those its workspace's standing Managers wear.
 *
 * A face is a character and a color (`@repo/features/manager-face`), so
 * there are as many faces as pairs. They are walked in one fixed order, the
 * diagonals of the pairs, so faces side by side in it differ in both their
 * character and their color. A new Manager's id, and nothing else of it or
 * its starter, picks where the walk starts (`FACE_SEED`), and it takes the
 * first face from there that no unarchived Manager of its workspace wears,
 * so Managers that stand together differ; where every face is worn it takes
 * the one its id picked. The workspace's Manager starts take turns on a lock
 * of the workspace's, so two made at once never take one face. Note that
 * the migration that added the column gave every Manager made before it a
 * face by this same walk, in the order they were made
 * (`20261120022411_agent_manager_face`), which is why the seed is one
 * Postgres can compute: the first eight hex digits of the id's MD5. A
 * face its creator picked is worn as picked, worn by another Manager or
 * not: only the service's own pick steps past those worn.
 */

import { createHash } from "node:crypto";
import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_FACE_CHARACTER,
  MANAGER_FACE_COLOR,
  type ManagerFace,
  managerFaceSchema,
} from "@repo/features/manager-face";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";

const CHARACTERS = Object.values(MANAGER_FACE_CHARACTER);
const COLORS = Object.values(MANAGER_FACE_COLOR);

/** Every face in walk order: the pairs' diagonals, each a run of faces whose characters and colors all differ. */
const FACES: readonly ManagerFace[] = COLORS.flatMap((_, diagonal) =>
  CHARACTERS.map((character, step) => ({
    character,
    color: COLORS[(step + diagonal) % COLORS.length] ?? MANAGER_FACE_COLOR.YELLOW,
  })),
);

/** How many hex digits of the id's MD5 seed the walk, few enough to read as one unsigned 32-bit number in Postgres too. */
const FACE_SEED_DIGITS = 8;

/** Where the walk starts for the agent: its id's MD5, read as a number, into the faces. */
function seedOf(agentId: string): number {
  const digest = createHash("md5").update(agentId).digest("hex");

  return Number.parseInt(digest.slice(0, FACE_SEED_DIGITS), 16) % FACES.length;
}

/** The first face from the agent's seed that none of `worn` is, else the seed's own. */
function faceFor(agentId: string, worn: readonly ManagerFace[]): ManagerFace {
  const seed = seedOf(agentId);

  const free = (face: ManagerFace) =>
    !worn.some((other) => other.character === face.character && other.color === face.color);

  const walk = [...FACES.slice(seed), ...FACES.slice(0, seed)];
  const picked = walk.find(free) ?? walk[0];

  if (picked === undefined) throw new Error("the faces are empty");

  return picked;
}

/** The faces the workspace's other unarchived Managers wear. */
const findWornFaces = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, workspaceId: Schema.String }),
  Result: Schema.Struct({ face: managerFaceSchema }),
  execute: ({ agentId, workspaceId }) =>
    Database.use((db) =>
      db
        .select({ face: agentTable.face })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.organizationId, workspaceId),
            eq(agentTable.kind, AGENT_KIND.MANAGER),
            isNull(agentTable.archivedAt),
            isNotNull(agentTable.face),
            ne(agentTable.id, agentId),
          ),
        ),
    ),
});

const storeFace = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, face: managerFaceSchema }),
  execute: ({ agentId, face }) =>
    Database.use((db) => db.update(agentTable).set({ face }).where(eq(agentTable.id, agentId))),
});

/**
 * Gives the workspace's new Manager its face, the one its creator picked
 * or else as above, and answers it. Run inside the transaction that made
 * the agent, which holds the workspace's lock until it commits.
 */
export const pickManagerFace = (
  agentId: string,
  workspaceId: string,
  picked: ManagerFace | undefined,
): Effect.Effect<ManagerFace, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    if (picked !== undefined) {
      yield* storeFace({ agentId, face: picked });

      return picked;
    }

    const client = yield* SqlClient.SqlClient;
    // Note that the workspace's Manager starts take turns, because two that each read the other's face unworn would both take it.
    yield* client`select pg_advisory_xact_lock(hashtextextended(${workspaceId}, 41))`;

    const worn = yield* findWornFaces({ agentId, workspaceId });

    const face = faceFor(
      agentId,
      worn.map((row) => row.face),
    );

    yield* storeFace({ agentId, face });

    return face;
  });
