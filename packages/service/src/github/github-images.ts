/**
 * github-images.ts -- one image GitHub's rendering of a pull request names, read for the window on the App's token: an upload re-signed by its asset's id, a file of the agent's own repository through its contents, or a public image on GitHub's own image proxy, as ReviewStage/stage's image proxy reads them.
 *
 * GitHub's rendering signs a private repository's uploads for about five
 * minutes, and names a public one at an address only a browser signed in
 * to GitHub may read, so neither is read as GitHub spelled it. An upload is
 * read by its asset's id alone (`@repo/features/github-image`): GitHub
 * renders a one-line image of that asset in the agent's repository on the
 * App's token for it, which answers a freshly signed address, and the image
 * is read from there only where that address names the very asset asked
 * for. A file of a repository is read through the repository's contents
 * as its raw bytes on the token, only where the repository is the agent's
 * own, which is the one the token reaches, and as the type its extension
 * names, since GitHub serves it under a type of its own. A public image on
 * GitHub's image proxy is read as it stands. Neither the upload's read nor
 * the proxy's carries the token: a signed address is its own key, and
 * GitHub's image proxy needs none.
 *
 * Only an image of the types the window draws, within the bound, is
 * answered; anything else is none, and the window draws its link instead.
 * The signed address is never answered nor logged.
 */

import {
  GITHUB_IMAGE_BOUNDS,
  GITHUB_IMAGE_SOURCE,
  GITHUB_IMAGE_TYPE,
  type GitHubFileImage,
  type GitHubImage,
  type GitHubImageType,
  isUploadOf,
} from "@repo/features/github-image";
import type { GitHubFailure } from "@repo/github";
import { Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  GITHUB_FAILURE,
  GITHUB_USER_AGENT,
  type GitHubBearer,
  GitHubUnavailable,
  readBody,
  readStream,
  repositoryParts,
} from "./github-app.js";

/** What a read of an image fails with: GitHub's API as `@repo/github` says, or an image address that did not answer. */
type ImageReadFailure = GitHubFailure | GitHubUnavailable;

/** An image read for the window: its bytes and the type GitHub served them as. */
export interface ReadImage {
  readonly bytes: Uint8Array;
  readonly contentType: GitHubImageType;
}

const IMAGE_TYPES: ReadonlyMap<string, GitHubImageType> = new Map(
  Object.values(GITHUB_IMAGE_TYPE).map((type) => [type, type]),
);

/** The first image address GitHub's rendering of a line names, its entities read back. */
const RENDERED_SOURCE = /<img\b[^>]*?\ssrc="([^"]+)"/iu;

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

