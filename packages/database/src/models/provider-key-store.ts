import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@repo/features/provider-key-wire";
import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type DatabaseShape } from "../core/query.js";
import { accountProviderKey } from "../schemas/account-provider-key.js";
import { InstantColumnSchema } from "./columns.js";
import type { SealedProviderKey } from "./provider-key-seal.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";

/**
 * provider-key-store.ts -- the rows of an account's own provider keys, sealed as `provider-key-seal.ts` seals them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads, replaces, or removes another's key. What
 * goes in and out is sealed: this module never sees a key in the clear,
 * and a row read here is opened by its caller with the ring the
 * environment holds. A save of an API key replaces the provider's one API
 * key whole, as a new key added now and verified now, since a key is saved
 * only once its provider accepted it, with whether its organization may run
 * fast mode as the save's own fast request found it. A subscription
 * credential is a row of its own kind, saved unverified, since no provider
 * is asked about it before an agent runs on it, and an account holds as
 * many of a kind as it adds, each its own id, in the account's order. A
 * call that names a subscription by its id reaches that one; one that names
 * none reaches the first of its kind in that order, which is the one every
 * agent runs on until a turn chooses among them. A status is written
 * against the sealed key a step ran on, so a step on a key since replaced
 * marks nothing of its successor.
 *
 * A ChatGPT plan is a row of its own kind whose seal holds its tokens and
 * whose `access_expires_at` says when its access token lapses. Its renewal
 * runs under the row's lock (`withProviderKeyLocked`) and reseals the row in
 * place, so two renewals of one plan run one after the other and the
 * second reads what the first wrote.
 */

const ProviderSchema = Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

const FastAccessSchema = Schema.Literals(Object.values(FAST_ACCESS));

const KindSchema = Schema.Literals(Object.values(PROVIDER_KEY_KIND));

const SealedRowSchema = Schema.Struct({
  id: Schema.String,
  provider: ProviderSchema,
  kind: KindSchema,
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedKey: Schema.String,
  hint: Schema.String,
  status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  statusAt: InstantColumnSchema,
  fastAccess: Schema.NullOr(FastAccessSchema),
  accessExpiresAt: Schema.NullOr(InstantColumnSchema),
  forAgents: Schema.Boolean,
  limitResetsAt: Schema.NullOr(InstantColumnSchema),
  position: Schema.Int,
  label: Schema.NullOr(Schema.String),
  accountEmail: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

/** One stored key as its row holds it: sealed, beside what the account is shown of it. */
export type ProviderKeyRow = typeof SealedRowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...SealedRowSchema.fields });

/** One stored key with its account, for the rewrap that walks every row. */
export type OwnedProviderKeyRow = typeof OwnedRowSchema.Type;

const KeySchema = Schema.Struct({ userId: Schema.String, provider: ProviderSchema });

const KindKeySchema = Schema.Struct({ ...KeySchema.fields, kind: KindSchema });

/** One row of the account's: the subscription of this id, or the first of its kind where none is named. */
const TargetSchema = Schema.Struct({
  ...KindKeySchema.fields,
  subscriptionId: Schema.optionalKey(Schema.String),
});

const ROW_COLUMNS = {
  id: accountProviderKey.id,
  provider: accountProviderKey.provider,
  kind: accountProviderKey.kind,
  keyVersion: accountProviderKey.keyVersion,
  sealedDataKey: accountProviderKey.sealedDataKey,
  sealedKey: accountProviderKey.sealedKey,
  hint: accountProviderKey.hint,
  status: accountProviderKey.status,
  statusAt: accountProviderKey.statusAt,
  fastAccess: accountProviderKey.fastAccess,
  accessExpiresAt: accountProviderKey.accessExpiresAt,
  forAgents: accountProviderKey.forAgents,
  limitResetsAt: accountProviderKey.limitResetsAt,
  position: accountProviderKey.position,
  label: accountProviderKey.label,
  accountEmail: accountProviderKey.accountEmail,
  createdAt: accountProviderKey.createdAt,
} as const;

/** The account's rows of the provider's kind, in the account's order. */
const ofKind = (key: typeof KindKeySchema.Type) =>
  and(
    eq(accountProviderKey.userId, key.userId),
    eq(accountProviderKey.provider, key.provider),
    eq(accountProviderKey.kind, key.kind),
  );

/** Where a statement finds the one row a target names, the first of its kind's order where it names no id. */
const targetRow = (db: DatabaseShape, target: typeof TargetSchema.Type) =>
  and(
    ofKind(target),
    target.subscriptionId === undefined
      ? inArray(
          accountProviderKey.id,
          db
            .select({ id: accountProviderKey.id })
            .from(accountProviderKey)
            .where(ofKind(target))
            .orderBy(asc(accountProviderKey.position), asc(accountProviderKey.createdAt))
            .limit(1),
        )
      : eq(accountProviderKey.id, target.subscriptionId),
  );

