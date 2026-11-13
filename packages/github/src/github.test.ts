/**
 * github.test.ts -- the GitHub service over a fake HttpClient: what it sends, what a refusal holds, the members' reserve, and conditional requests.
 */

import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Duration, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { GitHub, type InstallationGrant } from "./github.js";
import { type GitHubHold, GitHubHoldStore } from "./github-hold-store.js";
import type { GitHubRateScope } from "./github-identity.js";
import { GitHubPriority, PRIORITY } from "./github-rate.js";

const API = "https://api.github.com";
const REPOSITORY = { owner: "octo", repo: "hello" } as const;
const REPOSITORY_URL = `${API}/repos/octo/hello`;

/** A reset far past any clock the test reads, so a primary hold stands for the whole test. */
const FAR_RESET = "2000000000";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const Repository = Schema.Struct({ full_name: Schema.String });

/** One request the fake was sent. */
interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
}

type Answer = (sent: Sent) => Response;

/** The holds as one shared store would keep them, in memory, keyed by the scope's own fields. */
function memoryHoldStore(): Layer.Layer<GitHubHoldStore> {
  const holds = new Map<string, GitHubHold>();
  const keyOf = (scope: GitHubRateScope) => JSON.stringify(scope);

  return Layer.succeed(
    GitHubHoldStore,
    GitHubHoldStore.of({
      read: (scope) => Effect.sync(() => holds.get(keyOf(scope))),
      hold: (scope, now, waits) =>
        Effect.sync(() => {
          const standing = holds.get(keyOf(scope));
          const holding = standing !== undefined && standing.heldUntil > now;
          const strikes = (standing?.strikes ?? 0) + (holding ? 0 : 1);
          const wait = waits[Math.min(strikes, waits.length) - 1] ?? waits[0];
          const until = Math.max(standing?.heldUntil.getTime() ?? 0, now.getTime() + wait);
          const hold = { heldUntil: new Date(until), strikes };
          holds.set(keyOf(scope), hold);

          return hold;
        }),
      lift: (scope, now) =>
        Effect.sync(() => {
          const standing = holds.get(keyOf(scope));

          if (standing !== undefined && standing.heldUntil <= now) holds.delete(keyOf(scope));
        }),
    }),
  );
}

/** A JSON body GitHub answers with, as the fakes here write them. */
type AnswerBody = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

