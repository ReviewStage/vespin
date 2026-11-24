import { and, asc, eq, exists, isNull, ne, sql } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import { CURRENT_TXID, TxidRowSchema } from "../core/txid.js";
import { agentTable } from "../schemas/agent.js";
import { agentFollower } from "../schemas/agent-follower.js";
import { member } from "../schemas/auth.js";
import { InstantColumnSchema } from "./columns.js";
import { agentVisibleTo } from "./workspace-store.js";

/**
 * agent-follower-store.ts -- the members following an agent on no task, a Manager, read and written for the account that asks.
 *
 * An agent on a task is followed through its task (`task-follower-store.ts`);
 * this store holds the followers of one on none, and reads any other agent
 * as no agent. Every statement names the account it runs for and gates on
 * its reach of the agent (`agentVisibleTo`), so an agent the account does not
 * reach reads as no agent, its followers among it. A follower is a member of
 * the agent's workspace: one who left reads as no follower, and a member of
 * no other workspace is ever added. Any member who reaches the agent may add
 * another member as a follower and take any follower away again, but
 * `machines`, whether the agent may use a follower's machines, is switched
 * by that follower alone. The agent's owner, the member who started it,
 * always follows it with their machines on: they hold no row, are read from
 * the agent itself, and are refused an unfollow or a switch.
 * Following again keeps the row as it stands, its switch among it. Each
 * write answers the agent's followers as they then stand and the
 * transaction it committed in, none where it changed no row. Every function
 * is an effect over the ambient `SqlClient` and names no database of its own.
 */

/** What an agent follower store operation answers: an effect over the ambient client, failing as every store does. */
export type AgentFollowerEffect<A, E = never> = Effect.Effect<
  A,
  StoreFailure | E,
  DatabaseServices
>;

/** The agent's owner was asked to unfollow it or to switch their machines, which they always lend it; nothing was written. */
export class AgentFollowerIsOwner extends Data.TaggedError("AgentFollowerIsOwner") {}

/** One member following an agent on no task, as the agent's readers read them. */
export interface AgentFollower {
  readonly userId: string;
  /** Whether they are the agent's owner, who started it. */
  readonly owner: boolean;
  /** Whether the agent may use this member's machines; always so for its owner. */
  readonly machines: boolean;
  /** When they began following, in milliseconds since the epoch; for the owner, when the agent was started. */
  readonly followedAt: number;
}

/** An agent's followers as a write left them, and the transaction it committed in; none where it changed no row. */
export interface AgentFollowersWritten {
  readonly followers: readonly AgentFollower[];
  readonly txid?: string;
}

const KeySchema = Schema.Struct({ agentId: Schema.String, userId: Schema.String });

const FollowerRowSchema = Schema.Struct({
  userId: Schema.String,
  machines: Schema.Boolean,
  followedAt: InstantColumnSchema,
});

const ReachedRowSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  ownerIsMember: Schema.Boolean,
  startedAt: InstantColumnSchema,
});

type ReachedAgent = typeof ReachedRowSchema.Type;

/** The condition that the member a statement names is a member of the workspace of the agent it reads. */
function memberOfAgentWorkspace(
  userId: string | typeof agentFollower.userId | typeof agentTable.userId,
) {
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, agentTable.organizationId))),
  );
}

/** The agent on no task under this id, where the account reaches it, with its owner; any other id reads as no agent. */
const findReachableAgent = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: ReachedRowSchema,
  execute: ({ agentId, userId }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          ownerId: agentTable.userId,
          ownerIsMember: sql<boolean>`${memberOfAgentWorkspace(agentTable.userId)}`,
          startedAt: agentTable.createdAt,
        })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), isNull(agentTable.taskId), agentVisibleTo(userId)))
        .limit(1),
    ),
});

/** Whether the member is a member of the workspace of the agent under this id. */
const findFollowerMembership = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, userId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), memberOfAgentWorkspace(userId)))
        .limit(1),
    ),
});

/** The agent's followers who hold a row and are members of its workspace, its owner left out, the earliest to follow first. */
const findFollowers = SqlSchema.findAll({
  Request: Schema.String,
  Result: FollowerRowSchema,
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({
          userId: agentFollower.userId,
          machines: agentFollower.machines,
          followedAt: agentFollower.createdAt,
        })
        .from(agentFollower)
        .innerJoin(agentTable, eq(agentTable.id, agentFollower.agentId))
        .where(
          and(
            eq(agentFollower.agentId, agentId),
            ne(agentFollower.userId, agentTable.userId),
            memberOfAgentWorkspace(agentFollower.userId),
          ),
        )
        .orderBy(asc(agentFollower.createdAt), asc(agentFollower.userId)),
    ),
});

/** A follower's row written where none stands, and the transaction it was written in; nothing where one stands, which keeps its switch. */
const insertFollower = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ agentId, userId, machines, now }) =>
    Database.use((db) =>
      db
        .insert(agentFollower)
        .values({ agentId, userId, machines, createdAt: now })
        .onConflictDoNothing()
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** A follower's switch set as asked, and the transaction it was written in; nothing where they do not follow the agent or the switch stood so. */
const updateMachines = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...KeySchema.fields, machines: Schema.Boolean }),
  Result: TxidRowSchema,
  execute: ({ agentId, userId, machines }) =>
    Database.use((db) =>
      db
        .update(agentFollower)
        .set({ machines })
        .where(
          and(
            eq(agentFollower.agentId, agentId),
            eq(agentFollower.userId, userId),
            sql`${agentFollower.machines} is distinct from ${machines}`,
          ),
        )
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** The follower's row taken away, and the transaction it went in; nothing where they did not follow the agent. */
const deleteFollower = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: TxidRowSchema,
  execute: ({ agentId, userId }) =>
    Database.use((db) =>
      db
        .delete(agentFollower)
        .where(and(eq(agentFollower.agentId, agentId), eq(agentFollower.userId, userId)))
        .returning({ txid: CURRENT_TXID }),
    ),
});

