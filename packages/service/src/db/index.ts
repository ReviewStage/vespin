import { attachDatabasePool } from "@vercel/functions";
import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";
import { Pool } from "pg";

/**
 * The variables the database is reached through: the pooled URL both pools
 * are built from, and the unpooled one a connection that must keep its own
 * session, such as Sync's `LISTEN`, is opened on.
 */
export const DATABASE_ENVIRONMENT = {
  URL: "DATABASE_URL",
  UNPOOLED_URL: "DATABASE_URL_UNPOOLED",
} as const;

/**
 * The `sslmode` values `pg-connection-string` (v2) already treats as
 * `verify-full`, and warns it will weaken in v3 / `pg` v9.
 */
const ALIASED_SSL_MODE = /(^|&)sslmode=(?:prefer|require|verify-ca)(?=&|$)/;

/**
 * Says `sslmode=verify-full` where the string says one of the modes `pg` v8
 * already treats as it. Note that this changes no trust: the driver verifies
 * the certificate chain and the host name under all four today, so the
 * rewrite only spells the present behavior out and stops the driver logging
 * its "SECURITY WARNING: The SSL modes…" notice on each process's first
 * connection. A string asking for `uselibpqcompat=true` has chosen libpq's
 * own semantics, which are weaker, so it is left as it is.
 */
function withExplicitSslMode(connectionString: string): string {
  const queryAt = connectionString.indexOf("?");

  if (queryAt === -1) {
    return connectionString;
  }

  const query = connectionString.slice(queryAt + 1);

  if (/(^|&)uselibpqcompat=true(?=&|$)/.test(query)) {
    return connectionString;
  }

  return `${connectionString.slice(0, queryAt + 1)}${query.replace(ALIASED_SSL_MODE, "$1sslmode=verify-full")}`;
}

/** The connection string as one rule reads it: trimmed, and a blank value is absent. */
function connectionStringOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? withExplicitSslMode(trimmed) : undefined;
}

/**
 * The connection string as a `Config`, for the `SqlClient` layer and any
 * other reader on a runtime. It is one reader with `getPool` below: both
 * read `DATABASE_URL` under `connectionStringOf`, so a blank value is absent
 * to both and neither pool can be built where the other refuses. A blank
 * value fails the read the way a missing one does.
 */
export const databaseUrl: Config.Config<Redacted.Redacted> = Config.Redacted(
  DATABASE_ENVIRONMENT.URL,
).pipe(
  Config.mapEffect((url) => {
    const named = connectionStringOf(Redacted.value(url));

    return named === undefined
      ? Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({ message: `${DATABASE_ENVIRONMENT.URL} is blank` }),
          ),
        )
      : Effect.succeed(Redacted.make(named));
  }),
);

/**
 * The unpooled connection string as a `Config`, or none where it is missing
 * or blank, under the same rule `databaseUrl` reads its own by. Note that it
 * is optional, because a function that cannot see it must still boot: Sync's
 * listener stays down without it, and every wait runs on its clock
 * (`sync/hub.ts`).
 */
export const databaseUnpooledUrl: Config.Config<Option.Option<Redacted.Redacted>> = Config.option(
  Config.Redacted(DATABASE_ENVIRONMENT.UNPOOLED_URL),
).pipe(
  Config.map((url) =>
    Option.map(
      Option.flatMap(url, (named) =>
        Option.fromUndefinedOr(connectionStringOf(Redacted.value(named))),
      ),
      Redacted.make,
    ),
  ),
);

/**
 * Connections one function instance may hold per pool. Several requests share
 * an instance under Fluid compute, and with one connection every read, every
 * `Effect.all({ concurrency })` branch and every request queued behind the
 * one in flight. `DATABASE_URL` is Neon's pooled (PgBouncer) endpoint, so a
 * few server-side clients per instance cost the database next to nothing.
 */
const DATABASE_POOL_SIZE = 5;

/** Bounded so one warm function instance cannot monopolize Neon's pooler. */
export const POOL_LIMITS = {
  max: DATABASE_POOL_SIZE,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
} as const;

/**
 * How many connections the process-wide pool keeps open past its idle
 * timeout, once a query has opened them: one, as Vercel's Fluid guidance
 * asks (https://vercel.com/guides/connection-pooling-with-functions). Note
 * that it is kept because this pool is the auth service's
 * (`auth/auth-database.ts`), and a caller the instance resolved a minute
 * ago is asked again of it with every connection closed: 3,820 such asks a
 * day opened a connection first, at p50 41 ms and p95 158 ms, where one with
 * a connection standing took 11 ms and 25 ms. `POOL_LIMITS` stays as the
 * Effect pool reads it (`sql-client.ts`), whose minimum is its own.
 */
const POOL_KEPT_OPEN = 1;

/**
 * Builds a pool for an explicit connection string. Opens nothing: `pg.Pool`
 * connects lazily on first query, which makes this testable offline, and
 * keeps `POOL_KEPT_OPEN` of the connections it opened past the idle timeout.
 *
 * An idle client whose connection the database or the network ends is
 * reported through the pool's `error` event, and Node throws an `error` event
 * nobody listens to: the instance, and every request it was serving under
 * Fluid compute, went down with it (Sentry LUKE-WEB-T). The listener logs it
 * instead, and the pool has already dropped that client, so the next query
 * opens a fresh connection. `attachDatabasePool` is Vercel's guard against the
 * usual cause, a client left idle while the instance is suspended: it keeps
 * the instance up after each release until the idle timeout has closed the
 * pool's idle clients past the one it keeps open. That one may stand through
 * a suspension; a connection the database ended meanwhile is dropped by the
 * listener above, or fails the one statement that finds it, which a caller's
 * resolution answers as unavailable and its client retries.
 */
function createPool(connectionString: string): Pool {
  const created = new Pool({ connectionString, ...POOL_LIMITS, min: POOL_KEPT_OPEN });
  created.on("error", (error) => {
    console.warn(`An idle database client was dropped: ${error.message}`);
  });
  attachDatabasePool(created);

  return created;
}

let pool: Pool | undefined;

/**
 * How many connections the process-wide pool holds, and how many of them
 * stand idle, or none where nothing has built it yet: what a span reads to
 * say whether the statement it waits on had a connection ready
 * (`auth/bearer.ts`). It builds nothing and opens nothing.
 */
export function poolConnections(): { total: number; idle: number } | undefined {
  return pool && { total: pool.totalCount, idle: pool.idleCount };
}

/**
 * The process-wide pool, read from `DATABASE_URL` on first request. Drizzle's
 * node-postgres session calls this synchronously with no fiber to read a
 * `Config` on, so the read is the record's under the same rule
 * `databaseUrl` applies.
 */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = connectionStringOf(process.env[DATABASE_ENVIRONMENT.URL]);

  if (!connectionString) {
    throw new Error(`${DATABASE_ENVIRONMENT.URL} is required to connect to the database.`);
  }

  pool = createPool(connectionString);

  return pool;
}
