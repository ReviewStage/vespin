/**
 * repository-file.ts -- one file of a repository as GitHub holds it on a branch or at a commit, read through the contents API on a token the App minted for that repository alone.
 *
 * The read answers facts and bytes, never a decision: whether the path is a
 * regular file of the tree, its size, and its bytes where GitHub carries
 * them, which `tasks/shown-file.ts` decides on exactly as it decides on the
 * brain checkout's probe. A path GitHub would resolve outside the
 * repository's contents (an empty, `.`, or `..` segment, which a URL folds
 * away) is asked nothing and reads as no file. A link, a directory, or a
 * submodule is no regular file. The request is sent on the bearer's
 * `@repo/github` client, so the token leaves this module no more than it
 * leaves that one.
 */

import type { GitHubFailure } from "@repo/github";
import { Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { type GitHubBearer, githubRead, readOptional, repositoryParts } from "./github-app.js";

/** What GitHub answers for a regular file: its size, and its bytes in base64 where it carries them (up to a megabyte). */
const FileContentsSchema = Schema.Struct({
  type: Schema.Literal("file"),
  size: Schema.Number,
  encoding: Schema.String,
  content: Schema.String,
});

/** Any other answer of the contents API: a link, a submodule, or a directory's listing. */
const OtherContentsSchema = Schema.Union([
  Schema.Struct({ type: Schema.String }),
  Schema.Array(Schema.Unknown),
]);

const ContentsSchema = Schema.Union([FileContentsSchema, OtherContentsSchema]);

/** The encoding GitHub carries a file's bytes in. */
const BASE64 = "base64";

/**
 * One file of the tree as GitHub holds it: no regular file at the path, and
 * whether that is because GitHub found nothing there on the branch; or its
 * size and bytes, bytes absent where GitHub carries none.
 */
export type RepositoryFile =
  | { readonly regular: false; readonly notFound: boolean }
  | { readonly regular: true; readonly bytes: number; readonly content: Uint8Array | undefined };

/** Nothing at the path on the branch, as GitHub answered. */
const NOT_FOUND: RepositoryFile = { regular: false, notFound: true };

/** Something at the path that is no regular file, or a path nothing was asked of. */
const NOT_REGULAR: RepositoryFile = { regular: false, notFound: false };

/** A path's segments, or nothing where a segment would leave the repository's contents, as a URL folds an empty, `.`, or `..` one away. */
export function repositorySegments(path: string): readonly string[] | undefined {
  const segments = path.split("/");

  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }

  return segments;
}

/** The repository's file at the path on the branch or at the commit named, as the contents API holds it. */
export function readRepositoryFile(
  bearer: GitHubBearer,
  repository: { readonly fullName: string },
  ref: string,
  path: string,
): Effect.Effect<RepositoryFile, GitHubFailure> {
  return Effect.gen(function* () {
    if (repositorySegments(path) === undefined) return NOT_REGULAR;

    const read = yield* readOptional(
      githubRead(
        bearer.client.request("GET /repos/{owner}/{repo}/contents/{path}", {
          ...repositoryParts(repository.fullName),
          path,
          ref,
        }),
        ContentsSchema,
      ),
    );

    if (Option.isNone(read)) return NOT_FOUND;
    const answer = read.value;

    if (!Schema.is(FileContentsSchema)(answer)) return NOT_REGULAR;

    const decoded =
      answer.encoding === BASE64
        ? Result.getOrUndefined(Base64.decode(answer.content.replace(/\s/gu, "")))
        : undefined;

    return { regular: true, bytes: answer.size, content: decoded } satisfies RepositoryFile;
  });
}

/** What GitHub answers for a branch's ref: the commit it stands at. */
const BranchRefSchema = Schema.Struct({
  object: Schema.Struct({ type: Schema.Literal("commit"), sha: Schema.String }),
});

/**
 * The commit a branch of the repository stands at now, so lines read at it
 * can be named by the commit they were read at; nothing where GitHub names
 * no commit for it.
 */
export function readBranchHead(
  bearer: GitHubBearer,
  repository: { readonly fullName: string },
  branch: string,
): Effect.Effect<string | undefined, GitHubFailure> {
  const read = githubRead(
    bearer.client.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
      ...repositoryParts(repository.fullName),
      ref: `heads/${branch}`,
    }),
    BranchRefSchema,
  );

  return Effect.map(readOptional(read), (answer) =>
    Option.getOrUndefined(Option.map(answer, (each) => each.object.sha)),
  );
}
