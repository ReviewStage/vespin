/**
 * pull-requests-app.ts -- what a pull request read by its repository and number serves as bytes rather than JSON: an image its overview names.
 *
 * `GET /api/pull-requests/github-image?workspaceId=&repository=&src=` reads
 * one image GitHub's rendering of a pull request of the repository names,
 * by the address it spelled (`src`), for a member of the workspace whose
 * installation reaches the repository, on a token minted for it as every
 * read by the repository and number is (`repository-pull-request.ts`), and
 * as an agent's tab reads one through the agent (`agents/agents-app.ts`).
 * Everything else about such a pull request answers through the hosted oRPC
 * router (`repository-pull-request-procedures.ts`). The bearer is resolved
 * before any row is touched, and a workspace the account is not a member of
 * answers exactly as an image GitHub holds none of.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { githubImageOf } from "@repo/features/github-image";
import {
  GITHUB_REPOSITORIES_QUERY,
  githubRepositoryFullNameSchema,
} from "@repo/features/github-repositories-wire";
import { workspaceIdSchema } from "@repo/features/task-wire";
import { HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Layer, Option, Result, type Scope } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { githubReadRefusal } from "../agents/asked-pull-request.js";
import { unparsedWire } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  resolvedUserId,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type GitHubApp, markRefusedToken } from "./github-app.js";
import { githubImage } from "./github-images.js";
import { reachedRepository } from "./repository-pull-request.js";

/** GET reads one image a pull request's overview names, by its repository and the address in the `src` query. */
const GITHUB_IMAGE_PATH = "/api/pull-requests/github-image";

/** The query the image's address is named under, beside the repository's place. */
const SRC_QUERY = "src";

export interface PullRequestsAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it. */
export type PullRequestsAppServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

type PullRequestsServices =
  | PullRequestsAppServices
  | HttpServerRequest.HttpServerRequest
  | Scope.Scope;

/** The one value the query named under `name` as `read` reads it; invalid where it names none, several, or one off its shape. */
const queried = <A>(
  query: URLSearchParams,
  name: string,
  read: (value: UnparsedWireValue) => Result.Result<A, unknown>,
): Effect.Effect<A, HostedRefusal> => {
  const named = query.getAll(name);
  const asked = named.length === 1 ? read(unparsedWire(named[0])) : undefined;

  return asked === undefined || Result.isFailure(asked)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(asked.success);
};

/**
 * GET reads one image a pull request of the repository names, as an
 * agent's tab reads one: an upload re-signed on a token minted for the
 * repository, a file of that repository read through its contents on the
 * same token, or a public image on GitHub's image proxy
 * (`github-images.ts`); refused as invalid for a query of no shape or an
 * address that is none of them, not found for a workspace the account is
 * not a member of or where GitHub answers no image the window draws, and
 * out of reach where the workspace no longer reaches the repository.
 */
const githubImageEndpoint = /* @__PURE__ */ Effect.fn("web/pullRequestGitHubImageEndpoint")(
  function* (
    seams: PullRequestsAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PullRequestsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;

    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }

    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const userId = yield* resolvedUserId(seams, request);
    const query = new URL(request.url).searchParams;
    const image = githubImageOf(query.get(SRC_QUERY) ?? "");

    if (image === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

    const workspaceId = yield* queried(
      query,
      GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID,
      readEither(workspaceIdSchema),
    );

    const repository = yield* queried(
      query,
      GITHUB_REPOSITORIES_QUERY.REPOSITORY,
      readEither(githubRepositoryFullNameSchema),
    );

    const { bearer, access, subject } = yield* reachedRepository(userId, {
      workspaceId,
      repository,
    });

    const read = yield* githubReadRefusal(
      githubImage(bearer, subject.repository, image).pipe(markRefusedToken(access)),
    );

    if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

    return HttpServerResponse.uint8Array(read.value.bytes, {
      status: HOSTED_HTTP_STATUS.OK,
      contentType: read.value.contentType,
      headers: HOSTED_BYTES_HEADERS,
    });
  },
);

/** The group: the image's bytes, and the hosted vocabulary's own refusal for any other path. */
export function pullRequestsApp(seams: PullRequestsAppSeams): WebRoutes<PullRequestsAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, GITHUB_IMAGE_PATH, hostedRefusing(githubImageEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
