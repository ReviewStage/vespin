/**
 * live-pages.ts -- a delta read's whole answer in pages: which builds read them, the page a reader asks for next, and the parent rows each page carries.
 *
 * A whole answer to a busy account is megabytes, which a phone decodes in
 * one stretch on its one JS thread. So a build that reads pages
 * (`readsPages`) is answered one page at a time, newest first: each page is
 * a few of the read's parent rows (a task, an inbox item) with every row of
 * its other parts that rides with them (its agents, its thread), read
 * through the read's own statements narrowed to those parents, so a page
 * keeps the read's rule of who reads it and nothing of the page widens it.
 *
 * A page names the page after it (`PageToken`): the settled id read before
 * the first page, and where the last parent stood in the parents' order,
 * past which the next page reads. Note that it is a bookmark, never a grant:
 * a reader that writes its own reads its own rows in another order, or is
 * answered whole again past an id that no longer stands.
 *
 * The pages need no snapshot in common. Every write below the settled id
 * ended before the first page was read, so each page shows it, and once the
 * reader holds the last page it asks past that id, which answers every
 * write at or past it: a parent that moved into pages already read, one
 * that left (gone), and one that changed. That is the log's own argument
 * (`@repo/database/models/sync-log`).
 */

import type { LiveStatement } from "@repo/database/core/live-statement";
import { liveStatementOf } from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { presentedClient } from "@repo/features/client-identity";
import { ORDER } from "@repo/features/live-read";
import { and, asc, desc, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";

/**
 * The first hosted API version whose builds read a whole answer in pages
 * (`client-identity.ts`'s `HOSTED_API_VERSION`). Note that it stands above
 * every version a build sends today, because no client follows a page yet:
 * a build that takes the first page for the whole answer holds only its
 * newest parents, and the rest never come back to it. The client that
 * learns to follow pages ships at this version.
 */
const PAGED_API_VERSION = 12;

/**
 * The first hosted API version answered a whole answer in pages before any
 * build followed them (#10886): its builds and those up to
 * `PAGED_API_VERSION` took the first page for the whole answer.
 */
const FIRST_PAGE_TAKEN_API_VERSION = 10;

/**
 * The settled id the service stood at once those builds were answered
 * whole again (#11234). A sync id below it may have come with a first page
 * taken for the whole answer; every answer since names one at or past it,
 * so such a build is answered whole once, and past ids after.
 */
const FIRST_PAGES_HEALED_AT = 44_749_068;

/** Which way the parents stand by one of their columns. */
type PageOrder = (typeof ORDER)[keyof typeof ORDER];

/** The page a reader asks for next: the settled id read before the first page, and where the last parent stood, by each column of the parents' order. */
const PageTokenSchema = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  after: Schema.Array(Schema.String),
});

type PageToken = typeof PageTokenSchema.Type;

/** A page token as a reader carries it: its JSON, as base64url, so it reads as one opaque word in a query. */
const PageTokenWord = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PageTokenSchema)),
);

const decodeToken = Schema.decodeUnknownOption(PageTokenWord);

const encodeToken = Schema.encodeSync(PageTokenWord);

/** One page's parents: their keys, and whether it is the first page, which carries what rides with no parent. */
export interface LivePage {
  readonly keys: readonly string[];
  readonly first: boolean;
}

/**
 * How a delta read's whole answer comes in pages: how many parents a page
 * carries, their order, newest first, ending at their key so no two stand
 * alike, the table they are rows of and the reader's rule of which it reads
 * there, and the read's statements narrowed to one page's parents.
 */
export interface LivePageBinding<Params, Statements> {
  readonly size: number;
  readonly order: PageParentOrder;
  parents(params: Params): { readonly table: PgTable; readonly where: SQL };
  statements(params: Params, page: LivePage): Statements;
}

/** The parents' order: each column, and which way they stand by it. */
type PageParentOrder = readonly (readonly [PgColumn, PageOrder])[];

/** What one page's parents read answers: their keys, and the page after it, where more stand. */
interface PageParents {
  readonly keys: readonly string[];
  readonly next: Option.Option<string>;
}

