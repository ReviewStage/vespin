import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { DESCRIPTION_ATTACHMENT_KEEP } from "@repo/database/models/description-attachments";
import { DESCRIPTION_COMMENT_OUTCOME } from "@repo/database/models/description-comments";
import { createTask, saveDescriptionText } from "@repo/database/models/task-store";
import { attachment } from "@repo/database/schemas/attachment";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import {
  DESCRIPTION_ATTACHMENT_BOUNDS,
  DESCRIPTION_ATTACHMENT_REFUSAL,
  DESCRIPTION_FILE_TYPE,
  type DescriptionFile,
  descriptionAttachmentAnswerSchema,
} from "@repo/features/description-attachment-wire";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_SCOPE,
} from "@repo/features/description-comment-wire";
import { PICTURE_BOUNDS, PICTURE_MEDIA_TYPE, PICTURE_TYPE } from "@repo/features/picture-wire";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@repo/service/http/http";
import type { UserIdResolver } from "@repo/service/http/http-effect";
import { hostedFetch } from "@repo/service/orpc/handler";
import { modelCatalogOf } from "@repo/service/providers/model-catalog";
import type { WebServices } from "@repo/service/runtime";
import { attachmentBlobPath } from "@repo/service/storage/attachment-blob-paths";
import { keepDescriptionFileBytes } from "@repo/service/storage/attachment-keeps";
import { startDescriptionCommentThread } from "@repo/service/tasks/description-comment-writes";
import { taskFilesProcedures } from "@repo/service/tasks/task-files-procedures";
import { tasksApp } from "@repo/service/tasks/tasks-app";
import { type MemoryBlobStore, memoryBlobStore } from "@repo/service/testing/blob-store-fake";
import {
  type OpenedPagePolicy,
  openedPagePolicy,
  SANDBOXED_PAGE,
} from "@repo/service/testing/content-policy";
import { NO_GITHUB } from "@repo/service/testing/github-app-fake";
import {
  CONNECTOR_ASKED_NOTHING,
  integrationConnectOf,
} from "@repo/service/testing/integration-connect";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { m4aBytes, paddedTo, webmBytes } from "@repo/wire/testing";
import { Clock, type Context, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";

/**
 * A description's pictures through the routes a desktop calls, over a real
 * dialect: a member keeps a picture on a teammate's description and every member
 * of the workspace reads its bytes back under the type they were sniffed
 * to be, never cached on the way; an account outside the workspace keeps
 * and reads nothing, exactly as for a plan that does not exist; bytes that
 * are not the image their label names are refused; a recording is kept as
 * it was sent and served as a video, up to a sent video's bound and the
 * description's count of videos; and a description at its bound refuses in band. An upload is answered by the hosted oRPC router at the
 * plan's public path, and refuses exactly as the old route did. A file a
 * comment on the description carries is served at the same path, under the type
 * it traveled as, to the same members alone.
 *
 * Synthetic accounts, bearers, and pictures throughout.
 */

const ORIGIN = "https://app.test";
const ATTACHMENT = "/api/tasks/attachment";

/** A PNG's signature and a few bytes more: all the service reads of a picture. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

/** What a route answered: its status, type, cache rule, and body as bytes. */
interface Answered {
  readonly status: number;
  readonly contentType: string | null;
  readonly cache: string | null;
  readonly policy: OpenedPagePolicy;
  readonly bytes: Uint8Array;
  /** Where a redirect sends the reader; none for any other answer. */
  readonly location: string | null;
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** The Blob store the suite's requests keep files in and read them from, where a test names none of its own. */
const SUITE_BLOBS = memoryBlobStore();

/** The plan routes over the test's own database and the Blob store given, every bearer `Bearer <account>`, answering one request. */
const ask = (request: Request, blobs: MemoryBlobStore = SUITE_BLOBS) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      blobs.layer,
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      NO_GITHUB,
      modelCatalogOf([]),
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
    );

    const resolveUserId: UserIdResolver = (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
      );

    const { handler, dispose } = HttpRouter.toWebHandler(
      tasksApp({ resolveUserId }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );

    const keep = hostedFetch({ taskFiles: taskFilesProcedures({ resolveUserId }) });

    // SAFETY: the upload yields the services provided above alone, which is all a test provides of the web runtime's services.
    const webServices = (yield* Effect.scoped(
      Layer.build(services),
    )) as Context.Context<WebServices>;

    const response = yield* Effect.promise(() =>
      request.method === "POST" ? keep(request, webServices) : handler(request),
    );

    const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
    yield* Effect.promise(() => dispose());

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cache: response.headers.get("cache-control"),
      policy: openedPagePolicy(response.headers),
      bytes,
      location: response.headers.get("location"),
    } satisfies Answered;
  });

/** An upload as a desktop sends it, to the plan's own public path. */
function upload(
  taskId: string,
  userId: string | undefined,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(new URL(`/api/tasks/${taskId}/attachments`, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...headers,
    },
    body,
  });
}

/** One picture's upload, as JSON. */
function pictureBody(picture: string): string {
  return JSON.stringify({ picture });
}

