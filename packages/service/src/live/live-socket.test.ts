import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { fakeWorkspaceSeams, getTestDB, startTask } from "@repo/database/testing";
import {
  LIVE_SOCKET,
  LIVE_USER_QUERY,
  type LiveSocketAnswer,
  type LiveSocketAsk,
  liveSocketAnswerSchema,
} from "@repo/features/live-wire";
import { TASK_LIST_READ } from "@repo/features/task-list-live";
import { type Cause, Context, Effect, Option, Queue, Schema, Stream } from "effect";
import type { SqlClient } from "effect/sql";
import { WebSocket } from "ws";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { RELAY_UPGRADE_STATUS, type RelayCredential } from "../http/relay-upgrade.js";
import type { VoiceFrame, VoiceSocket } from "../http/socket.js";
import { type HostedFetch, hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { liveProcedures } from "./live-procedures.js";
import {
  answerLiveSocket,
  type LiveSocketOptions,
  liveSocketServer,
  standLiveSocket,
} from "./live-socket.js";

/**
 * Two hosts' sockets answered at once over the live router and the test's
 * own database: each ask is answered under its own id, on its own socket,
 * as the poll of the account the socket's upgrade named, so a read naming
 * another account is signed out and another account's task is not found,
 * whatever the frame asks. And the socket as the desktop, the iPhone, and
 * a page open it, over a loopback server of its own: an upgrade is taken by
 * its bearer whatever origin stands beside it, and by a cookie only from a
 * page of the deployment's own with no `Authorization` beside it, every ask
 * then sent on under that credential alone.
 *
 * Synthetic accounts, bearers, and cookies throughout.
 */

const ORIGIN = "https://app.test";

/** The account a bearer names: the test's bearer is the account's id. */
const bearerUserId = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return Effect.succeed(
    authorization.startsWith("Bearer ") ? Option.some(authorization.slice(7)) : Option.none(),
  );
};

/** A live read's path and query, naming the account it is for. */
function readOf(path: string, forUser: string, query: Record<string, string> = {}): string {
  return `${path}?${new URLSearchParams({ ...query, [LIVE_USER_QUERY]: forUser })}`;
}

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** One host's socket as a test drives it: asks pushed in, and each answer it was sent read in order. */
const hostSocket = Effect.gen(function* () {
  const inbound = yield* Queue.make<VoiceFrame, Cause.Done>();
  const sent = yield* Queue.make<string>();
  const socket: VoiceSocket = {
    next: Queue.take(inbound).pipe(
      Effect.map((frame): Option.Option<VoiceFrame> => Option.some(frame)),
      Effect.catchTag("Done", () => Effect.succeed(Option.none<VoiceFrame>())),
    ),
    frames: Stream.fromQueue(inbound),
    send: (frame) => ("text" in frame ? Effect.asVoid(Queue.offer(sent, frame.text)) : Effect.void),
    close: () => Queue.end(inbound),
    isOpen: Effect.succeed(true),
  };
  return {
    socket,
    ask: (ask: LiveSocketAsk) => Queue.offer(inbound, { text: JSON.stringify(ask) }),
    answer: Effect.map(
      Queue.take(sent),
      (text): LiveSocketAnswer =>
        Schema.decodeUnknownSync(liveSocketAnswerSchema)(JSON.parse(text)),
    ),
  };
});

/** The tasks a task list answer lists, by id. */
function listedTasks(answer: LiveSocketAnswer): readonly string[] {
  const listed = Schema.decodeUnknownSync(TASK_LIST_READ.answer)(JSON.parse(answer.body));
  const rows = Schema.decodeUnknownSync(TASK_LIST_READ.rows)({
    plans: listed.queries.plans.rows,
    agents: listed.queries.agents.rows,
    issues: listed.queries.issues?.rows,
  });
  return rows.plans.map((plan) => plan.id);
}