function json(body: AnswerBody, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

/** A mint of an installation token, answered for whichever installation asked. */
function minted(sent: Sent): Response | undefined {
  const mint = /\/app\/installations\/(\d+)\/access_tokens$/u.exec(sent.url);

  if (mint === null || sent.method !== "POST") return undefined;

  return json(
    {
      token: `ghs_installation_${mint[1]}`,
      expires_at: "2099-01-01T00:00:00Z",
      permissions: { contents: "read" },
      repository_selection: "all",
    },
    201,
  );
}

/** The service over a fake that records what it was sent and answers by `answer`. */
function harness(answer: Answer) {
  const sent: Sent[] = [];

  const http = fakeHttpClientLayer((url, init) => {
    const request = { method: init.method ?? "GET", url, headers: new Headers(init.headers) };
    sent.push(request);

    return minted(request) ?? answer(request);
  });

  const layer = GitHub.layer({
    appId: 1,
    privateKey: Redacted.make(privateKey),
    userAgent: "github-module-test",
  }).pipe(Layer.provide(Layer.mergeAll(http, memoryHoldStore())));

  /** The requests sent for the repository, as each installation or member asked them. */
  const reads = () => sent.filter((request) => request.url === REPOSITORY_URL);

  return { sent, reads, layer };
}

const installation = (installationId: number): InstallationGrant => ({ installationId });

const readRepository = (client: GitHub["Service"]["asApp"]) =>
  client.request("GET /repos/{owner}/{repo}", REPOSITORY);

describe("GitHub", () => {
  it.effect("sends through the HttpClient in context, following a redirect", () => {
    const moved = `${API}/repositories/42`;

    const { sent, layer } = harness((request) =>
      request.url === REPOSITORY_URL
        ? new Response(null, { status: 301, headers: { location: moved } })
        : json({ full_name: "octo/hello" }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;
      const answer = yield* readRepository(github.asMember(Redacted.make("gho_member")));

      assert.deepStrictEqual(Schema.decodeUnknownSync(Repository)(answer.data), {
        full_name: "octo/hello",
      });
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [REPOSITORY_URL, moved],
      );
      assert.strictEqual(sent[0]?.headers.get("authorization"), "token gho_member");
      assert.strictEqual(sent[0]?.headers.get("x-github-api-version"), "2022-11-28");
    }).pipe(Effect.provide(layer));
  });

  it.effect("holds only the installation whose quota ran out", () => {
    const { reads, layer } = harness((request) =>
      request.headers.get("authorization") === "token ghs_installation_1"
        ? json({ message: "API rate limit exceeded" }, 403, {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": FAR_RESET,
            "x-ratelimit-resource": "core",
          })
        : json({ full_name: "octo/hello" }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;
      const first = yield* Effect.flip(readRepository(github.asInstallation(installation(1))));
      const again = yield* Effect.flip(readRepository(github.asInstallation(installation(1))));
      yield* readRepository(github.asInstallation(installation(2)));

      assert.strictEqual(first._tag, "GitHubRateLimited");
      assert.strictEqual(again._tag, "GitHubRateLimited");
      // The held read was never sent; the other installation's was.
      assert.deepStrictEqual(
        reads().map((request) => request.headers.get("authorization")),
        ["token ghs_installation_1", "token ghs_installation_2"],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "holds every installation for a secondary limit, and lifts once GitHub's wait is over",
    () => {
      let refuse = true;

      const { reads, layer } = harness(() =>
        refuse
          ? json({ message: "You have exceeded a secondary rate limit." }, 403, {
              "retry-after": "30",
            })
          : json({ full_name: "octo/hello" }),
      );

      return Effect.gen(function* () {
        const github = yield* GitHub;
        const refused = yield* Effect.flip(readRepository(github.asInstallation(installation(1))));
        const held = yield* Effect.flip(readRepository(github.asInstallation(installation(2))));
        refuse = false;
        yield* TestClock.adjust(Duration.seconds(31));
        yield* readRepository(github.asInstallation(installation(2)));

        assert.strictEqual(refused._tag, "GitHubRateLimited");
        assert.strictEqual(held._tag, "GitHubRateLimited");
        assert.strictEqual(reads().length, 2);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "refuses background work once a quarter of the core quota is left, and still sends a member's",
    () => {
      const { reads, layer } = harness(() =>
        json({ full_name: "octo/hello" }, 200, {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "1000",
          "x-ratelimit-reset": FAR_RESET,
          "x-ratelimit-resource": "core",
        }),
      );

      return Effect.gen(function* () {
        const github = yield* GitHub;
        const member = github.asMember(Redacted.make("gho_member"));
        yield* readRepository(member);

        const background = yield* Effect.flip(
          readRepository(member).pipe(Effect.provideService(GitHubPriority, PRIORITY.BACKGROUND)),
        );

        yield* readRepository(member);

        assert.strictEqual(background._tag, "GitHubRateLimited");
        assert.strictEqual(reads().length, 2);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("hands out an installation token, reusing it while it has time left", () => {
    const { sent, layer } = harness(() => json({ full_name: "octo/hello" }));

    return Effect.gen(function* () {
      const github = yield* GitHub;
      const first = yield* github.installationToken(installation(3));
      const again = yield* github.installationToken(installation(3));

      assert.strictEqual(Redacted.value(first.token), "ghs_installation_3");
      assert.strictEqual(Redacted.value(again.token), "ghs_installation_3");
      assert.strictEqual(first.expiresAt.toISOString(), "2099-01-01T00:00:00.000Z");
      assert.strictEqual(sent.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("mints a fresh installation token when the kept one has too little time left", () => {
    const { sent, layer } = harness(() => json({ full_name: "octo/hello" }));

    return Effect.gen(function* () {
      const github = yield* GitHub;
      yield* github.installationToken(installation(4));
      // Five minutes before the fake's expiry: too little for ten minutes, enough for four.
      yield* TestClock.setTime(
        Date.parse("2099-01-01T00:00:00Z") - Duration.toMillis(Duration.minutes(5)),
      );
      yield* github.installationToken(installation(4), { minimumLifetime: Duration.minutes(4) });
      yield* github.installationToken(installation(4), { minimumLifetime: Duration.minutes(10) });

      assert.strictEqual(sent.length, 2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("asks again conditionally, and answers a 304 from the kept body", () => {
    const { reads, layer } = harness((request) =>
      request.headers.get("if-none-match") === '"v1"'
        ? new Response(null, { status: 304, headers: { etag: '"v1"' } })
        : json({ full_name: "octo/hello" }, 200, { etag: '"v1"' }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;
      const member = github.asMember(Redacted.make("gho_member"));
      yield* readRepository(member);
      const again = yield* readRepository(member);

      assert.strictEqual(again.status, 200);
      assert.deepStrictEqual(Schema.decodeUnknownSync(Repository)(again.data), {
        full_name: "octo/hello",
      });
      assert.deepStrictEqual(
        reads().map((request) => request.headers.get("if-none-match")),
        [null, '"v1"'],
      );
    }).pipe(Effect.provide(layer));
  });
});
