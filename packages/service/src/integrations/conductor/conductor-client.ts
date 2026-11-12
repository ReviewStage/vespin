/**
 * conductor-client.ts -- the reads of Conductor's public API that a Conductor import makes: the key's identity, its projects, workspaces, chats, and each chat's stored messages.
 *
 * Conductor's API (`https://api.conductor.build/v0`, contract at
 * `/v0/openapi.json`) is marked experimental, so every read decodes only the
 * fields the import uses and fails with a typed reason, never a defect: a
 * refused key, a missing workspace or chat, a rate limit, no answer, or an
 * answer of a shape this build does not read. A caller runs one read per
 * workspace or chat, so one that fails stops nothing else.
 *
 * Only reads live here: the import never changes anything on Conductor.
 * `/v0/sql` is not used; it answered "temporarily disabled" on Nov 12, 2026,
 * and the paged messages endpoint is the documented transcript read.
 *
 * The key is a `Redacted` handed to every call and sent only as the bearer
 * of the request. It is never logged, traced, kept, or put in a failure: a
 * failure carries its reason and the status alone, and a transport error's
 * cause is dropped unread, since it may quote the request. `GET /me` echoes
 * the key back in its body (`apiKey`), so its answer is decoded into a schema
 * that leaves that field out and is never kept whole.
 */

import { WireValueSchema } from "@repo/wire";
import { Data, Duration, Effect, flow, type Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/** Conductor's API, where every read is made. */
const CONDUCTOR_API_URL = "https://api.conductor.build";

/** How long one request may take before it counts as no answer. */
const CALL_TIMEOUT = Duration.seconds(30);

/**
 * The page size the listings ask for. The messages endpoint answers at most
 * 100 a page whatever `limit` asks, so asking for more would buy nothing.
 */
const PAGE_SIZE = 100;

/**
 * How many pages one walk reads before it gives up on an answer that never
 * says it ended: 100,000 records at `PAGE_SIZE`, past the longest chat seen
 * (8,622 messages).
 */
const MAXIMUM_PAGES = 1000;

/** The statuses whose meaning a read names; any other failure status is `UNAVAILABLE`. */
const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
} as const;

/** The query parameters the reads send, as the API documents them. */
const QUERY = {
  INCLUDE_ARCHIVED: "includeArchived",
  LIMIT: "limit",
  OFFSET: "offset",
} as const;

/** The stored message kinds the import reads; a record of any other kind is left out. */
export const CONDUCTOR_MESSAGE_TYPE = {
  USER_MESSAGE: "userMessage",
  AGENT: "agent",
} as const;

/** Why a read of Conductor failed. */
export const CONDUCTOR_READ_FAILURE = {
  /** The key was refused (401 or 403). */
  BAD_KEY: "bad-key",
  /** The workspace or chat asked for is not there (404). */
  NOT_FOUND: "not-found",
  /** Conductor asked us to slow down (429). */
  RATE_LIMITED: "rate-limited",
  /** No answer within `CALL_TIMEOUT`, a transport error, or another failure status. */
  UNAVAILABLE: "unavailable",
  /** An answer this build does not read, or a walk that never ended. */
  UNREADABLE: "unreadable",
} as const;

export type ConductorReadFailure =
  (typeof CONDUCTOR_READ_FAILURE)[keyof typeof CONDUCTOR_READ_FAILURE];

/** A read that failed, with why and, where Conductor answered, its status; never the key or the answer's words. */
export class ConductorReadFailed extends Data.TaggedError("ConductorReadFailed")<{
  readonly reason: ConductorReadFailure;
  readonly status?: number;
}> {}

const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));

/**
 * What `GET /me` answers that the import reads. Note that the answer also
 * echoes the key itself as `apiKey`; this schema leaves it out, so decoding
 * drops it.
 */
const ConductorIdentitySchema = Schema.Struct({
  userId: Schema.String,
  organizationId: OptionalText,
  organizationName: OptionalText,
  authMethod: OptionalText,
});