it.layer(getTestDB())("the live socket", (it) => {
  it.effect(
    "each socket's asks are answered under their ids as the polls of the account its upgrade named",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const dana = yield* openUser;
          const eli = yield* openUser;
          const danaTask = yield* startTask(dana, { name: "Teammate invitations" });
          const eliTask = yield* startTask(eli, { name: "Billing export" });
          const context = yield* Effect.context<SqlClient.SqlClient | Database>();
          const answerer = {
            fetch: hostedFetch({
              live: liveProcedures({
                resolveUserId: bearerUserId,
                workspaces: yield* fakeWorkspaceSeams,
              }),
            }),
            // SAFETY: the live procedures read only the store of the web runtime's services.
            services: context as Context.Context<WebServices>,
            origin: ORIGIN,
          };
          const danaHost = yield* hostSocket;
          const eliHost = yield* hostSocket;
          yield* Effect.forkScoped(
            answerLiveSocket(danaHost.socket, { bearer: `Bearer ${dana}` }, answerer),
          );
          yield* Effect.forkScoped(
            answerLiveSocket(eliHost.socket, { bearer: `Bearer ${eli}` }, answerer),
          );

          yield* danaHost.ask({ id: 1, path: readOf("/api/live/tasks", dana) });
          yield* eliHost.ask({ id: 1, path: readOf("/api/live/tasks", eli) });
          const [danaTasks, eliTasks] = yield* Effect.all([danaHost.answer, eliHost.answer], {
            concurrency: "unbounded",
          });
          assert.deepEqual(
            [danaTasks.id, danaTasks.status, listedTasks(danaTasks)],
            [1, HOSTED_HTTP_STATUS.OK, [danaTask.id]],
          );
          assert.deepEqual(
            [eliTasks.id, eliTasks.status, listedTasks(eliTasks)],
            [1, HOSTED_HTTP_STATUS.OK, [eliTask.id]],
          );

          yield* danaHost.ask({ id: 2, path: readOf("/api/live/tasks", eli) });
          assert.deepEqual(
            yield* danaHost.answer,
            {
              id: 2,
              status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
              body: JSON.stringify({ error: HOSTED_API_ERROR.INVALID_TOKEN }),
            },
            "a read naming another account is signed out",
          );
          yield* danaHost.ask({
            id: 3,
            path: readOf("/api/live/task-record", dana, { id: eliTask.id }),
          });
          const record = yield* danaHost.answer;
          assert.deepEqual(
            [record.id, record.status],
            [3, HOSTED_HTTP_STATUS.NOT_FOUND],
            "another account's task is not found",
          );
        }),
      ),
  );
});

const DANA = "user-dana";
/** The `ios` client's bearer, as the phone's app sends it. */
const IOS_BEARER = "Bearer ios-token-of-dana";
const DANA_COOKIE = "__Secure-better-auth.session_token=session-of-dana";
/** An origin React Native's socket may name on the phone's handshake, which is no page's. */
const IOS_ORIGIN = "http://localhost";

/** A fetch that answers each ask with the credential headers it carried, so a test reads what the socket sent on. */
const credentialEcho: HostedFetch = (request) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        authorization: request.headers.get("authorization"),
        cookie: request.headers.get("cookie"),
      }),
      { status: HOSTED_HTTP_STATUS.OK },
    ),
  );

const decodeEcho = Schema.decodeUnknownSync(
  Schema.Struct({
    authorization: Schema.NullOr(Schema.String),
    cookie: Schema.NullOr(Schema.String),
  }),
);

/** The live socket stood for the scope on a loopback server of its own, answering at the address its sockets open. */
const standingSocket = (resolveUserId: LiveSocketOptions["resolveUserId"]) =>
  Effect.gen(function* () {
    const relay = liveSocketServer();
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        relay.server.listen(0, "127.0.0.1");
        await once(relay.server, "listening");
      }),
      () =>
        Effect.sync(() => {
          relay.server.closeAllConnections();
          relay.server.close();
        }),
    );
    yield* standLiveSocket({
      server: relay,
      ownOrigins: new Set([ORIGIN]),
      resolveUserId,
      fetch: credentialEcho,
      origin: ORIGIN,
      // SAFETY: the echo answers every ask from its request alone and reads no service of the web runtime's.
    }).pipe(Effect.provide(Context.empty() as Context.Context<WebServices>));
    // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
    const { port } = relay.server.address() as AddressInfo;
    return `ws://127.0.0.1:${port}${LIVE_SOCKET.PATH}`;
  });

