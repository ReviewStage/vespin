/**
 * vercel-sdk.test.ts -- `Sandbox` as Vercel answers it, against a scripted fake of Vercel behind the SDK's `fetch`: what a failure says (the call, Vercel's status and error or the cause's, every token-shaped run redacted) and which of the package's failures Vercel's answer is; and what the adapter decides beside the SDK: a get-or-create hands a sandbox it created to its setup, and meets its name taken with the sandbox holding it, a create refuses it as taken, a sandbox or a snapshot already gone reads as gone, a delete wakes nothing, and a touch lengthens a running session alone, by the rule `TOUCH` sets.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { Sandbox, type SandboxService } from "../sandbox.js";
import { SANDBOX_CALL, type SandboxCall, type SandboxError } from "../vocabulary.js";
import {
  driveAnswered,
  fixtureToken,
  sandboxDeleted,
  sandboxFetchOver,
  sandboxFound,
  sessionAnswered,
} from "./testing/vercel-sandbox-fake.js";
import { SandboxToken, vercelSandboxLayer } from "./vercel-sdk.js";

const SESSION = "sbs_fixture";
const NAME = "luke-native-fixture";
const REFUSAL = { code: "bad_request", message: "Invalid request: the fixture's refusal" } as const;
const SECRET_ENV = "fixture-secret-env-value";
const CREATED_AT = Date.UTC(2026, 10, 5);
/** Vercel's answer for a snapshot past its expiration, as it answered on Nov 8, 2026, naming no code of its own. */
const SNAPSHOT_EXPIRED = { code: "bad_request", message: "Snapshot expired or deleted." } as const;

/** A sandbox as Vercel's list names it, up in the session it runs. */
const RUNNING_SANDBOX = {
  name: NAME,
  status: "running",
  currentSessionId: SESSION,
  createdAt: CREATED_AT,
} as const;

/** A create of the fixture's sandbox, with a secret in its environment. */
const CREATE_ASK = {
  name: NAME,
  from: { image: "agent-image:fixture" },
  tags: {},
  vcpus: 2,
  env: { SECRET: SECRET_ENV },
} as const;

/** Each call made through the SDK's statics, as a caller asks it. */
const CALLS: readonly {
  readonly call: SandboxCall;
  readonly ask: (api: SandboxService) => Effect.Effect<unknown, SandboxError>;
}[] = [
  { call: SANDBOX_CALL.CREATE, ask: (api) => api.create(CREATE_ASK) },
  { call: SANDBOX_CALL.TAGS, ask: (api) => api.updateTags(NAME, { sessionId: "s" }) },
  { call: SANDBOX_CALL.GET, ask: (api) => api.get(NAME) },
  { call: SANDBOX_CALL.LIST, ask: (api) => api.listTagged("sessionId", "session_fixture") },
];

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

/** `Sandbox` under the fixture's token, or the reader given, the SDK sending through the responder given. */
function apiOver(respond: Responder, readToken?: () => Promise<string>) {
  const under = Layer.mergeAll(
    FetchHttpClient.layer,
    sandboxFetchOver(respond),
    ...(readToken === undefined ? [] : [Layer.succeed(SandboxToken, readToken)]),
  );
  return Effect.provide(Effect.service(Sandbox), Layer.provide(vercelSandboxLayer, under));
}

/** The failure's line, where it is one that carries one. */
function detailOf(failure: SandboxError): string | undefined {
  return failure._tag === "SandboxUnavailable" ? failure.detail : undefined;
}

const refusedWith = (status: number) => () => Response.json({ error: REFUSAL }, { status });

it.effect("each call Vercel refused names the call, its status, and Vercel's error", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(refusedWith(400));
    for (const { call, ask } of CALLS) {
      const failure = yield* Effect.flip(ask(api));
      assert.equal(failure._tag, "SandboxUnavailable");
      assert.equal(failure.call, call);
      assert.equal(
        failure.message,
        `the sandbox's ${call} was unavailable: Vercel answered 400: ${REFUSAL.code}: ${REFUSAL.message}`,
      );
      assert.equal(failure.message.includes(SECRET_ENV), false);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }
  }),
);

it.effect("a refusal's detail is one line of at most 300 characters", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(() =>
      Response.json(
        { error: { code: "x", message: `a\n${"word ".repeat(200)}` } },
        { status: 400 },
      ),
    );
    const detail = detailOf(yield* Effect.flip(api.updateTags(NAME, {})));
    assert.ok(detail !== undefined);
    assert.equal(detail.length, "Vercel answered 400: ".length + 300);
    assert.equal(detail.includes("\n"), false);
  }),
);