/** The agent's followers: its owner first, while a member of its workspace, then every other follower, the earliest to follow first. */
function followersOf(agent: ReachedAgent): AgentFollowerEffect<readonly AgentFollower[]> {
  return Effect.map(findFollowers(agent.id), (rows) => {
    const others = rows.map((row) => ({
      userId: row.userId,
      owner: false,
      machines: row.machines,
      followedAt: row.followedAt.getTime(),
    }));

    if (!agent.ownerIsMember) return others;

    const owner = {
      userId: agent.ownerId,
      owner: true,
      machines: true,
      followedAt: agent.startedAt.getTime(),
    };

    return [owner, ...others];
  });
}

/** The agent's followers as they stand after a write, with the transaction it committed in, none where it changed nothing. */
function writtenOf(
  agent: ReachedAgent,
  written: Option.Option<{ readonly txid: string }>,
): AgentFollowerEffect<AgentFollowersWritten> {
  return Effect.map(followersOf(agent), (followers) =>
    Option.match(written, {
      onNone: () => ({ followers }),
      onSome: ({ txid }) => ({ followers, txid }),
    }),
  );
}

/** The effect run in one transaction of the ambient client. */
function transaction<A, E>(
  effect: Effect.Effect<A, E, DatabaseServices>,
): Effect.Effect<A, E | StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(effect));
}

/**
 * The agent's followers, as the account reads them, its owner first and the
 * rest the earliest to follow first; nothing where the account does not
 * reach the agent or it stands on a task.
 */
export function listAgentFollowers(
  userId: string,
  agentId: string,
): AgentFollowerEffect<Option.Option<readonly AgentFollower[]>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableAgent({ agentId, userId });

    if (Option.isNone(reached)) return Option.none();

    return Option.some(yield* followersOf(reached.value));
  });
}

/**
 * Makes the follower follow the agent, with machines as asked, and answers
 * the agent's followers as they then stand. A follower already following
 * keeps their row as it was, their switch among it, and the owner, who
 * always follows, is written no row. Nothing where the account does not
 * reach the agent, or the follower is no member of its workspace.
 */
export function followAgent(
  userId: string,
  write: { readonly agentId: string; readonly followerId: string; readonly machines: boolean },
): AgentFollowerEffect<Option.Option<AgentFollowersWritten>> {
  const { agentId, followerId, machines } = write;

  return transaction(
    Effect.gen(function* () {
      const reached = yield* findReachableAgent({ agentId, userId });

      if (Option.isNone(reached)) return Option.none();

      if (Option.isNone(yield* findFollowerMembership({ agentId, userId: followerId }))) {
        return Option.none();
      }

      if (reached.value.ownerId === followerId) {
        return Option.some(yield* writtenOf(reached.value, Option.none()));
      }

      const now = yield* DateTime.nowAsDate;
      const written = yield* insertFollower({ agentId, userId: followerId, machines, now });

      return Option.some(yield* writtenOf(reached.value, written));
    }),
  );
}

/**
 * Stops the follower following the agent, the account itself where it names
 * no one else, and answers the agent's followers as they then stand; one
 * not following stays so. Nothing where the account does not reach the
 * agent; its owner is refused with `AgentFollowerIsOwner`, since they always
 * follow it.
 */
export function unfollowAgent(
  userId: string,
  agentId: string,
  followerId: string = userId,
): AgentFollowerEffect<Option.Option<AgentFollowersWritten>, AgentFollowerIsOwner> {
  return transaction(
    Effect.gen(function* () {
      const reached = yield* findReachableAgent({ agentId, userId });

      if (Option.isNone(reached)) return Option.none();

      if (reached.value.ownerId === followerId) return yield* new AgentFollowerIsOwner();
      const written = yield* deleteFollower({ agentId, userId: followerId });

      return Option.some(yield* writtenOf(reached.value, written));
    }),
  );
}

/**
 * Switches whether the agent may use the account's own machines, and
 * answers the agent's followers as they then stand; nothing where the
 * account does not reach the agent or does not follow it. Its owner is
 * refused with `AgentFollowerIsOwner`, since the agent always uses theirs.
 */
export function setAgentFollowerMachines(
  userId: string,
  agentId: string,
  machines: boolean,
): AgentFollowerEffect<Option.Option<AgentFollowersWritten>, AgentFollowerIsOwner> {
  return transaction(
    Effect.gen(function* () {
      const reached = yield* findReachableAgent({ agentId, userId });

      if (Option.isNone(reached)) return Option.none();

      if (reached.value.ownerId === userId) return yield* new AgentFollowerIsOwner();
      const written = yield* updateMachines({ agentId, userId, machines });
      const after = yield* writtenOf(reached.value, written);

      if (!after.followers.some((follower) => follower.userId === userId)) return Option.none();

      return Option.some(after);
    }),
  );
}