const findRows = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, kind: KindSchema }),
  Result: SealedRowSchema,
  execute: (read) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountProviderKey)
        .where(
          and(eq(accountProviderKey.userId, read.userId), eq(accountProviderKey.kind, read.kind)),
        )
        .orderBy(
          asc(accountProviderKey.provider),
          asc(accountProviderKey.position),
          asc(accountProviderKey.createdAt),
        ),
    ),
});

const findAccountRows = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: SealedRowSchema,
  execute: (read) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountProviderKey)
        .where(eq(accountProviderKey.userId, read.userId))
        .orderBy(
          asc(accountProviderKey.provider),
          asc(accountProviderKey.kind),
          asc(accountProviderKey.position),
          asc(accountProviderKey.createdAt),
        ),
    ),
});

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({ userId: accountProviderKey.userId, ...ROW_COLUMNS })
        .from(accountProviderKey)
        .orderBy(
          asc(accountProviderKey.userId),
          asc(accountProviderKey.provider),
          asc(accountProviderKey.kind),
          asc(accountProviderKey.position),
        ),
    ),
});

/** A credential as a save writes it, whichever row it lands on. */
const SavedSchema = Schema.Struct({
  ...KindKeySchema.fields,
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedKey: Schema.String,
  hint: Schema.String,
  fastAccess: Schema.NullOr(FastAccessSchema),
  accessExpiresAt: Schema.NullOr(Schema.Date),
  now: Schema.Date,
});

/**
 * The columns a save writes, as the credential added now. Note that
 * `forAgents`, `position`, and `label` are left out, because a new row takes
 * their defaults and a replaced credential keeps the choices the account
 * made for the one before it.
 */
const savedColumns = (write: typeof SavedSchema.Type) => ({
  keyVersion: write.keyVersion,
  sealedDataKey: write.sealedDataKey,
  sealedKey: write.sealedKey,
  hint: write.hint,
  // An API key is kept only once its provider accepted it; a subscription credential is kept unasked.
  status:
    write.kind === PROVIDER_KEY_KIND.API_KEY
      ? PROVIDER_KEY_STATUS.VERIFIED
      : PROVIDER_KEY_STATUS.UNVERIFIED,
  statusAt: write.now,
  fastAccess: write.fastAccess,
  accessExpiresAt: write.accessExpiresAt,
  limitResetsAt: null,
  createdAt: write.now,
});

const IdSchema = Schema.Struct({ id: Schema.String });

/** The provider's one API key written, or written over the one it held. */
const upsertApiKey = SqlSchema.findOne({
  Request: SavedSchema,
  Result: IdSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(accountProviderKey)
        .values({
          userId: write.userId,
          provider: write.provider,
          kind: write.kind,
          ...savedColumns(write),
        })
        .onConflictDoUpdate({
          target: [accountProviderKey.userId, accountProviderKey.provider],
          targetWhere: eq(accountProviderKey.kind, PROVIDER_KEY_KIND.API_KEY),
          set: savedColumns(write),
        })
        .returning({ id: accountProviderKey.id }),
    ),
});

/** The account's subscriptions of a kind, locked, in its order: what a save chooses the row it lands on from. */
const lockKindRows = SqlSchema.findAll({
  Request: KindKeySchema,
  Result: Schema.Struct({
    id: Schema.String,
    position: Schema.Int,
    accountEmail: Schema.NullOr(Schema.String),
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          id: accountProviderKey.id,
          position: accountProviderKey.position,
          accountEmail: accountProviderKey.accountEmail,
        })
        .from(accountProviderKey)
        .where(ofKind(key))
        .orderBy(asc(accountProviderKey.position), asc(accountProviderKey.createdAt))
        .for("update"),
    ),
});

const PlacedSchema = Schema.Struct({
  ...SavedSchema.fields,
  accountEmail: Schema.NullOr(Schema.String),
  label: Schema.optionalKey(Schema.String),
});

const insertSubscription = SqlSchema.findOne({
  Request: Schema.Struct({ ...PlacedSchema.fields, position: Schema.Int }),
  Result: IdSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(accountProviderKey)
        .values({
          userId: write.userId,
          provider: write.provider,
          kind: write.kind,
          position: write.position,
          label: write.label ?? null,
          accountEmail: write.accountEmail,
          ...savedColumns(write),
        })
        .returning({ id: accountProviderKey.id }),
    ),
});