/** What one upgrade with the headers given comes to: the status it was refused with, or the credential its first ask was sent on under. */
const opened = (url: string, headers: Readonly<Record<string, string>>) =>
  Effect.callback<
    | { readonly refused: number }
    | { readonly authorization: string | null; readonly cookie: string | null }
  >((resume) => {
    let settled = false;
    const settle = (end: { readonly refused: number } | ReturnType<typeof decodeEcho>) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(end));
    };
    const socket = new WebSocket(url, { headers: { ...headers } });
    socket.once("unexpected-response", (_request, response) => {
      settle({ refused: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once("open", () => {
      const ask: LiveSocketAsk = { id: 1, path: "/api/live/tasks" };
      socket.send(JSON.stringify(ask));
    });
    socket.once("message", (data) => {
      const answer = Schema.decodeUnknownSync(liveSocketAnswerSchema)(JSON.parse(String(data)));
      settle(decodeEcho(JSON.parse(answer.body)));
      socket.terminate();
    });
    socket.on("error", () => undefined);
    return Effect.sync(() => socket.terminate());
  });

/** A credential as the resolver was handed it, flattened for comparison: the bearer, or the page's cookie. */
const handed = (credential: RelayCredential): string | null =>
  "bearer" in credential ? credential.bearer : credential.page.get("cookie");

it.effect(
  "an upgrade is taken by its bearer whatever origin stands beside it, and by a cookie only from the deployment's own page with no Authorization beside it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const read: string[] = [];
        const url = yield* standingSocket((credential) =>
          Effect.sync(() => {
            const credentialHanded = handed(credential);
            read.push(credentialHanded ?? "");
            return credentialHanded === IOS_BEARER || credentialHanded === DANA_COOKIE
              ? Option.some(DANA)
              : Option.none();
          }),
        );
        const underBearer = { authorization: IOS_BEARER, cookie: null };

        assert.deepEqual(
          yield* opened(url, { authorization: IOS_BEARER, origin: IOS_ORIGIN }),
          underBearer,
          "the phone's bearer, under the origin its runtime names",
        );
        assert.deepEqual(
          yield* opened(url, { authorization: IOS_BEARER }),
          underBearer,
          "the desktop's bearer, with no origin",
        );
        assert.deepEqual(
          yield* opened(url, {
            origin: "https://evil.test",
            authorization: IOS_BEARER,
            cookie: DANA_COOKIE,
          }),
          underBearer,
          "a bearer is no page's whatever origin and cookie stand beside it, and the cookie is never read",
        );
        assert.deepEqual(
          yield* opened(url, { origin: ORIGIN, cookie: DANA_COOKIE }),
          { authorization: null, cookie: DANA_COOKIE },
          "a page of the deployment's own, by its cookie",
        );
        assert.deepEqual(read, [IOS_BEARER, IOS_BEARER, IOS_BEARER, DANA_COOKIE]);

        assert.deepEqual(
          yield* opened(url, { origin: "https://evil.test", cookie: DANA_COOKIE }),
          { refused: RELAY_UPGRADE_STATUS.FORBIDDEN },
          "another site's page carrying the member's cookie",
        );
        assert.deepEqual(
          yield* opened(url, { origin: IOS_ORIGIN, cookie: DANA_COOKIE }),
          { refused: RELAY_UPGRADE_STATUS.FORBIDDEN },
          "a cookie under the phone's origin is no page's of the deployment's own",
        );
        assert.deepEqual(
          yield* opened(url, {
            origin: "https://evil.test",
            cookie: DANA_COOKIE,
            authorization: "Bearer not-dana",
          }),
          { refused: RELAY_UPGRADE_STATUS.UNAUTHORIZED },
          "a bearer nobody answers for is refused as such, never read past to the cookie",
        );
        assert.deepEqual(
          read.slice(4),
          ["Bearer not-dana"],
          "no cookie of another site's page is read, and only the bearer of the last",
        );
      }),
    ),
);