const ENTITY = /&(?:amp|lt|gt|quot|#39);/gu;

const ASCII = new TextEncoder();

/** The media type GitHub serves a repository's file as when asked for its raw bytes, whatever the file holds. */
const RAW_CONTENTS = "application/vnd.github.raw";

/** The bytes each type's file opens with, or for an SVG holds anywhere, which a repository's file must show to be read as it. */
const SIGNATURES: ReadonlyMap<GitHubImageType, (bytes: Uint8Array) => boolean> = new Map([
  [
    GITHUB_IMAGE_TYPE.PNG,
    (bytes) => opensWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  [GITHUB_IMAGE_TYPE.JPEG, (bytes) => opensWith(bytes, [0xff, 0xd8, 0xff])],
  [GITHUB_IMAGE_TYPE.GIF, (bytes) => opensWith(bytes, [...ASCII.encode("GIF8")])],
  [
    GITHUB_IMAGE_TYPE.WEBP,
    (bytes) =>
      opensWith(bytes, [...ASCII.encode("RIFF")]) &&
      opensWith(bytes.subarray(8), [...ASCII.encode("WEBP")]),
  ],
  // Note that an SVG may open with a declaration and comments of any length, so the whole file, within the bound, is read.
  [GITHUB_IMAGE_TYPE.SVG, (bytes) => new TextDecoder().decode(bytes).includes("<svg")],
]);

function opensWith(bytes: Uint8Array, opening: readonly number[]): boolean {
  return opening.every((byte, at) => bytes[at] === byte);
}

/** The media type an answer's `content-type` names, its parameters left off. */
function mediaTypeOf(header: string | undefined): string {
  return header?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** The type an answer's `content-type` names, where it is one the window draws. */
function imageTypeOf(header: string | undefined): GitHubImageType | undefined {
  return IMAGE_TYPES.get(mediaTypeOf(header));
}

/**
 * A freshly signed address for the upload, as GitHub renders a one-line
 * image of it in the repository on the token; none where GitHub renders
 * no image of it, or names any other.
 */
function signedUploadOf(
  bearer: GitHubBearer,
  fullName: string,
  assetId: string,
): Effect.Effect<Option.Option<string>, GitHubFailure> {
  const rendered = bearer.client.request("POST /markdown", {
    text: `![](https://github.com/user-attachments/assets/${assetId})`,
    mode: "gfm",
    context: fullName,
  });

  return rendered.pipe(
    Effect.flatMap((answer) => Effect.orElseSucceed(readBody(answer, Schema.String), () => "")),
    Effect.map((html) => {
      const spelled = RENDERED_SOURCE.exec(html)?.[1];
      const address = spelled?.replace(ENTITY, (entity) => ENTITIES.get(entity) ?? entity);

      return address !== undefined && isUploadOf(address, assetId)
        ? Option.some(address)
        : Option.none<string>();
    }),
    // Note that GitHub refusing the render is no image rather than a failure, as any answer but one it could not give.
    Effect.catchTags({
      GitHubNotFound: () => Effect.succeed(Option.none<string>()),
      GitHubForbidden: () => Effect.succeed(Option.none<string>()),
      GitHubUnauthorized: () => Effect.succeed(Option.none<string>()),
      GitHubRejected: () => Effect.succeed(Option.none<string>()),
    }),
  );
}

/** The image bytes read, as the type named, where there are some within the bound. */
function imageWithin(buffer: ArrayBuffer, contentType: GitHubImageType): Option.Option<ReadImage> {
  return buffer.byteLength === 0 || buffer.byteLength > GITHUB_IMAGE_BOUNDS.MAX_BYTES
    ? Option.none()
    : Option.some({ bytes: new Uint8Array(buffer), contentType });
}

/**
 * The image at an address, read with no credential, where it is one the
 * window draws within the bound. Note that the address is a signed upload or
 * GitHub's image proxy, never the REST API, so it goes around `@repo/github`.
 */
function imageAt(
  address: string,
): Effect.Effect<Option.Option<ReadImage>, GitHubUnavailable, HttpClient.HttpClient> {
  const request = HttpClientRequest.get(address).pipe(
    HttpClientRequest.setHeader("user-agent", GITHUB_USER_AGENT),
  );

  return Effect.scoped(
    Effect.flatMap(HttpClient.HttpClient, (client) =>
      client.execute(request).pipe(
        Effect.mapError(() => new GitHubUnavailable({ reason: GITHUB_FAILURE.TRANSPORT })),
        Effect.flatMap((response) => {
          const contentType = imageTypeOf(response.headers["content-type"]);
          const length = Number(response.headers["content-length"] ?? "0");

          if (response.status !== 200 || contentType === undefined) {
            return Effect.succeed(Option.none<ReadImage>());
          }

          if (length > GITHUB_IMAGE_BOUNDS.MAX_BYTES)
            return Effect.succeed(Option.none<ReadImage>());

          return Effect.map(
            Effect.orElseSucceed(response.arrayBuffer, () => new ArrayBuffer(0)),
            (buffer) => imageWithin(buffer, contentType),
          );
        }),
      ),
    ),
  );
}

/**
 * A file of the agent's own repository, its raw bytes read through the
 * repository's contents on the token, as the type its extension names where
 * its bytes show that type's signature; none for a file whose bytes are some
 * other kind, and none for a file of any other repository, which is never
 * asked for.
 */
function repositoryFile(
  bearer: GitHubBearer,
  fullName: string,
  file: GitHubFileImage,
): Effect.Effect<Option.Option<ReadImage>, GitHubFailure> {
  if (file.repository.toLowerCase() !== fullName.toLowerCase()) {
    return Effect.succeed(Option.none());
  }

  const read = bearer.client
    .request("GET /repos/{owner}/{repo}/contents/{path}", {
      ...repositoryParts(fullName),
      path: file.path.join("/"),
      ref: file.ref,
      headers: { accept: RAW_CONTENTS },
      parseSuccessResponseBody: false,
    })
    .pipe(
      Effect.flatMap((answer) => {
        const headers = answer.headers;
        const length = Number(headers["content-length"] ?? "0");

        // Note that GitHub serves the raw bytes under its own type, so a JSON answer, a directory's listing, is no image.
        if (mediaTypeOf(headers["content-type"]) !== RAW_CONTENTS) {
          return Effect.succeed(Option.none<ReadImage>());
        }

        if (length > GITHUB_IMAGE_BOUNDS.MAX_BYTES) return Effect.succeed(Option.none<ReadImage>());

        return readStream(answer).pipe(
          Effect.flatMap((body) => Effect.promise(() => new Response(body).arrayBuffer())),
          Effect.map((buffer) => imageWithin(buffer, file.contentType)),
        );
      }),
      Effect.catchTags({
        GitHubNotFound: () => Effect.succeed(Option.none<ReadImage>()),
        GitHubForbidden: () => Effect.succeed(Option.none<ReadImage>()),
        GitHubRejected: () => Effect.succeed(Option.none<ReadImage>()),
        GitHubUnreadable: () => Effect.succeed(Option.none<ReadImage>()),
      }),
    );

  return Effect.map(
    read,
    Option.filter((image) => SIGNATURES.get(image.contentType)?.(image.bytes) === true),
  );
}

/**
 * The image GitHub's rendering of a pull request in the repository names:
 * an upload re-signed on the token and read from its signed address, a file
 * of that repository read through its contents on the token, or a public
 * image read as it stands; none where GitHub answers none of the types the
 * window draws within the bound.
 */
export const githubImage = /* @__PURE__ */ Effect.fn("web/githubImage")(function* (
  bearer: GitHubBearer,
  fullName: string,
  image: GitHubImage,
): Effect.fn.Return<Option.Option<ReadImage>, ImageReadFailure, HttpClient.HttpClient> {
  if (image.source === GITHUB_IMAGE_SOURCE.PUBLIC) return yield* imageAt(image.url);

  if (image.source === GITHUB_IMAGE_SOURCE.FILE) {
    return yield* repositoryFile(bearer, fullName, image);
  }

  const signed = yield* signedUploadOf(bearer, fullName, image.assetId);

  if (Option.isNone(signed)) return Option.none();

  return yield* imageAt(signed.value);
});