const ConductorProjectSchema = Schema.Struct({
  id: Schema.String,
  name: OptionalText,
  gitRemote: OptionalText,
});

/** A workspace; `state` is Conductor's own word for where it stands (`archived`, `ready`, `sleeping`, and others). */
export const ConductorWorkspaceSchema = Schema.Struct({
  id: Schema.String,
  name: OptionalText,
  number: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  state: Schema.String,
  repoUrl: OptionalText,
  creatorId: OptionalText,
  creatorName: OptionalText,
  createdAt: OptionalText,
  lastActivityAt: OptionalText,
  deepLink: OptionalText,
});

/** A chat (Conductor's session); `archivedAt` is set where it was archived. */
export const ConductorChatSchema = Schema.Struct({
  id: Schema.String,
  name: OptionalText,
  model: OptionalText,
  resolvedModel: OptionalText,
  effort: OptionalText,
  archivedAt: OptionalText,
});

/** The developer's own message: its words, and the harness (`claude` or `codex`) and model it was sent to. */
const ConductorUserMessageSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal(CONDUCTOR_MESSAGE_TYPE.USER_MESSAGE),
  receivedAt: Schema.String,
  content: Schema.Struct({
    message: Schema.String,
    config: Schema.optionalKey(
      Schema.Struct({
        harness: OptionalText,
        model: OptionalText,
      }),
    ),
  }),
});

/** An event the chat's harness emitted, kept whole in `rawPayload` for the transcript reader. */
const ConductorAgentMessageSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal(CONDUCTOR_MESSAGE_TYPE.AGENT),
  receivedAt: Schema.String,
  content: Schema.Struct({ rawPayload: WireValueSchema }),
});

const ConductorMessageSchema = Schema.Union([
  ConductorUserMessageSchema,
  ConductorAgentMessageSchema,
]);

export type ConductorWorkspace = typeof ConductorWorkspaceSchema.Type;

export type ConductorChat = typeof ConductorChatSchema.Type;

export type ConductorUserMessage = typeof ConductorUserMessageSchema.Type;

export type ConductorAgentMessage = typeof ConductorAgentMessageSchema.Type;

export type ConductorMessage = typeof ConductorMessageSchema.Type;

/** One stored record before its kind is known, so a kind this build does not read is left out rather than failing the chat. */
const StoredRecordSchema = Schema.Struct({ type: Schema.String });

const KNOWN_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(CONDUCTOR_MESSAGE_TYPE));

/** One page of a listing, as every paged endpoint answers it. */
const PageSchema = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  hasMore: Schema.Boolean,
});

/** The failure a status other than success names. */
function failureOf(status: number): ConductorReadFailed {
  switch (status) {
    case HTTP_STATUS.UNAUTHORIZED:
    case HTTP_STATUS.FORBIDDEN:
      return new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.BAD_KEY, status });
    case HTTP_STATUS.NOT_FOUND:
      return new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.NOT_FOUND, status });
    case HTTP_STATUS.TOO_MANY_REQUESTS:
      return new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.RATE_LIMITED, status });
    default:
      return new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.UNAVAILABLE, status });
  }
}

const unreadable = () => new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.UNREADABLE });

/** Decodes an answer, failing as `UNREADABLE` without the decoder's words, which may quote the answer. */
function decoded<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) {
  return flow(Schema.decodeUnknownEffect(schema), Effect.mapError(unreadable));
}

/** `GET` of the path's segments, each escaped, with the query given; the body as JSON, or why there is none. */
const getJson = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
  segments: readonly string[],
  query: Record<string, string | number | boolean>,
) {
  const client = yield* HttpClient.HttpClient;

  const path = segments.map(encodeURIComponent).join("/");

  const request = HttpClientRequest.get(`${CONDUCTOR_API_URL}/${path}`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(key),
    HttpClientRequest.setUrlParams(query),
  );

  return yield* client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? Effect.mapError(response.json, unreadable)
        : Effect.fail(failureOf(response.status)),
    ),
    Effect.scoped,
    Effect.timeout(CALL_TIMEOUT),
    // Note that a transport error or timeout is dropped unread, since its cause may quote the request and its key.
    Effect.catch((error) =>
      error instanceof ConductorReadFailed
        ? Effect.fail(error)
        : Effect.fail(new ConductorReadFailed({ reason: CONDUCTOR_READ_FAILURE.UNAVAILABLE })),
    ),
  );
});