it.effect("a secret Vercel or a cause echoes back is redacted from the detail", () =>
  Effect.gen(function* () {
    const echoed = `env SECRET=${SECRET_ENV} under Bearer ${fixtureToken()}`;
    const refusing = yield* apiOver(() =>
      Response.json({ error: { code: "bad_request", message: echoed } }, { status: 400 }),
    );
    // Note that the cause is an abort, because the SDK tries any other failure to connect again on a real timer.
    const throwing = yield* apiOver(() => {
      throw Object.assign(new Error(echoed), { name: "AbortError" });
    });
    for (const api of [refusing, throwing]) {
      const failure = yield* Effect.flip(api.create(CREATE_ASK));
      assert.match(detailOf(failure) ?? "", /env SECRET=\[redacted\] under Bearer \[redacted\]/u);
      assert.equal(failure.message.includes(SECRET_ENV), false);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }
  }),
);

it.effect("a long error code of Vercel's own is kept whole", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(() =>
      Response.json(
        { error: { code: "unsupported_media_type", message: "Unsupported Media Type" } },
        { status: 415 },
      ),
    );
    const failure = yield* Effect.flip(api.get(NAME));
    assert.equal(
      detailOf(failure),
      "Vercel answered 415: unsupported_media_type: Unsupported Media Type",
    );
  }),
);

it.effect("a token that could not be read names the call and why", () =>
  Effect.gen(function* () {
    const unread = yield* apiOver(refusedWith(400), () =>
      Promise.reject(new Error("the token endpoint was down")),
    );
    const failure = yield* Effect.flip(unread.listTagged("sessionId", "session_fixture"));
    assert.equal(failure.call, SANDBOX_CALL.LIST);
    assert.equal(detailOf(failure), "Error: the token endpoint was down");

    const unnamed = yield* apiOver(refusedWith(400), () => Promise.resolve("not-a-token"));
    const unclaimed = yield* Effect.flip(unnamed.updateTags(NAME, {}));
    assert.equal(unclaimed.call, SANDBOX_CALL.TAGS);
    assert.equal(detailOf(unclaimed), "a token naming no project");
  }),
);

it.effect(
  "a get-or-create resumes the sandbox standing, hands one it created to onCreate before it answers, and meets its name taken on its create with the sandbox holding it, handed to onCreate too, but never a drive still attached; a create refuses that name as taken",
  () =>
    Effect.gen(function* () {
      const gets: (string | null)[] = [];
      let standing = true;
      let taken: string | undefined;
      const api = yield* apiOver((url, init) => {
        if (init.method === "POST") {
          if (taken !== undefined) {
            standing = true;
            return Response.json(
              { error: { code: taken, message: "the name is taken" } },
              { status: 409 },
            );
          }
          return Response.json(sandboxFound(RUNNING_SANDBOX));
        }
        gets.push(new URL(url).searchParams.get("resume"));
        return standing ? Response.json(sandboxFound(RUNNING_SANDBOX)) : refusedWith(404)();
      });
      const setUp: string[] = [];
      const onCreate = async (created: { readonly running: string }) => {
        setUp.push(created.running);
      };

      const found = yield* api.getOrCreate(CREATE_ASK, onCreate);
      const setUpOnFound = setUp.length;
      standing = false;
      const created = yield* api.getOrCreate(CREATE_ASK, onCreate);
      taken = "sandbox_already_exists";
      const joined = yield* api.getOrCreate(CREATE_ASK, onCreate);
      const refused = yield* Effect.flip(api.create(CREATE_ASK));

      assert.deepEqual(
        [found, created, joined].map((each) => each.running),
        [SESSION, SESSION, SESSION],
      );
      assert.equal(setUpOnFound, 0);
      assert.deepEqual(setUp, [SESSION, SESSION]);
      assert.deepEqual(gets, ["true", "true", "true", "true"]);
      assert.equal(refused._tag, "SandboxNameTaken");
      assert.equal(refused.call, SANDBOX_CALL.CREATE);

      // A drive still attached is the create's refusal, joined to no sandbox and set up nowhere.
      standing = false;
      taken = "drive_attached";
      const attached = yield* Effect.flip(api.getOrCreate(CREATE_ASK, onCreate));
      assert.equal(attached._tag, "SandboxUnavailable");
      assert.equal(setUp.length, 2);
    }),
);