const overwriteSubscription = SqlSchema.void({
  Request: Schema.Struct({ ...PlacedSchema.fields, id: Schema.String }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({
          ...savedColumns(write),
          accountEmail: write.accountEmail,
          ...(write.label === undefined ? undefined : { label: write.label }),
        })
        .where(
          and(eq(accountProviderKey.userId, write.userId), eq(accountProviderKey.id, write.id)),
        ),
    ),
});

const lockRow = SqlSchema.findAll({
  Request: TargetSchema,
  Result: SealedRowSchema,
  execute: (target) =>
    Database.use((db) =>
      db.select(ROW_COLUMNS).from(accountProviderKey).where(targetRow(db, target)).for("update"),
    ),
});

/** The row's seal and expiry replaced where it still holds the seal it was read with. */
const resealRow = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    fromSealedKey: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedKey: Schema.String,
    accessExpiresAt: Schema.NullOr(Schema.Date),
  }),
  Result: IdSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({
          keyVersion: write.keyVersion,
          sealedDataKey: write.sealedDataKey,
          sealedKey: write.sealedKey,
          accessExpiresAt: write.accessExpiresAt,
        })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.id, write.id),
            eq(accountProviderKey.sealedKey, write.fromSealedKey),
          ),
        )
        .returning({ id: accountProviderKey.id }),
    ),
});

const deleteRow = SqlSchema.void({
  Request: TargetSchema,
  execute: (target) =>
    Database.use((db) => db.delete(accountProviderKey).where(targetRow(db, target))),
});

const updateStatus = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    sealedKey: Schema.String,
    status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ status: write.status, statusAt: write.now, limitResetsAt: null })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        ),
    ),
});

/** The statuses an agent's turn may write on its plan's row, as `setPlanStatus` says. */
const PlanStatusSchema = Schema.Literals([
  PROVIDER_KEY_STATUS.VERIFIED,
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.LIMIT_REACHED,
  PROVIDER_KEY_STATUS.INELIGIBLE,
]);

/** A plan's status as a turn found it, on whatever credential the row holds now, as `setPlanStatus` bounds it. */
const updatePlanStatus = SqlSchema.void({
  Request: Schema.Struct({
    ...TargetSchema.fields,
    status: PlanStatusSchema,
    limitResetsAt: Schema.NullOr(Schema.Date),
    savedBy: Schema.Date,
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ status: write.status, statusAt: write.now, limitResetsAt: write.limitResetsAt })
        .where(
          and(
            targetRow(db, write),
            ne(accountProviderKey.status, PROVIDER_KEY_STATUS.UNREADABLE),
            lte(accountProviderKey.createdAt, write.savedBy),
            ...(write.status === PROVIDER_KEY_STATUS.VERIFIED
              ? [
                  ne(accountProviderKey.status, PROVIDER_KEY_STATUS.VERIFIED),
                  ne(accountProviderKey.status, PROVIDER_KEY_STATUS.INVALID),
                ]
              : []),
          ),
        ),
    ),
});

const updateFastAccess = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    sealedKey: Schema.String,
    fastAccess: FastAccessSchema,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ fastAccess: write.fastAccess })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        ),
    ),
});

const updateForAgents = SqlSchema.findAll({
  Request: Schema.Struct({ ...TargetSchema.fields, forAgents: Schema.Boolean }),
  Result: IdSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ forAgents: write.forAgents })
        .where(targetRow(db, write))
        .returning({ id: accountProviderKey.id }),
    ),
});

const updateLabel = SqlSchema.void({
  Request: Schema.Struct({
    ...TargetSchema.fields,
    subscriptionId: Schema.String,
    label: Schema.NullOr(Schema.String),
  }),
  execute: (write) =>
    Database.use((db) =>
      db.update(accountProviderKey).set({ label: write.label }).where(targetRow(db, write)),
    ),
});

const updatePosition = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, id: Schema.String, position: Schema.Int }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ position: write.position })
        .where(
          and(eq(accountProviderKey.userId, write.userId), eq(accountProviderKey.id, write.id)),
        ),
    ),
});

/** The wrap moved only where the row still holds the seal it was read with, so a key replaced meanwhile keeps its own. */
const rewrapRow = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    id: Schema.String,
    fromVersion: Schema.Int,
    sealedKey: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
  }),
  Result: IdSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ keyVersion: write.keyVersion, sealedDataKey: write.sealedDataKey })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.id, write.id),
            eq(accountProviderKey.keyVersion, write.fromVersion),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        )
        .returning({ id: accountProviderKey.id }),
    ),
});

