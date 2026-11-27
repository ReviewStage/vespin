import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_STATUS, type JsonValue, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { Effect, Fiber, Predicate } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { TestClock } from "effect/testing";
import { accountBearer, CALL_FAULT } from "./account-call.js";
import { FAILURE_FACT } from "./failure-facts.js";
import { HOSTS_READ } from "./host-live.js";
import { askLiveRead, hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import { INBOX_ITEMS_READ } from "./inbox-live.js";
import { LIVE_POLL, LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * hosted-call.test.ts -- how one hosted call's answer or failure reads as its domain's: one row per behavior of the translation.
 *
 * `mcpClients.list` declares only the refusals any procedure may answer;
 * `pullRequestChapters.read` refuses a repository out of reach, so it
 * stands for a procedure that declares a refusal carrying fields.
 */

const BASE_URL = "https://app.test";

const CLIENTS = { serverUrl: `${BASE_URL}/api/mcp`, clients: [] };

/** The status the service answers an outage under. */
const SERVICE_UNAVAILABLE = 503;

const UNREACHED = { reason: REPOSITORY_UNREACHED.GONE, repository: "Acme/Relay" };

/** An account holding the token given, which renewing never changes. */
function account(token: string | undefined) {
  return accountBearer({
    readAccessToken: () => Effect.succeed(token),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("account-1"),
  });
}

/** An answer with the trace its cause names left out, since every call mints its own. */
function untraced<Answer>(answer: Answer): Answer | object {
  if (!Predicate.isObjectOrArray(answer) || !("cause" in answer)) return answer;
  const { cause } = answer;

  if (!Predicate.isObjectOrArray(cause) || !("traceId" in cause)) return answer;
  const { traceId: _traceId, ...facts } = cause;

  return { ...answer, cause: facts };
}

/** One behavior: what the service answers, if it is asked, and what the call answers then. */
interface Row {
  readonly behavior: string;
  readonly signedOut?: boolean;
  readonly status: number;
  readonly body: JsonValue;
  readonly call: (hosted: HostedClient) => Effect.Effect<unknown, never, HttpClient.HttpClient>;
  readonly expected: unknown;
}

it.effect.each<Row>([
  {
    behavior: "an answer is the procedure's output",
    status: HTTP_STATUS.OK,
    body: CLIENTS,
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: CLIENTS,
  },
  {
    behavior: "a declared refusal is its slug with the fields it carries",
    status: HTTP_STATUS.FORBIDDEN,
    body: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached: UNREACHED },
    call: (hosted) => hostedCall(hosted.pullRequestChapters.read, { id: "agent-1", number: "7" }),
    expected: { failure: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached: UNREACHED },
  },
  {
    behavior: "a refusal the procedure does not declare is no answer",
    status: HTTP_STATUS.NOT_FOUND,
    body: { error: HOSTED_API_ERROR.NOT_FOUND },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: {
        _tag: FAILURE_FACT.HOSTED_UNANSWERED,
        status: HTTP_STATUS.NOT_FOUND,
        code: HOSTED_API_ERROR.NOT_FOUND,
      },
    },
  },
  {
    behavior: "a refusal any procedure may answer is no answer unless renamed",
    status: SERVICE_UNAVAILABLE,
    body: { error: HOSTED_API_ERROR.UNAVAILABLE },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_REFUSED, refusal: HOSTED_API_ERROR.UNAVAILABLE },
    },
  },
  {
    behavior: "a call that never reached the service is no answer with its fault",
    signedOut: true,
    status: HTTP_STATUS.OK,
    body: CLIENTS,
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: CALL_FAULT.NO_CREDENTIAL },
    },
  },
  {
    behavior: "a live read's refused bearer is signed out",
    status: HTTP_STATUS.UNAUTHORIZED,
    body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined, { live: true }),
    expected: LIVE_SIGNED_OUT,
  },
  {
    behavior: "a renamed refusal is the spelling that shipped",
    status: HTTP_STATUS.BAD_REQUEST,
    body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
    call: (hosted) =>
      hostedCall(hosted.mcpClients.list, undefined, {
        as: { [HOSTED_API_ERROR.INVALID_REQUEST]: "invalid-choice" },
      }),
    expected: { failure: "invalid-choice" },
  },
])("$behavior", ({ signedOut, status, body, call, expected }) =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse(body, status));

    const hosted = hostedClient({
      baseUrl: BASE_URL,
      credential: account(signedOut === true ? undefined : "token-1"),
    });

    const answer = yield* Effect.provide(call(hosted), recording.layer);

    assert.deepEqual(untraced(answer), expected);
  }),
);

