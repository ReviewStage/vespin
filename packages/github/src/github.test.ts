/**
 * github.test.ts -- the GitHub service over a fake HttpClient: what it sends, what a refusal holds, the members' reserve, and conditional requests.
 */

import { generateKeyPairSync } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Context, Duration, Effect, Fiber, Layer, Predicate, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
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

/** Whose fiber context a request went out under: the layer's, unless a caller names itself. */
const CALLER_HEADER = "x-test-caller";
const Caller = Context.Reference<string>("github.test/Caller", { defaultValue: () => "layer" });

/** One request the fake was sent, whose context it went out under, and the signal that aborts it. */
interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly caller: string;
  readonly signal: AbortSignal | null | undefined;
}

type Answer = (sent: Sent) => Response | Promise<Response>;

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

  const fake = fakeHttpClientLayer((url, init) => {
    const headers = new Headers(init.headers);

    const request = {
      method: init.method ?? "GET",
      url,
      headers,
      caller: headers.get(CALLER_HEADER) ?? "",
      signal: init.signal,
    };

    sent.push(request);

    return minted(request) ?? answer(request);
  });

  // Note that the client marks each request with the `Caller` of the fiber context it runs under.
  const http = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      return HttpClient.mapRequestEffect(client, (request) =>
        Effect.gen(function* () {
          return HttpClientRequest.setHeader(request, CALLER_HEADER, yield* Caller);
        }),
      );
    }),
  ).pipe(Layer.provide(fake));

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

  it.effect("sends a body under the content type Octokit names", () => {
    const { sent, layer } = harness(() => json({ access_token: "ghu_fresh" }));

    return Effect.gen(function* () {
      const github = yield* GitHub;
      const oauth = github.oauth({ clientId: "Iv1.client", clientSecret: Redacted.make("secret") });
      yield* oauth.refreshToken(Redacted.make("ghr_refresh"));

      // Note that GitHub answers a token request sent as anything but JSON or a form with a 404.
      assert.strictEqual(sent[0]?.headers.get("content-type"), "application/json; charset=utf-8");
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

  it.effect(
    "fails a listing that still names a next page at its bound, rather than answering part of it",
    () => {
      const { layer } = harness((request) =>
        Response.json([{ name: "main" }], {
          headers: { link: `<${request.url.split("?")[0]}?page=9>; rel="next"` },
        }),
      );

      return Effect.gen(function* () {
        const github = yield* GitHub;

        const listed = yield* github
          .asMember(Redacted.make("gho_member"))
          .paginate("GET /repos/{owner}/{repo}/branches", REPOSITORY, { maxPages: 2 })
          .pipe(Effect.flip);

        assert.strictEqual(listed._tag, "GitHubUnreadable");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("leaves a body asked for as bytes unread, whatever charset GitHub names", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    const { layer } = harness(
      () =>
        new Response(bytes, {
          headers: { "content-type": "application/vnd.github.raw; charset=utf-8" },
        }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const answer = yield* github
        .asMember(Redacted.make("gho_member"))
        .request("GET /repos/{owner}/{repo}/contents/{path}", {
          ...REPOSITORY,
          path: "logo.jpg",
          headers: { accept: "application/vnd.github.raw" },
          parseSuccessResponseBody: false,
        });

      const body = Schema.decodeUnknownSync(Schema.instanceOf(ReadableStream))(answer.data);
      const read = yield* Effect.promise(() => new Response(body).arrayBuffer());

      assert.deepStrictEqual(new Uint8Array(read), bytes);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails a refusal in GitHub's own words", () => {
    const { layer } = harness(() =>
      json(
        {
          message: "Reviews may only be requested from collaborators.",
          documentation_url: "https://docs.github.com",
        },
        422,
      ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const refused = yield* readRepository(github.asMember(Redacted.make("gho_member"))).pipe(
        Effect.flip,
      );

      assert.deepStrictEqual(
        { tag: refused._tag, message: refused.message },
        { tag: "GitHubRejected", message: "Reviews may only be requested from collaborators." },
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("answers a GraphQL read's partial data beside the errors GitHub gave", () => {
    const { layer } = harness(() =>
      Response.json({
        data: { r0: { name: "hello" }, r1: null },
        errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository." }],
      }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const answer = yield* github
        .asMember(Redacted.make("gho_member"))
        .graphqlPartial(
          'query { r0: repository(owner: "octo", name: "hello") { name } r1: repository(owner: "octo", name: "gone") { name } }',
          {},
          Schema.Record(Schema.String, Schema.NullOr(Schema.Struct({ name: Schema.String }))),
        );

      assert.deepStrictEqual(answer, {
        data: { r0: { name: "hello" }, r1: null },
        errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository." }],
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads a listing whose page wraps its items", () => {
    const { layer } = harness(() =>
      Response.json({ total_count: 1, repository_selection: "all", repositories: [{ id: 7 }] }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const listed = yield* github
        .asMember(Redacted.make("gho_member"))
        .paginate("GET /installation/repositories", { per_page: 100 }, { maxPages: 2 });

      assert.deepStrictEqual(
        listed.map((repository) => repository.id),
        [7],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends every page of a listing under the caller's context", () => {
    const branches = `${REPOSITORY_URL}/branches`;

    const { sent, layer } = harness((request) =>
      Response.json([{ name: "main" }], {
        headers: request.url.endsWith("page=2") ? {} : { link: `<${branches}?page=2>; rel="next"` },
      }),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      yield* github
        .asMember(Redacted.make("gho_member"))
        .paginate("GET /repos/{owner}/{repo}/branches", REPOSITORY, { maxPages: 2 })
        .pipe(Effect.provideService(Caller, "caller"));

      assert.deepStrictEqual(
        sent.map((request) => [request.url, request.caller]),
        [
          [branches, "caller"],
          [`${branches}?page=2`, "caller"],
        ],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("sends no further page of a listing once its caller is interrupted", () => {
    const branches = `${REPOSITORY_URL}/branches`;
    const firstAsked = Promise.withResolvers<void>();
    const firstAnswer = Promise.withResolvers<Response>();
    // Note that the listing settles one of two ways: the first page's request aborted before it was answered, or a second page asked for.
    const settled = Promise.withResolvers<string>();
    let answered = false;

    const { sent, layer } = harness((request) => {
      if (request.url !== branches) {
        settled.resolve("next page asked");

        return Response.json([]);
      }

      request.signal?.addEventListener("abort", () => {
        if (!answered) settled.resolve("aborted unanswered");
      });
      firstAsked.resolve();

      return firstAnswer.promise;
    });

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const listing = yield* github
        .asMember(Redacted.make("gho_member"))
        .paginate("GET /repos/{owner}/{repo}/branches", REPOSITORY, { maxPages: 2 })
        .pipe(Effect.forkChild);

      yield* Effect.promise(() => firstAsked.promise);
      yield* Fiber.interrupt(listing);
      answered = true;
      firstAnswer.resolve(
        Response.json([{ name: "main" }], {
          headers: { link: `<${branches}?page=2>; rel="next"` },
        }),
      );

      assert.strictEqual(yield* Effect.promise(() => settled.promise), "aborted unanswered");
      assert.deepStrictEqual(
        sent.map((request) => request.url),
        [branches],
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails a refusal that names a retry-after as rate limited until then", () => {
    const { layer } = harness(() =>
      json({ message: "You have exceeded a secondary rate limit." }, 403, { "retry-after": "60" }),
    );

    return Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000);
      const github = yield* GitHub;

      const refused = yield* readRepository(github.asMember(Redacted.make("gho_member"))).pipe(
        Effect.flip,
      );

      assert.ok(Predicate.isTagged(refused, "GitHubRateLimited"));
      assert.strictEqual(refused.resetsAt?.getTime(), 1_060_000);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "fails a GraphQL answer whose errors name no type as GitHub's refusal, in its words",
    () => {
      const { layer } = harness(() =>
        Response.json({
          data: null,
          errors: [{ message: "Review Can not approve your own pull request" }],
        }),
      );

      return Effect.gen(function* () {
        const github = yield* GitHub;

        const refused = yield* github
          .asMember(Redacted.make("gho_member"))
          .graphql("mutation { approve }", {}, Schema.Unknown)
          .pipe(Effect.flip);

        assert.deepStrictEqual(
          { tag: refused._tag, message: refused.message },
          { tag: "GitHubRejected", message: "Review Can not approve your own pull request" },
        );
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("hands a byte read its body as it streams, never waiting on the whole of it", () => {
    const first = new Uint8Array([0x1f, 0x8b]);

    const { layer } = harness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(first),
            // Note that the rest never comes, as a large archive's has not yet when its first bytes are read.
            pull: () => new Promise<void>(() => {}),
          }),
          { headers: { "content-type": "application/x-gzip" } },
        ),
    );

    return Effect.gen(function* () {
      const github = yield* GitHub;

      const answer = yield* github
        .asMember(Redacted.make("gho_member"))
        .request("GET /repos/{owner}/{repo}/tarball/{ref}", {
          ...REPOSITORY,
          ref: "main",
          parseSuccessResponseBody: false,
        });

      const body = Schema.decodeUnknownSync(Schema.instanceOf(ReadableStream))(answer.data);
      const read = yield* Effect.promise(() => body.getReader().read());

      assert.deepStrictEqual(read.value, first);
    }).pipe(Effect.provide(layer));
  });
});