/** The account's stored keys of one kind, sealed, in the providers' order. */
export function listProviderKeyRows(
  userId: string,
  kind: ProviderKeyKind,
): TaskStoreEffect<readonly ProviderKeyRow[]> {
  return findRows({ userId, kind });
}

/**
 * The account's stored keys of every kind, sealed, in the providers' order,
 * in one statement: what a request that decides several things from them,
 * such as a Start's model menu and its payer, reads once.
 */
export function listAccountProviderKeyRows(
  userId: string,
): TaskStoreEffect<readonly ProviderKeyRow[]> {
  return findAccountRows({ userId });
}

/** Which subscription a save of one lands on; an API key's save names none, since a provider holds one. */
export interface SubscriptionPlacement {
  /** The subscription to replace, by its id; one the account no longer holds is added at the bottom instead. */
  readonly subscriptionId?: string;
  /** Whether to add it at the bottom of the account's order rather than replace the first of its kind. */
  readonly add?: boolean;
  /** The account a ChatGPT subscription signed in as: a stored subscription signed in as it is replaced, whatever else the save names. */
  readonly accountEmail?: string;
  /** The name the account gives it; a replaced subscription keeps its own where none is given. */
  readonly label?: string;
}

/** The id of the row a subscription's save replaces among the account's rows of its kind, in order, or none where it adds one. */
function landingOf(
  rows: readonly { readonly id: string; readonly accountEmail: string | null }[],
  placement: SubscriptionPlacement,
): string | undefined {
  const signedInAs = rows.find(
    (row) => placement.accountEmail !== undefined && row.accountEmail === placement.accountEmail,
  );
  if (signedInAs !== undefined) return signedInAs.id;
  if (placement.subscriptionId !== undefined) {
    return rows.find((row) => row.id === placement.subscriptionId)?.id;
  }
  return placement.add === true ? undefined : rows[0]?.id;
}

/**
 * Keeps a credential for the account as added now, an API key verified, a
 * subscription credential unverified, with its fast access where the save
 * found it, and answers the id of the row it landed on. An API key replaces
 * the provider's one API key. A subscription replaces the one `placement`
 * names, as `landingOf` reads it: by default the first of its kind, so a
 * caller that names none replaces the one agents run on, and is added at
 * the bottom of the account's order where it names none to replace or adds.
 * The provider's credentials of another kind stay as they are.
 */
export function saveProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  sealed: SealedProviderKey,
  hint: string,
  fastAccess: FastAccess | null,
  now: Date,
  accessExpiresAt: Date | null = null,
  placement: SubscriptionPlacement = {},
): TaskStoreEffect<string> {
  const write = { userId, provider, kind, ...sealed, hint, fastAccess, accessExpiresAt, now };
  if (kind === PROVIDER_KEY_KIND.API_KEY) {
    return Effect.map(
      upsertApiKey(write).pipe(
        // An upsert that returned no row is the database breaking its own contract, not an outcome.
        Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
      ),
      (row) => row.id,
    );
  }
  const placed = {
    ...write,
    accountEmail: placement.accountEmail ?? null,
    ...(placement.label === undefined ? undefined : { label: placement.label }),
  };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const rows = yield* lockKindRows({ userId, provider, kind });
        const id = landingOf(rows, placement);
        if (id !== undefined) {
          yield* overwriteSubscription({ ...placed, id });
          return id;
        }
        const position = Math.max(-1, ...rows.map((row) => row.position)) + 1;
        return (yield* insertSubscription({ ...placed, position }).pipe(
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        )).id;
      }),
    ),
  );
}

/**
 * Runs `body` on the account's credential of this kind, the subscription of
 * this id or the first of its kind where none is named, or on none where it
 * holds none, in one transaction with its row locked, so two renewals of one
 * credential run one after the other and the second reads what the first
 * wrote.
 */
export function withProviderKeyLocked<A, E, R>(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  subscriptionId: string | undefined,
  body: (row: Option.Option<ProviderKeyRow>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  const target = {
    userId,
    provider,
    kind,
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
  };
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.flatMap(lockRow(target), (rows) => body(Option.fromNullishOr(rows[0]))),
    ),
  );
}

/**
 * Replaces the seal of the account's credential of this id and when its
 * access lapses, together, where the row still holds the seal it was read
 * with; answers whether it did. Its status and when it was added stand.
 */
export function resealProviderKey(
  userId: string,
  subscriptionId: string,
  fromSealedKey: string,
  sealed: SealedProviderKey,
  accessExpiresAt: Date | null,
): TaskStoreEffect<boolean> {
  return Effect.map(
    resealRow({ userId, id: subscriptionId, fromSealedKey, ...sealed, accessExpiresAt }),
    (moved) => moved.length > 0,
  );
}

