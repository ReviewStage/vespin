/**
 * account-allowed-commands.ts -- the shell commands a member always allows their coding agents to run unasked: listed, added once, edited, and removed, each by the member alone.
 *
 * Every statement is keyed by the member's own account, so no member reads,
 * adds to, or removes from another's list (`../schemas/account-allowed-command.ts`):
 * a command of another member's answers as one that is not there. A prefix
 * is kept once per member, so a second add of it, from another ask or by
 * hand, answers it kept and changes nothing, the agent it first came from
 * standing. The list is held to its bound (`ALLOWED_COMMAND_BOUNDS`) by a
 * count before the add, under a lock of the member's own, so two adds racing
 * for the bound's last place land one after the other and the second is
 * refused; two members' adds never wait on each other. An edit takes the
 * same lock, so it never races an add for the words it puts in place.
 */

import { ALLOWED_COMMAND_BOUNDS } from "@repo/features/allowed-command-wire";
import type { CommandPrefix } from "@repo/wire";
import { and, asc, count, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { accountAllowedCommand } from "../schemas/account-allowed-command.js";
import { InstantColumnSchema } from "./columns.js";

type AllowedCommandEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** The seed of a member's add lock, apart from every other advisory lock's keyed by the same id. */
const ADD_LOCK_SEED = 11;

/** How an add stood: kept anew, already kept, or refused at the list's bound. */
export const ALLOWED_COMMAND_ADDED = {
  ADDED: "added",
  KEPT: "kept",
  FULL: "full",
} as const;

export type AllowedCommandAdded =
  (typeof ALLOWED_COMMAND_ADDED)[keyof typeof ALLOWED_COMMAND_ADDED];

/** One command of a member's list as its row keeps it. */
const AllowedCommandRowSchema = Schema.Struct({
  id: Schema.String,
  prefix: Schema.Array(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

export type AllowedCommandRow = typeof AllowedCommandRowSchema.Type;

const ROW_COLUMNS = {
  id: accountAllowedCommand.id,
  prefix: accountAllowedCommand.prefix,
  agentId: accountAllowedCommand.agentId,
  createdAt: accountAllowedCommand.createdAt,
};

const PrefixKeySchema = Schema.Struct({
  userId: Schema.String,
  prefix: Schema.Array(Schema.String),
});

const findOfUser = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: AllowedCommandRowSchema,
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountAllowedCommand)
        .where(eq(accountAllowedCommand.userId, userId))
        .orderBy(asc(accountAllowedCommand.createdAt), asc(accountAllowedCommand.id)),
    ),
});

const countOfUser = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: Schema.Struct({ kept: Schema.Number }),
  execute: ({ userId }) =>
    Database.use((db) =>
      db
        .select({ kept: count() })
        .from(accountAllowedCommand)
        .where(eq(accountAllowedCommand.userId, userId)),
    ),
});

const findPrefix = SqlSchema.findAll({
  Request: PrefixKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, prefix }) =>
    Database.use((db) =>
      db
        .select({ id: accountAllowedCommand.id })
        .from(accountAllowedCommand)
        .where(
          and(
            eq(accountAllowedCommand.userId, userId),
            eq(accountAllowedCommand.prefix, [...prefix]),
          ),
        ),
    ),
});

const insertPrefix = SqlSchema.findAll({
  Request: Schema.Struct({
    ...PrefixKeySchema.fields,
    agentId: Schema.NullOr(Schema.String),
    at: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, prefix, agentId, at }) =>
    Database.use((db) =>
      db
        .insert(accountAllowedCommand)
        .values({ userId, prefix: [...prefix], agentId, createdAt: at })
        // A prefix the member already keeps stands as it was first kept.
        .onConflictDoNothing({
          target: [accountAllowedCommand.userId, accountAllowedCommand.prefix],
        })
        .returning({ id: accountAllowedCommand.id }),
    ),
});

const updateOfUser = SqlSchema.void({
  Request: Schema.Struct({
    ...PrefixKeySchema.fields,
    id: Schema.String,
    at: Schema.Date,
  }),
  execute: ({ userId, id, prefix, at }) =>
    Database.use((db) =>
      db
        .update(accountAllowedCommand)
        .set({ prefix: [...prefix], agentId: null, createdAt: at })
        .where(and(eq(accountAllowedCommand.userId, userId), eq(accountAllowedCommand.id, id))),
    ),
});

const deleteOfUser = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(accountAllowedCommand)
        .where(and(eq(accountAllowedCommand.userId, userId), eq(accountAllowedCommand.id, id))),
    ),
});

/** The member's commands, the earliest added first. */
export function listAllowedCommands(
  userId: string,
): AllowedCommandEffect<readonly AllowedCommandRow[]> {
  return findOfUser({ userId });
}

/**
 * Keeps the prefix on the member's list, naming the agent whose ask it came
 * from, none for one added by hand; answers whether it was kept anew, was
 * already kept, or was refused with the list at its bound.
 */
export function addAllowedCommand(add: {
  readonly userId: string;
  readonly prefix: CommandPrefix;
  readonly agentId: string | null;
  readonly at: Date;
}): AllowedCommandEffect<AllowedCommandAdded> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${add.userId}, ${ADD_LOCK_SEED}))`;
        const [counted] = yield* countOfUser({ userId: add.userId });

        if ((counted?.kept ?? 0) >= ALLOWED_COMMAND_BOUNDS.MAX_COMMANDS) {
          const found = yield* findPrefix({ userId: add.userId, prefix: add.prefix });

          return found.length > 0 ? ALLOWED_COMMAND_ADDED.KEPT : ALLOWED_COMMAND_ADDED.FULL;
        }

        const inserted = yield* insertPrefix(add);

        return inserted.length > 0 ? ALLOWED_COMMAND_ADDED.ADDED : ALLOWED_COMMAND_ADDED.KEPT;
      }),
    ),
  );
}

/**
 * One of the member's commands given new first words, typed by hand: it
 * stands as added by hand at `at`, naming no agent, since no agent's ask
 * proposed those words. Where the list keeps them already the edited
 * command goes and the one kept stands as it was, so a prefix is still
 * kept once; a command the member keeps not is left as it is. Note that it
 * runs under the member's add lock, because an add racing it for the same
 * words would otherwise keep them twice.
 */
export function editAllowedCommand(edit: {
  readonly userId: string;
  readonly id: string;
  readonly prefix: CommandPrefix;
  readonly at: Date;
}): AllowedCommandEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${edit.userId}, ${ADD_LOCK_SEED}))`;
        const found = yield* findPrefix({ userId: edit.userId, prefix: edit.prefix });
        const keptElsewhere = found.some((each) => each.id !== edit.id);

        if (keptElsewhere) {
          yield* deleteOfUser({ userId: edit.userId, id: edit.id });

          return;
        }

        yield* updateOfUser(edit);
      }),
    ),
  );
}

/** One of the member's commands removed; one they keep not is left as it is, so a removal retried answers the same. */
export function removeAllowedCommand(userId: string, id: string): AllowedCommandEffect<void> {
  return deleteOfUser({ userId, id });
}