/** A read as a native client sends it, or as a browser does where it names its Fetch Metadata mode. */
function read(taskId: string, attachmentId: string, userId: string, fetchMode?: string): Request {
  const url = new URL(ATTACHMENT, ORIGIN);
  url.searchParams.set("id", taskId);
  url.searchParams.set("attachment", attachmentId);

  return new Request(url, {
    headers: {
      authorization: `Bearer ${userId}`,
      ...(fetchMode === undefined ? undefined : { "sec-fetch-mode": fetchMode }),
    },
  });
}

/** An answer's JSON body as the upload's wire reads it, failing the test where it does not. */
function uploaded(answered: Answered) {
  const answer = readEither(descriptionAttachmentAnswerSchema)(
    unparsedWire(JSON.parse(new TextDecoder().decode(answered.bytes))),
  );

  if (Result.isFailure(answer)) return assert.fail(answer.failure.refusal);

  return answer.success;
}

/** A plan in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });

  return { owner, teammate, outsider, taskId: taskId };
});

it.layer(getTestDB())("a description's picture routes", (it) => {
  it.effect(
    "a file a teammate's comment carries is served to every member as its bytes, and to nobody else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;
        const text = "## Goal\n\nInvites expire in seven days.\n";
        yield* saveDescriptionText(owner, taskId, text);
        const pdf = new TextEncoder().encode("%PDF-1.4\n");
        const from = text.indexOf("seven days");

        const started = yield* startDescriptionCommentThread(
          { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: teammate },
          taskId,
          {
            clientKey: randomUUID(),
            scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
            quote: "seven days",
            anchor: { from, to: from + "seven days".length },
            text,
            words: "The flow is attached.",
            attachments: [
              {
                name: "flow.pdf",
                mediaType: AGENT_ATTACHMENT_TYPE.PDF,
                data: Buffer.from(pdf).toString("base64"),
              },
            ],
          },
        ).pipe(Effect.provide(SUITE_BLOBS.layer));

        assert.ok(
          started.status === DESCRIPTION_COMMENT_OUTCOME.DONE && "thread" in started.answer,
        );
        const fileId = started.answer.thread.entries[0]?.files?.[0]?.attachmentId;
        assert.ok(fileId !== undefined);

        const served = yield* ask(read(taskId, fileId, owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, AGENT_ATTACHMENT_TYPE.PDF);
        assert.equal(served.cache, "private, no-store");
        assert.deepEqual(served.policy, SANDBOXED_PAGE);
        assert.deepEqual([...served.bytes], [...pdf]);
        assert.equal(
          (yield* ask(read(taskId, fileId, outsider))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect(
    "a picture a teammate keeps on the description is served to every member as its bytes, and to nobody else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const kept = yield* ask(upload(taskId, teammate, pictureBody(PNG_URL)));

        assert.equal(kept.status, HOSTED_HTTP_STATUS.CREATED);
        const answer = uploaded(kept);
        assert.ok("id" in answer);
        // Note that the read is a browser tab's, which is piped the bytes, since a native reader is sent to the store.
        const served = yield* ask(read(taskId, answer.id, owner, "navigate"));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, PICTURE_TYPE.PNG);
        assert.equal(served.cache, "private, no-store");
        // Note that a page a browser opens from the bytes runs no script and stands in an origin of its own.
        assert.deepEqual(served.policy, SANDBOXED_PAGE);
        assert.deepEqual([...served.bytes], [...PNG_BYTES]);
        assert.equal(
          (yield* ask(read(taskId, answer.id, outsider))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
        assert.equal(
          (yield* ask(upload(taskId, outsider, pictureBody(PNG_URL)))).status,
          HOSTED_HTTP_STATUS.NOT_FOUND,
        );
      }),
  );

  it.effect(
    "a picture whose bytes stand in the Blob store sends a native reader to them and pipes them to a browser's tab, a PDF there is piped to every reader under its own type, and neither is served to an outsider",
    () =>
      Effect.gen(function* () {
        const { owner, outsider, taskId } = yield* openSharedTask;
        const blobs = memoryBlobStore();
        const pdf = new TextEncoder().encode("%PDF-1.4\n");

        const stored = (file: DescriptionFile) =>
          Effect.gen(function* () {
            const kept = yield* keepDescriptionFileBytes(owner, taskId, file).pipe(
              Effect.provide(blobs.layer),
            );

            assert.ok(kept.status === DESCRIPTION_ATTACHMENT_KEEP.KEPT);
            const blobKey = attachmentBlobPath(kept.id);

            return { id: kept.id, blobKey };
          });

        const picture = yield* stored({ contentType: PICTURE_TYPE.PNG, bytes: PNG_BYTES });
        const native = yield* ask(read(taskId, picture.id, owner), blobs);
        assert.equal(native.status, HOSTED_HTTP_STATUS.FOUND);
        assert.equal(new URL(native.location ?? "").pathname, `/${picture.blobKey}`);

        const tab = yield* ask(read(taskId, picture.id, owner, "navigate"), blobs);
        assert.equal(tab.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(tab.contentType, PICTURE_TYPE.PNG);
        assert.deepEqual(tab.policy, SANDBOXED_PAGE);
        assert.deepEqual([...tab.bytes], [...PNG_BYTES]);

        const spec = yield* stored({ contentType: DESCRIPTION_FILE_TYPE.PDF, bytes: pdf });
        const piped = yield* ask(read(taskId, spec.id, owner), blobs);
        assert.equal(piped.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(piped.contentType, DESCRIPTION_FILE_TYPE.PDF);
        assert.deepEqual([...piped.bytes], [...pdf]);

        for (const id of [picture.id, spec.id]) {
          assert.equal(
            (yield* ask(read(taskId, id, outsider), blobs)).status,
            HOSTED_HTTP_STATUS.NOT_FOUND,
          );
        }
      }),
  );

  it.effect("bytes that are not the image their label names are refused, and nothing is kept", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;
      const mislabeled = PNG_URL.replace("image/png", "image/webp");

      const refused = yield* ask(upload(taskId, owner, pictureBody(mislabeled)));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      assert.equal(
        JSON.parse(new TextDecoder().decode(refused.bytes)).error,
        HOSTED_API_ERROR.INVALID_REQUEST,
      );
    }),
  );

  it.effect(
    "an upload refuses as the old route did, byte for byte: no bearer before its body is read, a key the upload does not name, and a body past its bound",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;

        const bare = (answered: Answered) => ({
          status: answered.status,
          contentType: answered.contentType,
          cache: answered.cache,
          text: new TextDecoder().decode(answered.bytes),
        });

        const json = "application/json";

        assert.deepEqual(bare(yield* ask(upload(taskId, undefined, '{"picture":7}'))), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          contentType: json,
          cache: null,
          text: '{"error":"invalid-token"}',
        });
        assert.deepEqual(
          bare(yield* ask(upload(taskId, owner, JSON.stringify({ picture: PNG_URL, extra: 1 })))),
          {
            status: HOSTED_HTTP_STATUS.BAD_REQUEST,
            contentType: json,
            cache: null,
            text: '{"error":"invalid-request"}',
          },
        );
        assert.deepEqual(
          bare(
            yield* ask(
              upload(taskId, owner, pictureBody(PNG_URL), {
                "content-length": String(
                  Math.ceil(PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES / 3) * 4 + 1_025,
                ),
              }),
            ),
          ),
          {
            status: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
            contentType: json,
            cache: null,
            text: '{"error":"request-too-large"}',
          },
        );
        assert.deepEqual(bare(yield* ask(upload("not-a-plan", owner, pictureBody(PNG_URL)))), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          contentType: json,
          cache: null,
          text: '{"error":"not-found"}',
        });
      }),
  );

  it.effect("a description holding its bound of pictures refuses one more in band", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;
      const db = yield* Database;
      yield* db.insert(attachment).values(
        Array.from({ length: DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION }, () => ({
          taskId: taskId,
          userId: owner,
          contentType: PICTURE_TYPE.PNG,
          byteCount: PNG_BYTES.length,
          bytes: PNG_BYTES,
          createdAt: new Date(0),
        })),
      );

      const refused = yield* ask(upload(taskId, owner, pictureBody(PNG_URL)));

      assert.equal(refused.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(uploaded(refused), { refused: DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY });
    }),
  );

  it.effect(
    "a recording a member keeps is served as the video it was sent, and one past a sent video's bound is not kept",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const recording = webmBytes(1280, 800);

        const videoUrl = (bytes: Uint8Array) =>
          `data:${PICTURE_MEDIA_TYPE.WEBM};base64,${Buffer.from(bytes).toString("base64")}`;

        const kept = uploaded(yield* ask(upload(taskId, owner, pictureBody(videoUrl(recording)))));
        assert.ok("id" in kept);
        const served = yield* ask(read(taskId, kept.id, teammate, "navigate"));
        const long = paddedTo(recording, PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES + 1);
        const tooLong = yield* ask(upload(taskId, owner, pictureBody(videoUrl(long))));

        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.contentType, PICTURE_MEDIA_TYPE.WEBM);
        assert.deepEqual([...served.bytes], [...recording]);
        assert.equal(tooLong.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      }),
  );

  it.effect(
    "an M4A a member keeps is served as the sound clip it is, and one labeled a video is not kept",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const clip = m4aBytes();
        const base64 = Buffer.from(clip).toString("base64");

        const kept = uploaded(
          yield* ask(
            upload(taskId, owner, pictureBody(`data:${PICTURE_MEDIA_TYPE.M4A};base64,${base64}`)),
          ),
        );

        assert.ok("id" in kept);
        const served = yield* ask(read(taskId, kept.id, teammate, "navigate"));

        const mislabeled = yield* ask(
          upload(taskId, owner, pictureBody(`data:${PICTURE_MEDIA_TYPE.MP4};base64,${base64}`)),
        );

        assert.equal(served.contentType, PICTURE_MEDIA_TYPE.M4A);
        assert.deepEqual([...served.bytes], [...clip]);
        assert.equal(mislabeled.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      }),
  );
});