/**
 * Every item of a paged listing, walked by `offset` until a page says there
 * is no more or comes back empty. The next offset is the count read so far,
 * so a page shorter than `limit` (the messages endpoint caps at 100) is
 * never skipped past.
 */
const readAllPages = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
  segments: readonly string[],
  query: Record<string, string | number | boolean>,
) {
  const items: unknown[] = [];

  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const body = yield* getJson(key, segments, {
      ...query,
      [QUERY.LIMIT]: PAGE_SIZE,
      [QUERY.OFFSET]: items.length,
    });

    const { data, hasMore } = yield* decoded(PageSchema)(body);
    items.push(...data);

    if (!hasMore || data.length === 0) return items;
  }

  return yield* unreadable();
});

/** Checks the key and answers who it is; the key `/me` echoes back is dropped in decoding. */
export const readConductorIdentity = Effect.fnUntraced(function* (key: Redacted.Redacted<string>) {
  const body = yield* getJson(key, ["me"], {});

  return yield* decoded(ConductorIdentitySchema)(body);
});

/** Every project the key sees. */
export const listConductorProjects = Effect.fnUntraced(function* (key: Redacted.Redacted<string>) {
  const items = yield* readAllPages(key, ["v0", "projects"], {});

  return yield* decoded(Schema.Array(ConductorProjectSchema))(items);
});

/** Every workspace the key sees, archived included. */
export const listConductorWorkspaces = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
) {
  const items = yield* readAllPages(key, ["v0", "workspaces"], { [QUERY.INCLUDE_ARCHIVED]: true });

  return yield* decoded(Schema.Array(ConductorWorkspaceSchema))(items);
});

/** Every chat of one workspace, archived included. */
export const listConductorChats = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
  workspaceId: string,
) {
  const items = yield* readAllPages(key, ["v0", "workspaces", workspaceId, "sessions"], {
    [QUERY.INCLUDE_ARCHIVED]: true,
  });

  return yield* decoded(Schema.Array(ConductorChatSchema))(items);
});

/**
 * One chat's whole stored transcript, oldest first, as Conductor stores it:
 * the developer's messages and the harness's events, each whole. A record of
 * a kind this build does not read is left out; one of a known kind in a shape
 * it does not read fails the chat.
 */
export const readConductorMessages = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
  chatId: string,
) {
  const items = yield* readAllPages(key, ["v0", "sessions", chatId, "messages"], {});
  const records = yield* decoded(Schema.Array(StoredRecordSchema))(items);
  const known = items.filter((_, index) => KNOWN_MESSAGE_TYPES.has(records[index]?.type ?? ""));

  return yield* decoded(Schema.Array(ConductorMessageSchema))(known);
});

/**
 * A chat's first stored page, oldest first, read as `readConductorMessages`
 * reads every page: enough for its first message without walking a chat
 * that may hold thousands.
 */
export const readConductorFirstMessages = Effect.fnUntraced(function* (
  key: Redacted.Redacted<string>,
  chatId: string,
) {
  const body = yield* getJson(key, ["v0", "sessions", chatId, "messages"], {
    [QUERY.LIMIT]: PAGE_SIZE,
    [QUERY.OFFSET]: 0,
  });

  const { data } = yield* decoded(PageSchema)(body);
  const records = yield* decoded(Schema.Array(StoredRecordSchema))(data);
  const known = data.filter((_, index) => KNOWN_MESSAGE_TYPES.has(records[index]?.type ?? ""));

  return yield* decoded(Schema.Array(ConductorMessageSchema))(known);
});