/**
 * Removes the provider's credential of this kind from the account, the
 * subscription of this id or the first of its kind where none is named;
 * removing one it does not hold moves nothing. Note that the subscriptions
 * after it keep their positions, since only their order is read.
 */
export function removeProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  subscriptionId?: string,
): TaskStoreEffect<void> {
  return deleteRow({
    userId,
    provider,
    kind,
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
  });
}

/**
 * Turns the account's default payer for its coding agents on or off for the
 * provider's credential of this kind, the subscription of this id or the
 * first of its kind where none is named; whether a row held it, since a
 * credential disconnected meanwhile has no default to turn.
 */
export function setProviderKeyForAgents(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  forAgents: boolean,
  subscriptionId?: string,
): TaskStoreEffect<boolean> {
  return Effect.map(
    updateForAgents({
      userId,
      provider,
      kind,
      forAgents,
      ...(subscriptionId === undefined ? {} : { subscriptionId }),
    }),
    (rows) => rows.length > 0,
  );
}

/**
 * Names the account's subscription of this kind and id, or clears its name
 * where `label` is null, so it is shown by its default again; naming one it
 * does not hold moves nothing.
 */
export function setSubscriptionLabel(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  subscriptionId: string,
  label: string | null,
): TaskStoreEffect<void> {
  return updateLabel({ userId, provider, kind, subscriptionId, label });
}

/**
 * Puts the account's subscriptions of a kind in the order `ids` names, the
 * first paying first, under the kind's rows' locks. An id the account does
 * not hold is passed over, and a subscription the order leaves out, such as
 * one added meanwhile, keeps its place after those named.
 */
export function reorderSubscriptions(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  ids: readonly string[],
): TaskStoreEffect<void> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const rows = yield* lockKindRows({ userId, provider, kind });
        const held = new Set(rows.map((row) => row.id));
        const named = ids.filter((id) => held.has(id));
        const left = rows.map((row) => row.id).filter((id) => !named.includes(id));
        const ordered = [...named, ...left];
        for (const [position, id] of ordered.entries()) {
          if (rows.find((row) => row.id === id)?.position === position) continue;
          yield* updatePosition({ userId, id, position });
        }
      }),
    ),
  );
}

/** Writes how the provider last answered the key a step ran on, where the row still holds that key. */
export function setProviderKeyStatus(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  status: ProviderKeyStatus,
  now: Date,
): TaskStoreEffect<void> {
  return updateStatus({ userId, provider, sealedKey, status, now });
}

/** A status a coding agent's turn found its plan in. */
export type PlanStatus = typeof PlanStatusSchema.Type;

/**
 * Writes how the provider answered a coding agent's turn on the account's
 * plan of this kind, the subscription of this id or the first of its kind
 * where none is named, with when its reached limit resets where it said.
 * `savedBy` is when the turn opened: a credential saved after it, as a
 * reconnect saves one, ran none of it and is not judged by it.
 * Note that a row the service cannot read keeps saying so, since only a new
 * credential mends it; that a turn that ran is no word against a renewal
 * that found the sign-in ended, so verified never lifts invalid; and that a
 * plan already verified is not written again, so every turn's success
 * costs no write.
 */
export function setPlanStatus(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  status: PlanStatus,
  limitResetsAt: Date | undefined,
  savedBy: Date,
  now: Date,
  subscriptionId?: string,
): TaskStoreEffect<void> {
  return updatePlanStatus({
    userId,
    provider,
    kind,
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
    status,
    limitResetsAt: status === PROVIDER_KEY_STATUS.LIMIT_REACHED ? (limitResetsAt ?? null) : null,
    savedBy,
    now,
  });
}

/** Writes what a fast call on the key a step ran on showed of its organization, where the row still holds that key. */
export function setProviderKeyFastAccess(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  fastAccess: FastAccess,
): TaskStoreEffect<void> {
  return updateFastAccess({ userId, provider, sealedKey, fastAccess });
}

/** Every stored key of every account, sealed, for the rewrap alone. */
export function listEveryProviderKeyRow(): TaskStoreEffect<readonly OwnedProviderKeyRow[]> {
  return findEveryRow(undefined);
}

/**
 * Moves one row onto a new wrap of its data key, and answers whether it
 * did: not where the row was replaced or rewrapped since it was read.
 */
export function rewrapProviderKeyRow(
  row: OwnedProviderKeyRow,
  rewrapped: SealedProviderKey,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapRow({
      userId: row.userId,
      id: row.id,
      fromVersion: row.keyVersion,
      sealedKey: row.sealedKey,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}