it.effect(
  "a declared live read polled past where its rows stood asks for them inline past it, as its params name it",
  () =>
    Effect.gen(function* () {
      const sealed = { capability: "cap-1", queryFingerprint: "fp-1", expiresAt: 1, digest: "d2" };

      const recording = recordingHttpClient(() =>
        jsonResponse({
          url: `${BASE_URL}/poll`,
          queries: { hosts: { ...sealed, rows: "[]" } },
          installScriptUrl: `${BASE_URL}/install.sh`,
        }),
      );

      const hosted = hostedClient({ baseUrl: BASE_URL, credential: account("token-1") });

      const answer = yield* Effect.provide(
        askLiveRead(hosted.live, HOSTS_READ, { [LIVE_USER_QUERY]: "user-1" }, { after: "d1" }),
        recording.layer,
      );

      assert.deepEqual(answer, {
        url: `${BASE_URL}/poll`,
        queries: { hosts: { ...sealed, rows: [] } },
        installScriptUrl: `${BASE_URL}/install.sh`,
      });
      assert.deepEqual([...(recording.requests[0]?.searchParams.entries() ?? [])].toSorted(), [
        [LIVE_POLL.AFTER, "d1"],
        [LIVE_POLL.QUERY, LIVE_POLL.ON],
        [LIVE_USER_QUERY, "user-1"],
      ]);
    }),
);

it.effect(
  "a sync-followed read asked whole outlasts the usual deadline, so the largest account's first answer can land",
  () =>
    Effect.gen(function* () {
      const silent = recordingHttpClient(() => new Promise<Response>(() => undefined));
      const hosted = hostedClient({ baseUrl: BASE_URL, credential: account("token-1") });

      const whole = yield* Effect.forkChild(
        Effect.provide(
          askLiveRead(hosted.live, INBOX_ITEMS_READ, { [LIVE_USER_QUERY]: "user-1", sync: "" }),
          silent.layer,
        ),
      );

      // Note that the link's promise steps run until the client is asked, so the deadline is armed before the clock moves.
      while (silent.requests.length === 0) yield* Effect.yieldNow;
      yield* TestClock.adjust("59 seconds");
      assert.equal(whole.pollUnsafe(), undefined, "still waiting a minute's moment short");
      yield* TestClock.adjust("1 second");
      const answer = yield* Fiber.join(whole);
      assert.deepEqual(untraced(answer), {
        failure: "unanswered",
        cause: {
          _tag: FAILURE_FACT.HOSTED_UNANSWERED,
          fault: CALL_FAULT.NETWORK,
          errorName: "TimeoutError",
        },
      });
    }),
);

/** One page of the account's inbox items as the service answers a page: each part's rows as text, and where the page stands (`sync`, and the snapshot the last page carries). */
function inboxItemsPage(
  ids: readonly string[],
  standing: { readonly sync: { readonly [key: string]: string }; readonly snapshot?: string },
): JsonValue {
  const part = (rows: readonly JsonValue[]) => {
    const sealed = {
      capability: "cap-1",
      queryFingerprint: "fp-1",
      expiresAt: 1,
      rows: JSON.stringify(rows),
      sync: standing.sync,
    };

    return standing.snapshot === undefined ? sealed : { ...sealed, snapshot: standing.snapshot };
  };

  const rows = ids.map((id) => ({ id }));

  return {
    url: `${BASE_URL}/poll`,
    queries: { stamps: part(rows), items: part(rows), messages: part([]), files: part([]) },
  };
}

it.effect(
  "a whole answer sent in pages is asked page by page and answered as one, standing at the sync id and snapshot of its last page",
  () =>
    Effect.gen(function* () {
      const recording = recordingHttpClient((request) =>
        jsonResponse(
          request.searchParams.get(LIVE_POLL.PAGE) === "page-2"
            ? inboxItemsPage(["item-3"], { sync: { next: "70" }, snapshot: "70:70:" })
            : inboxItemsPage(["item-1", "item-2"], { sync: { next: "70", page: "page-2" } }),
        ),
      );

      const hosted = hostedClient({ baseUrl: BASE_URL, credential: account("token-1") });

      const answer = yield* Effect.provide(
        askLiveRead(hosted.live, INBOX_ITEMS_READ, { [LIVE_USER_QUERY]: "user-1", sync: "" }, {}),
        recording.layer,
      );

      assert.ok(!("failure" in answer));
      assert.deepEqual(answer.queries.stamps.rows, [
        { id: "item-1" },
        { id: "item-2" },
        { id: "item-3" },
      ]);
      assert.deepEqual(answer.queries.stamps.sync, { next: "70" });
      assert.equal(answer.queries.items.snapshot, "70:70:");
      assert.deepEqual(
        recording.requests.map((request) => request.searchParams.get(LIVE_POLL.PAGE)),
        [null, "page-2"],
      );
    }),
);

it.effect(
  "a whole answer whose later page fails is answered as no answer, never as the pages before it",
  () =>
    Effect.gen(function* () {
      const recording = recordingHttpClient((request) =>
        request.searchParams.get(LIVE_POLL.PAGE) === "page-2"
          ? jsonResponse({ error: HOSTED_API_ERROR.UNAVAILABLE }, SERVICE_UNAVAILABLE)
          : jsonResponse(inboxItemsPage(["item-1"], { sync: { next: "70", page: "page-2" } })),
      );

      const hosted = hostedClient({ baseUrl: BASE_URL, credential: account("token-1") });

      const answer = yield* Effect.provide(
        askLiveRead(hosted.live, INBOX_ITEMS_READ, { [LIVE_USER_QUERY]: "user-1", sync: "" }, {}),
        recording.layer,
      );

      assert.ok("failure" in answer);
    }),
);