it.effect("a get-or-create that resumes a sandbox closes the ports its last run left open", () =>
  Effect.gen(function* () {
    const patched: unknown[] = [];
    const api = yield* apiOver((_url, init) => {
      if (init.method === "PATCH") {
        patched.push(JSON.parse(String(init.body)));
        return Response.json({ ...sandboxDeleted(RUNNING_SANDBOX), routes: [] });
      }
      const route = { port: 3000, subdomain: "fixture-3000", url: "https://fixture-3000.example" };
      return Response.json({ ...sandboxFound(RUNNING_SANDBOX), routes: [route], resumed: true });
    });

    yield* api.getOrCreate(CREATE_ASK);

    assert.deepEqual(patched, [{ ports: [] }]);
  }),
);

it.effect("a sandbox Vercel no longer holds is none", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(refusedWith(404));

    assert.equal(yield* api.get(NAME), undefined);
  }),
);

it.effect(
  "a create Vercel refused for its snapshot gone reads as gone, by its code or by its words, and the same status for a stopped sandbox or with no code does not",
  () =>
    Effect.gen(function* () {
      let error: object = { code: "snapshot_not_found", message: "the snapshot is gone" };
      const api = yield* apiOver(() => Response.json({ error }, { status: 410 }));
      const refusal = () => Effect.flip(api.create(CREATE_ASK));

      const lost = yield* refusal();
      error = SNAPSHOT_EXPIRED;
      const expired = yield* refusal();
      error = { code: "sandbox_stopped", message: "the sandbox is stopped" };
      const stopped = yield* refusal();
      error = { message: "gone" };
      const unnamed = yield* refusal();

      assert.equal(lost._tag, "SnapshotGone");
      assert.equal(expired._tag, "SnapshotGone");
      assert.equal(stopped._tag, "SandboxUnavailable");
      assert.equal(unnamed._tag, "SandboxUnavailable");
    }),
);

/** A stopped sandbox as Vercel's list names it. */
const STOPPED_SANDBOX = { ...RUNNING_SANDBOX, status: "stopped" } as const;

it.effect(
  "a get-or-create whose standing sandbox lost its snapshot deletes it and hands a fresh one under its name to onCreate",
  () =>
    Effect.gen(function* () {
      let deleted = false;
      const api = yield* apiOver((url, init) => {
        if (init.method === "DELETE") {
          deleted = true;
          return Response.json(sandboxDeleted(STOPPED_SANDBOX));
        }
        if (init.method === "POST") return Response.json(sandboxFound(RUNNING_SANDBOX));
        if (deleted) return refusedWith(404)();
        return new URL(url).searchParams.get("resume") === "true"
          ? Response.json({ error: SNAPSHOT_EXPIRED }, { status: 410 })
          : Response.json(sandboxFound(STOPPED_SANDBOX));
      });
      const setUp: string[] = [];

      const opened = yield* api.getOrCreate(CREATE_ASK, async (created) => {
        setUp.push(created.running);
      });

      assert.equal(deleted, true);
      assert.equal(opened.running, SESSION);
      assert.deepEqual(setUp, [SESSION]);
    }),
);

/** Vercel's answer to a lookup and to a delete, as `@vercel/sandbox` reads them. */
const sandboxAnswer = (method: string) =>
  Response.json(
    method === "DELETE" ? sandboxDeleted(STOPPED_SANDBOX) : sandboxFound(STOPPED_SANDBOX),
  );

/** Whether a call was one on a drive. */
const onDrive = (url: URL) => url.pathname.includes("/drives/");

it.effect(
  "a delete wakes no stopped sandbox, takes its orphan snapshots, counts one gone as deleted, and names Vercel's refusal",
  () =>
    Effect.gen(function* () {
      const asked: { readonly method: string; readonly url: URL }[] = [];
      let answer: (method: string, url: URL) => Response = (method, url) =>
        onDrive(url) ? refusedWith(404)() : sandboxAnswer(method);
      const api = yield* apiOver((url, init) => {
        const method = init.method ?? "GET";
        asked.push({ method, url: new URL(url) });
        return answer(method, new URL(url));
      });

      yield* api.delete(NAME);
      const [lookup, deletion] = asked.filter((each) => !onDrive(each.url));
      assert.equal(lookup?.url.searchParams.get("resume"), "false");
      assert.equal(deletion?.method, "DELETE");
      assert.equal(deletion?.url.searchParams.get("deleteOrphanSnapshots"), "true");

      answer = () => refusedWith(404)();
      yield* api.delete(NAME);

      answer = () => refusedWith(400)();
      const failure = yield* Effect.flip(api.delete(NAME));
      assert.equal(failure.call, SANDBOX_CALL.DELETE);
      assert.equal(detailOf(failure), `Vercel answered 400: ${REFUSAL.code}: ${REFUSAL.message}`);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }),
);

