/**
 * account-view-choices.ts -- the view choices an account keeps (`../schemas/account-view-choice.ts`): one kept, chosen again, or forgotten, each by the account alone.
 *
 * Every statement is keyed by the caller's own account, so no account
 * writes over or forgets another's choice. A choice of a workspace's is
 * kept only in a workspace the account is a member of. Whether the value is
 * one its key holds is the caller's to check (`@repo/features/view-choice-wire`'s
 * `viewChoiceStored`), since the key's Schema is wire vocabulary. A write
 * answers the transaction it committed in, so a client following the
 * account's live read of its choices draws its own until that read carries
 * it; one that changed no row answers none.
 */

import {
  VIEW_CHOICE_KEY,
  type ViewChoiceKey,
  type ViewChoiceWritten,
} from "@repo/features/view-choice-wire";
import { type WireValue, WireValueSchema } from "@repo/wire";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { accountViewChoice } from "../schemas/account-view-choice.js";
import { isWorkspaceMember } from "./workspace-store.js";

type ViewChoiceEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * A view choice to keep: the id its row takes where it is first made in
 * its place, the client's own so it draws the row before the service
 * answers; its key; the workspace it is kept for, or none for the
 * account's own; and its value as JSON, or null to forget it.
 */
export interface ViewChoiceToKeep {
  readonly id: string;
  readonly key: ViewChoiceKey;
  readonly organizationId: string | null;
  readonly value: WireValue;
}

/** One key of one account, in one workspace or in none. */
const PlaceSchema = Schema.Struct({
  userId: Schema.String,
  key: Schema.Literals(Object.values(VIEW_CHOICE_KEY)),
  organizationId: Schema.NullOr(Schema.String),
});

/** The row one account's one key stands in, in its place. */
function placed({ userId, key, organizationId }: typeof PlaceSchema.Type): SQL | undefined {
  return and(
    eq(accountViewChoice.userId, userId),
    eq(accountViewChoice.key, key),
    organizationId === null
      ? isNull(accountViewChoice.organizationId)
      : eq(accountViewChoice.organizationId, organizationId),
  );
}

const updateChoice = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...PlaceSchema.fields, value: WireValueSchema, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ value, now, ...place }) =>
    Database.use((db) =>
      db
        .update(accountViewChoice)
        .set({ value, updatedAt: now })
        .where(placed(place))
        .returning(TXID_RETURNING),
    ),
});

const insertChoice = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...PlaceSchema.fields,
    id: Schema.String,
    value: WireValueSchema,
    now: Schema.Date,
  }),
  Result: TxidRowSchema,
  execute: ({ id, userId, key, organizationId, value, now }) =>
    Database.use((db) =>
      db
        .insert(accountViewChoice)
        .values({ id, userId, key, organizationId, value, updatedAt: now })
        .onConflictDoNothing()
        .returning(TXID_RETURNING),
    ),
});

const deleteChoice = SqlSchema.findOneOption({
  Request: PlaceSchema,
  Result: TxidRowSchema,
  execute: (place) =>
    Database.use((db) =>
      db.delete(accountViewChoice).where(placed(place)).returning(TXID_RETURNING),
    ),
});

/**
 * Keeps one of the account's view choices, writing over the one it kept
 * in the same place, which keeps its own id, or forgets it where `value`
 * is null. Answers the transaction it committed in, with none where
 * forgetting found nothing; none at all where the choice names a workspace
 * the account is not a member of, or where it is first made under an id
 * another row holds, which keeps nothing.
 */
export function writeViewChoice(
  userId: string,
  choice: ViewChoiceToKeep,
): ViewChoiceEffect<Option.Option<ViewChoiceWritten>> {
  const { id, key, organizationId, value } = choice;
  const place = { userId, key, organizationId };

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (organizationId !== null && !(yield* isWorkspaceMember(userId, organizationId))) {
          return Option.none();
        }

        if (value === null) {
          const deleted = yield* deleteChoice(place);

          return Option.some(
            Option.match(deleted, { onNone: () => ({}), onSome: ({ txid }) => ({ txid }) }),
          );
        }

        const now = yield* DateTime.nowAsDate;
        const written = { ...place, value, now };

        // Note that the place is written over before a row is made in it, and again where a row made meanwhile beat this one, so its id stands as first made.
        const kept = yield* updateChoice(written);

        if (Option.isSome(kept)) return kept;
        const made = yield* insertChoice({ ...written, id });

        if (Option.isSome(made)) return made;

        return yield* updateChoice(written);
      }),
    ),
  );
}