/** Whether the build asking reads a whole answer in pages. */
export function readsPages(request: Request): boolean {
  const client = presentedClient(request.headers);

  return client !== undefined && client.apiVersion >= PAGED_API_VERSION;
}

/**
 * Whether the build asking may hold a read's first page for its whole
 * answer, past `past`: a build at a version answered pages it never
 * followed, reading past a sync id from before those pages stopped, which
 * is answered whole once so the parents past that page come back to it.
 */
export function mayHoldFirstPage(request: Request, past: number): boolean {
  const client = presentedClient(request.headers);

  return (
    client !== undefined &&
    client.apiVersion >= FIRST_PAGE_TAKEN_API_VERSION &&
    client.apiVersion < PAGED_API_VERSION &&
    past < FIRST_PAGES_HEALED_AT
  );
}

/** The page a reader names, read; refused as invalid where it does not read as one. */
export function pageTokenOf(word: string): Effect.Effect<PageToken, HostedRefusal> {
  return Option.match(decodeToken(word), {
    onNone: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
    onSome: Effect.succeed,
  });
}

/**
 * The rows past where the last page's parent stood in the order, as a
 * keyset compares them: past it by the first column, or alike there and
 * past it by the next, and so on. Note that each value is bound as the
 * text Postgres read it as (`parentsStatement`), which Postgres reads back
 * as its column's type, so an instant keeps its microseconds.
 */
function pastOf(order: PageParentOrder, after: readonly string[]): SQL {
  const past = order.map(([column, way], at) => {
    const alike = order.slice(0, at).map(([earlier], index) => sql`${earlier} = ${after[index]}`);

    const beyond =
      way === ORDER.DESC ? sql`${column} < ${after[at]}` : sql`${column} > ${after[at]}`;

    return and(...alike, beyond);
  });

  return or(...past) ?? sql`true`;
}

/** The statement reading one page's parents: each column of their order as text, past `after` where it names a parent, in the order, one more than a page holds, so a page that leaves more is told by its length. */
function parentsStatement<Params>(
  binding: LivePageBinding<Params, unknown>,
  params: Params,
  after: readonly string[] | undefined,
): Option.Option<LiveStatement> {
  const { table, where } = binding.parents(params);

  const selection = Object.fromEntries(
    binding.order.map(([column], at) => [`o${at}`, sql<string>`${column}::text`.as(`o${at}`)]),
  );

  const ordered = binding.order.map(([column, way]) =>
    way === ORDER.DESC ? desc(column) : asc(column),
  );

  return liveStatementOf(
    queryBuilder
      .select(selection)
      .from(table)
      .where(and(where, after === undefined ? undefined : pastOf(binding.order, after)))
      .orderBy(...ordered)
      .limit(binding.size + 1),
  );
}

/**
 * One page's parents, past where `token` says the last page's stood, or
 * from the first where it names none, with the page after it where more
 * stand; unavailable where they could not be read. A token whose position
 * names another count of columns than the order is refused as invalid.
 */
export const pageParents = /* @__PURE__ */ Effect.fnUntraced(function* <Params>(
  binding: LivePageBinding<Params, unknown>,
  params: Params,
  at: number,
  after: readonly string[] | undefined,
): Effect.fn.Return<PageParents, HostedRefusal, SqlClient.SqlClient> {
  if (after !== undefined && after.length !== binding.order.length) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  const statement = parentsStatement(binding, params, after);

  if (Option.isNone(statement)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql
    .unsafe<Readonly<Record<string, string>>>(statement.value.sql, statement.value.params)
    .pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));

  const page = rows.slice(0, binding.size);
  const last = page.at(-1);
  const key = `o${binding.order.length - 1}`;
  const keys = page.map((row) => row[key] ?? "");

  const next =
    rows.length > binding.size && last !== undefined
      ? Option.some(
          encodeToken({
            at,
            after: binding.order.map((_column, index) => last[`o${index}`] ?? ""),
          }),
        )
      : Option.none();

  return { keys, next };
});