it.effect(
  "a delete of a sandbox that owns a drive stops its running session, then deletes the drive it owns, then the sandbox",
  () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const api = yield* apiOver((url, init) => {
        const method = init.method ?? "GET";
        const { pathname } = new URL(url);
        // The path as Vercel's REST reference spells it, past the SDK's own prefix.
        if (method !== "GET") writes.push(`${method} ${pathname.replace(/^\/api/u, "")}`);
        if (onDrive(new URL(url))) {
          return Response.json(driveAnswered({ id: "drv_own", name: `${NAME}-drive` }));
        }
        if (pathname.endsWith("/stop")) {
          return Response.json(sessionAnswered({ id: SESSION, status: "stopped" }));
        }
        return Response.json(
          method === "DELETE" ? sandboxDeleted(RUNNING_SANDBOX) : sandboxFound(RUNNING_SANDBOX),
        );
      });

      yield* api.delete(NAME);

      assert.deepEqual(writes, [
        `POST /v2/sandboxes/sessions/${SESSION}/stop`,
        `DELETE /v2/sandboxes/drives/${NAME}-drive`,
        `DELETE /v2/sandboxes/${NAME}`,
      ]);
    }),
);

it.effect(
  "a minted PTY address off Vercel's sandbox domain is refused, its token never handed on",
  () =>
    Effect.gen(function* () {
      const addresses = [
        "wss://pty.attacker.test/ws",
        "wss://vercel.run.attacker.test/ws",
        "ws://sbx-fixture.vercel.run/ws",
        "wss://user:pass@sbx-fixture.vercel.run/ws",
      ];
      for (const address of addresses) {
        const api = yield* apiOver((url) =>
          new URL(url).pathname.endsWith("/interactive")
            ? Response.json({ url: address, token: "pty-token" })
            : Response.json(sandboxFound(RUNNING_SANDBOX)),
        );
        const refused = yield* Effect.flip(api.openInteractive(NAME));
        assert.equal(refused._tag, "SandboxUnavailable", address);
      }
      const minted = yield* apiOver((url) =>
        new URL(url).pathname.endsWith("/interactive")
          ? Response.json({ url: "wss://sbx-fixture.vercel.run/ws", token: "pty-token" })
          : Response.json(sandboxFound(RUNNING_SANDBOX)),
      );
      assert.equal((yield* minted.openInteractive(NAME)).url, "wss://sbx-fixture.vercel.run/ws");
    }),
);

it.effect(
  "a touch makes a running session end five minutes from now, only where that moves it more than 30 seconds, never past 24 hours from its start, and touches nothing not running",
  () =>
    Effect.gen(function* () {
      const minutes = (count: number) => Duration.toMillis(Duration.minutes(count));
      let status = "running";
      let timeout = minutes(5);
      const extensions: number[] = [];
      const api = yield* apiOver((url, init) => {
        if (status === "gone") return refusedWith(404)();
        if (!new URL(url).pathname.endsWith("/extend-timeout")) {
          return Response.json(sandboxFound({ ...RUNNING_SANDBOX, status, timeout }));
        }
        const { duration } = JSON.parse(String(init.body)) as { readonly duration: number };
        extensions.push(duration);
        timeout += duration;
        return Response.json(
          sessionAnswered({ id: SESSION, status, createdAt: CREATED_AT, timeout }),
        );
      });
      const touchedAt = (since: number) =>
        Effect.andThen(TestClock.setTime(CREATED_AT + since), api.touch(NAME));

      // Ends at 5:00; touched at 0:20 it would end at 5:20, too little to extend.
      yield* touchedAt(Duration.toMillis(Duration.seconds(20)));
      // Touched at 2:00, it ends at 7:00.
      yield* touchedAt(minutes(2));
      // Touched a minute short of 24 hours, it ends at 24 hours, and touched again, stays there.
      yield* touchedAt(minutes(24 * 60 - 1));
      yield* touchedAt(minutes(24 * 60 - 1) + 1);
      status = "stopped";
      yield* touchedAt(minutes(24 * 60 + 10));
      status = "gone";
      yield* touchedAt(minutes(24 * 60 + 20));

      assert.deepEqual(extensions, [minutes(2), minutes(24 * 60 - 7)]);
    }),
);
