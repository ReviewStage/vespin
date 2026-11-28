/**
 * runs-on-pick.ts -- where an account last chose to run an agent, kept as the fallback for a start naming no place and as where New task starts.
 *
 * A start may name where its agent runs, but one that names none is made
 * where no window chose, so the service keeps the last place a start named
 * on the account's preference row, read where nothing nearer decides: a
 * start's source or the account's newest agent on the task comes first. A
 * task holds no place of its own. It holds the cloud, or one of the
 * account's devices by id. Every client follows it on the account's
 * preferences live read, where New task's Runs on starts on it. Note
 * that it is written alone, never through the preferences snapshot, and
 * moves no `updated_at`, because that instant tells a Mac the preferences
 * part was written and a pick is no part of it.
 */

import { storedRunsOn } from "@repo/features/account-preferences-live";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { accountPreference } from "../schemas/preferences.js";

const PICK_COLUMNS = {
  runsOnMachine: accountPreference.runsOnMachine,
  runsOnDeviceId: accountPreference.runsOnDeviceId,
} as const;

const PickRowSchema = Schema.Struct({
  runsOnMachine: Schema.NullOr(Schema.String),
  runsOnDeviceId: Schema.NullOr(Schema.String),
});

const PickWriteSchema = Schema.Struct({
  userId: Schema.String,
  machine: Schema.Literals(Object.values(AGENT_MACHINE)),
  deviceId: Schema.NullOr(Schema.String),
});

const findPick = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PickRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(PICK_COLUMNS)
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId))
        .limit(1),
    ),
});

/** Writes the pick over what stood, opening the account's row where it has none. */
const upsertPick = SqlSchema.void({
  Request: PickWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(accountPreference)
        .values({
          userId: write.userId,
          runsOnMachine: write.machine,
          runsOnDeviceId: write.deviceId,
        })
        .onConflictDoUpdate({
          target: accountPreference.userId,
          set: {
            runsOnMachine: write.machine,
            runsOnDeviceId: write.deviceId,
          },
        }),
    ),
});

/** Where the account last chose to run an agent; none where no start has named one. */
export function readRunsOnPick(
  userId: string,
): Effect.Effect<Option.Option<TaskRunsOnRequest>, StoreFailure, DatabaseServices> {
  // Note that the row is read as every client's live read reads it (`storedRunsOn`), so the two never disagree.
  return Effect.map(
    findPick(userId),
    Option.flatMap((row) => Option.fromUndefinedOr(storedRunsOn(row))),
  );
}

/** Keeps where the account chose to run an agent as its last pick, over what stood. */
export function keepRunsOnPick(
  userId: string,
  pick: TaskRunsOnRequest,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return upsertPick({
    userId,
    machine: pick.machine,
    deviceId: pick.machine === AGENT_MACHINE.DEVICE ? pick.deviceId : null,
  });
}
