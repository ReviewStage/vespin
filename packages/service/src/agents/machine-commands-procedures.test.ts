/**
 * machine-commands-procedures.test.ts -- the Mac's held read and its posted results, byte for byte through the route, over a real dialect.
 *
 * The Mac's held read is answered with the command queued for its account
 * as soon as one waits, and with none once the hold ends; the result it
 * posts is kept for the agent's call. A read naming no kinds, or a kind
 * this service no longer queues, is handed shell commands alone; a call no
 * listening Mac can run is answered not run at once, and one the Mac
 * refuses is answered not run with the Mac's reason. Only the Mac's bearer
 * is read, never a cookie,
 * and before anything the body says. A command queued for one Mac the
 * member joined as a device is claimed by that Mac alone. Each refusal answers what the old
 * group answered. Over the sync hub, the held read answers within a coalesce
 * window of a command queued, and a call within one of the Mac settling it.
 *
 * Synthetic accounts, bearers, and commands throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readConversationPicture } from "@repo/database/models/conversation-pictures";
import {
  claimMachineCommands,
  machineCommandResult,
  machineCommandsWaiting,
  macListeningSince,
  markMachineListening,
  queueMachineCommand,
  settleMachineCommand,
} from "@repo/database/models/machine-command-store";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import {
  COMPUTER_ACTION,
  COMPUTER_BOUNDS,
  MACHINE_COMMAND_BOUNDS,
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  type MachineCommand,
  type MachineCommandResult,
  type MachineDeviceJoinRequest,
} from "@repo/features/machine-command-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { unparsedWire } from "@repo/wire";
import { mp4Bytes, pngBytes } from "@repo/wire/testing";
import { Clock, type Context, Effect, Fiber, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { wokenOnHub } from "../testing/sync-woken.js";
import { computerScreenshot, runComputerTool, storedComputerOutput } from "./computer-tool.js";
import { askMac, MACHINE_COMMAND_STATUS, machineCommandsFor } from "./machine-command.js";
import { machineCommandsProcedures } from "./machine-commands-procedures.js";

const ORIGIN = "https://app.test";
const MACHINE_COMMANDS = "/api/mac-commands";
const MACHINE_COMMAND_RECORDING = "/api/mac-commands/recording";
const CLAIM = "/api/mac-commands/claim";
const LISTENING = "/api/mac-commands/listening";
const DEVICE = "/api/mac-commands/device";
const JSON_TYPE = "application/json";

const COMMAND: MachineCommand = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: MACHINE_COMMAND_KIND.SHELL,
  command: "git status",
  timeoutSeconds: 60,
};

/** What a Mac from before agents lost the Mac's Browser tabs names in its query: shell, and a kind this service no longer queues. */
const STALE_KINDS = "shell,browser";

const RESULT: MachineCommandResult = {
  exitCode: 0,
  stdout: "nothing to commit\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

/** The answer as it left the handler: its status, the two headers a caller reads, and its bytes. */
interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

/** A refusal's bytes, which carry no cache-control. */
function refused(status: number, error: string): Bytes {
  return {
    status,
    contentType: JSON_TYPE,
    cacheControl: null,
    text: JSON.stringify({ error }),
  };
}

function request(
  init: {
    method?: string;
    userId?: string;
    cookie?: boolean;
    body?: string;
    length?: number;
    kinds?: string;
    path?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {};

  if (init.userId !== undefined) headers.authorization = `Bearer ${init.userId}`;

  if (init.cookie === true) headers.cookie = "session=s1";

  if (init.body !== undefined) headers["content-type"] = JSON_TYPE;

  if (init.length !== undefined) headers["content-length"] = String(init.length);
  const url = new URL(init.path ?? MACHINE_COMMANDS, ORIGIN);

  if (init.kinds !== undefined) url.searchParams.set("kinds", init.kinds);

  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? undefined : { body: init.body }),
  });
}

/**
 * The route answering one request over the test's database, on the
 * fiber's own clock, so a held read waits on the test's. The resolver
 * names any `user-…` bearer, and would name a cookie's caller too, so a
 * refused cookie is the route's own doing.
 */
const bytes = (incoming: Request) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );

    const context = yield* Effect.context<SqlClient.SqlClient>().pipe(Effect.provide(services));

    const handle = hostedFetch({
      machineCommands: machineCommandsProcedures({
        resolveUserId: (asked) =>
          Effect.succeed(
            Option.fromNullishOr(
              asked.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1] ??
                (asked.headers.has("cookie") ? "user-cookie" : undefined),
            ),
          ),
      }),
    });

    // SAFETY: the procedures yield the database and the clock alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;
    const response = yield* Effect.promise(() => handle(incoming, webServices));

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });

const account = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  });

/** The commands a read was answered with, as the Mac reads its bytes. */
const commandsOf = (answer: Bytes): readonly MachineCommand[] => JSON.parse(answer.text).commands;

/** A held read that finds nothing waiting, answered once its hold of twenty seconds ends on the test's clock. */
const emptyRead = (incoming: Request) =>
  Effect.gen(function* () {
    const read = yield* Effect.forkChild(bytes(incoming));
    yield* TestClock.adjust("20 seconds");

    return yield* Fiber.join(read);
  });

/** Lets a forked call's statements run until a command waits for the account. */
const untilQueued = (userId: string) =>
  Effect.gen(function* () {
    const since = new Date(yield* Clock.currentTimeMillis);
    const kinds = [MACHINE_COMMAND_KIND.SHELL];

    while (!(yield* machineCommandsWaiting(userId, since, kinds))) yield* Effect.yieldNow;
  });

it.layer(getTestDB())("a command run on the developer's Mac", (it) => {
  it.effect("the held read answers the queued command, and the result posted is kept", () =>
    Effect.gen(function* () {
      yield* account("user-mac");
      yield* queueMachineCommand("user-mac", COMMAND);

      assert.deepEqual(yield* bytes(request({ userId: "user-mac" })), {
        status: HOSTED_HTTP_STATUS.OK,
        contentType: JSON_TYPE,
        cacheControl: "private, no-store",
        text: JSON.stringify({ commands: [COMMAND] }),
      });
      const posted = JSON.stringify({ id: COMMAND.id, result: RESULT });
      assert.deepEqual(
        yield* bytes(request({ method: "POST", userId: "user-mac", body: posted })),
        {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: JSON_TYPE,
          cacheControl: "private, no-store",
          text: '{"settled":true}',
        },
      );
      assert.deepEqual(yield* machineCommandResult("user-mac", COMMAND.id), Option.some(RESULT));
    }),
  );

  it.effect(
    "a read naming no kinds, or a kind this service no longer queues, is handed shell commands",
    () =>
      Effect.gen(function* () {
        yield* account("user-older");
        const shell = { ...COMMAND, id: "44444444-4444-4444-8444-444444444444" };
        const later = { ...COMMAND, id: "33333333-3333-4333-8333-333333333333" };
        yield* queueMachineCommand("user-older", shell);

        const older = yield* bytes(request({ userId: "user-older" }));
        yield* queueMachineCommand("user-older", later);
        const stale = yield* bytes(request({ userId: "user-older", kinds: STALE_KINDS }));

        assert.deepEqual(commandsOf(older), [shell]);
        assert.deepEqual(commandsOf(stale), [later]);
      }),
  );

  it.effect(
    "a call no listening Mac can run is answered not run at once, and nothing is queued",
    () =>
      Effect.gen(function* () {
        yield* account("user-no-mac");

        const answer = yield* askMac("user-no-mac", {
          kind: MACHINE_COMMAND_KIND.SHELL,
          command: COMMAND.command,
        });

        const read = yield* emptyRead(request({ userId: "user-no-mac" }));

        assert.equal(answer.status, MACHINE_COMMAND_STATUS.NOT_RUN);
        assert.match(
          "reason" in answer ? answer.reason : "",
          /not running on the developer's Mac/u,
        );
        assert.deepEqual(commandsOf(read), [], "nothing was left queued");
      }),
  );

  it.effect("a command the Mac refuses is answered not run, with the Mac's reason", () =>
    Effect.gen(function* () {
      yield* account("user-refuses");
      yield* emptyRead(request({ userId: "user-refuses" }));

      const call = yield* Effect.forkChild(
        askMac("user-refuses", { kind: MACHINE_COMMAND_KIND.SHELL, command: COMMAND.command }),
      );

      yield* untilQueued("user-refuses");
      const [taken] = commandsOf(yield* bytes(request({ userId: "user-refuses" })));
      const refused = "Not run: this Mac names no home folder.";
      const posted = JSON.stringify({ id: taken?.id, result: { refused } });
      yield* bytes(request({ method: "POST", userId: "user-refuses", body: posted }));
      yield* TestClock.adjust("1 second");

      assert.equal(taken?.kind, MACHINE_COMMAND_KIND.SHELL);
      assert.deepEqual(yield* Fiber.join(call), {
        status: MACHINE_COMMAND_STATUS.NOT_RUN,
        reason: refused,
      });
    }),
  );

  it.effect(
    "only the Mac's bearer is read, never a cookie, and before anything the body says",
    () =>
      Effect.gen(function* () {
        const invalidToken = refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, "invalid-token");
        assert.deepEqual(yield* bytes(request()), invalidToken);
        assert.deepEqual(yield* bytes(request({ cookie: true })), invalidToken);
        assert.deepEqual(
          yield* bytes(request({ method: "POST", body: '{"id":"not-a-command"}' })),
          invalidToken,
        );
      }),
  );

  it.effect("a result is refused as the old group refused it", () =>
    Effect.gen(function* () {
      yield* account("user-refused");

      const post = (body: string, length?: number) =>
        bytes(
          request({
            method: "POST",
            userId: "user-refused",
            body,
            ...(length === undefined ? undefined : { length }),
          }),
        );

      const settle = { id: COMMAND.id, result: RESULT };

      assert.deepEqual(
        yield* post(JSON.stringify(settle)),
        refused(HOSTED_HTTP_STATUS.NOT_FOUND, "not-found"),
      );
      assert.deepEqual(
        yield* post(JSON.stringify({ ...settle, extra: true })),
        refused(HOSTED_HTTP_STATUS.BAD_REQUEST, "invalid-request"),
      );
      assert.deepEqual(
        yield* post(JSON.stringify(settle), MACHINE_COMMAND_BOUNDS.MAX_RESULT_BYTES + 1),
        refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, "request-too-large"),
      );
      assert.deepEqual(
        yield* bytes(request({ method: "PUT", userId: "user-refused" })),
        refused(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, "method-not-allowed"),
      );
    }),
  );

  it.effect("a window read at every bound the wire allows is taken and kept", () =>
    Effect.gen(function* () {
      yield* account("user-largest");

      const read: MachineCommand = {
        id: randomUUID(),
        kind: MACHINE_COMMAND_KIND.COMPUTER,
        conversationId: randomUUID(),
        action: {
          op: COMPUTER_ACTION.GET_APP_STATE,
          app: "Simulator",
          shots: [{ edge: COMPUTER_BOUNDS.MAX_SHOT_EDGE, quality: 1 }],
        },
        timeoutSeconds: 60,
      };

      yield* queueMachineCommand("user-largest", read);
      yield* claimMachineCommands("user-largest", new Date(0), [MACHINE_COMMAND_KIND.COMPUTER]);
      // Note that every word but base64 is a character UTF-8 spells in three bytes, the most a character the helper writes takes.
      const wide = (chars: number) => "…".repeat(chars);

      const shot = {
        width: COMPUTER_BOUNDS.MAX_SHOT_EDGE,
        height: COMPUTER_BOUNDS.MAX_SHOT_EDGE,
        jpeg: "A".repeat(COMPUTER_BOUNDS.MAX_SHOT_CHARS),
      };

      const largest: MachineCommandResult = {
        computer: {
          app: {
            name: wide(COMPUTER_BOUNDS.MAX_APP_CHARS),
            bundleId: wide(COMPUTER_BOUNDS.MAX_APP_CHARS),
            iconPng: "A".repeat(COMPUTER_BOUNDS.MAX_ICON_CHARS),
            refused: false,
          },
          window: { title: wide(COMPUTER_BOUNDS.MAX_TEXT_CHARS), x: 0, y: 0, width: 1, height: 1 },
          elements: wide(COMPUTER_BOUNDS.MAX_ELEMENTS_CHARS),
          truncated: true,
          shots: [shot, shot],
        },
      };

      const posted = yield* bytes(
        request({
          method: "POST",
          userId: "user-largest",
          body: JSON.stringify({ id: read.id, result: largest }),
        }),
      );

      assert.equal(posted.text, '{"settled":true}');
      assert.deepEqual(yield* machineCommandResult("user-largest", read.id), Option.some(largest));
    }),
  );

  it.effect(
    "a command heard of live is claimed by its id once, by its own account, and answered with what to run",
    () =>
      Effect.gen(function* () {
        yield* account("user-claims");
        yield* account("user-claims-other");
        const queued = { ...COMMAND, id: randomUUID() };
        yield* queueMachineCommand("user-claims", queued);

        const claim = (userId: string, body: string) =>
          bytes(request({ method: "POST", path: CLAIM, userId, body }));

        const asked = JSON.stringify({ id: queued.id });
        const notFound = refused(HOSTED_HTTP_STATUS.NOT_FOUND, "not-found");

        assert.deepEqual(yield* claim("user-claims-other", asked), notFound);
        assert.deepEqual(yield* claim("user-claims", asked), {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: JSON_TYPE,
          cacheControl: "private, no-store",
          text: JSON.stringify({ command: queued }),
        });
        assert.deepEqual(yield* claim("user-claims", asked), notFound, "claimed once");
        assert.deepEqual(
          yield* claim("user-claims", '{"id":"not-an-id"}'),
          refused(HOSTED_HTTP_STATUS.BAD_REQUEST, "invalid-request"),
        );
        assert.deepEqual(
          yield* bytes(request({ method: "POST", path: CLAIM, cookie: true, body: asked })),
          refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, "invalid-token"),
          "never on a cookie",
        );
      }),
  );

  it.effect(
    "a command queued for one of the member's Macs is claimed by that Mac alone, not another of theirs",
    () =>
      Effect.gen(function* () {
        yield* account("user-two-macs");

        const post = (
          path: string,
          body: MachineDeviceJoinRequest | { readonly id: string; readonly deviceId?: string },
        ) =>
          bytes(
            request({ method: "POST", path, userId: "user-two-macs", body: JSON.stringify(body) }),
          );

        const [laptop, studio] = [randomUUID(), randomUUID()];

        for (const [deviceId, name] of [
          [laptop, "Laptop"],
          [studio, "Studio"],
        ] as const) {
          const joined = yield* post(DEVICE, {
            deviceId,
            name,
            platform: DEVICE_PLATFORM.DARWIN,
            arch: DEVICE_ARCH.ARM64,
            settings: { commandMode: MACHINE_COMMAND_MODE.ASK, alwaysAllowedApps: [] },
          });

          assert.equal(joined.status, HOSTED_HTTP_STATUS.OK);
        }

        const queued = { ...COMMAND, id: randomUUID() };
        yield* queueMachineCommand("user-two-macs", queued, studio);
        const notFound = refused(HOSTED_HTTP_STATUS.NOT_FOUND, "not-found");

        assert.deepEqual(yield* post(CLAIM, { id: queued.id, deviceId: laptop }), notFound);
        assert.deepEqual(
          yield* post(CLAIM, { id: queued.id }),
          notFound,
          "a Mac naming no device takes none meant for one",
        );
        assert.deepEqual(
          JSON.parse((yield* post(CLAIM, { id: queued.id, deviceId: studio })).text),
          { command: queued },
        );
      }),
  );

  it.effect(
    "a Mac that says it listens is counted listening, whatever kinds it names, for its own account alone",
    () =>
      Effect.gen(function* () {
        yield* account("user-listens");
        yield* account("user-silent");
        const since = new Date(yield* Clock.currentTimeMillis);

        assert.deepEqual(
          yield* bytes(
            request({
              method: "POST",
              path: LISTENING,
              userId: "user-listens",
              body: JSON.stringify({ kinds: STALE_KINDS }),
            }),
          ),
          {
            status: HOSTED_HTTP_STATUS.OK,
            contentType: JSON_TYPE,
            cacheControl: "private, no-store",
            text: '{"listening":true}',
          },
        );
        assert.equal(yield* macListeningSince("user-listens", since), true);
        assert.equal(yield* macListeningSince("user-silent", since), false);
      }),
  );

  it.effect(
    "on Vespin Sync, the held read answers a command queued, and a call its result, each within a coalesce window of the write",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* account("user-sync");
          const kinds = [MACHINE_COMMAND_KIND.SHELL];
          const queued = { ...COMMAND, id: randomUUID() };

          const read = yield* wokenOnHub(
            machineCommandsFor("user-sync", kinds),
            queueMachineCommand("user-sync", queued),
          );

          const call = yield* wokenOnHub(
            askMac("user-sync", { kind: MACHINE_COMMAND_KIND.SHELL, command: COMMAND.command }),
            Effect.gen(function* () {
              const [claimed] = yield* claimMachineCommands("user-sync", new Date(0), kinds);
              assert.ok(claimed !== undefined, "the call queued its command");
              yield* settleMachineCommand("user-sync", claimed.id, RESULT);
            }),
          );

          assert.deepEqual(read.answered, [queued]);
          assert.deepEqual(call.answered, { status: MACHINE_COMMAND_STATUS.RAN, ...RESULT });
        }),
      ),
  );
  it.effect(
    "a computer read keeps the window's full copy and the app's icon beside the transcript, hands the model its own copy, and stores neither base64",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* account("user-computer");
          const db = yield* Database;

          const [row] = yield* db
            .insert(conversations)
            .values({ userId: "user-computer", kind: CONVERSATION_KIND.AGENT })
            .returning({ id: conversations.id });

          assert.ok(row);
          const target = { userId: "user-computer", conversationId: row.id };
          yield* markMachineListening("user-computer");
          const shown = Buffer.from(pngBytes(640, 400, 1)).toString("base64");
          const full = Buffer.from(pngBytes(1280, 800, 2)).toString("base64");
          const icon = Buffer.from(pngBytes(64, 64, 3)).toString("base64");

          const call = yield* wokenOnHub(
            runComputerTool(target, { action: "get_app_state", app: "Simulator" }),
            Effect.gen(function* () {
              const [claimed] = yield* claimMachineCommands("user-computer", new Date(0), [
                MACHINE_COMMAND_KIND.COMPUTER,
              ]);

              assert.ok(claimed !== undefined && claimed.kind === MACHINE_COMMAND_KIND.COMPUTER);
              assert.equal(
                claimed.conversationId,
                row.id,
                "the command names the conversation that asked",
              );
              yield* settleMachineCommand("user-computer", claimed.id, {
                computer: {
                  app: {
                    name: "Simulator",
                    bundleId: "com.apple.iphonesimulator",
                    iconPng: icon,
                    refused: false,
                  },
                  window: { title: "iPhone 18 Pro", x: 0, y: 0, width: 640, height: 400 },
                  elements: '[0] AXWindow "iPhone 18 Pro"',
                  truncated: false,
                  shots: [
                    { width: 640, height: 400, jpeg: shown },
                    { width: 1280, height: 800, jpeg: full },
                  ],
                },
              });
            }),
          );

          const answer = unparsedWire(call.answered);
          assert.equal(computerScreenshot(answer)?.data, shown, "the model is handed its own copy");
          const stored = JSON.stringify(storedComputerOutput(answer));

          for (const base64 of [shown, full, icon]) {
            assert.equal(
              stored.includes(base64),
              false,
              "no picture is spelled out in what is stored",
            );
          }

          const read = Schema.decodeUnknownSync(
            Schema.Struct({
              app: Schema.Struct({
                icon: Schema.Struct({ picture: Schema.Struct({ id: Schema.String }) }),
              }),
              kept: Schema.Struct({
                picture: Schema.Struct({ id: Schema.String, width: Schema.Number }),
              }),
            }),
          )(answer);

          assert.equal(read.kept.picture.width, 1280);

          for (const id of [read.kept.picture.id, read.app.icon.picture.id]) {
            assert.ok(
              Option.isSome(yield* readConversationPicture(row.id, id)),
              "kept beside the transcript",
            );
          }
        }),
      ),
  );
  it.effect(
    "a stopped recording's video, posted through the route before its result, is kept beside the transcript as the MP4 it is and saved where the agent can post it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* account("user-recording");
          const db = yield* Database;

          const [row] = yield* db
            .insert(conversations)
            .values({ userId: "user-recording", kind: CONVERSATION_KIND.AGENT })
            .returning({ id: conversations.id });

          assert.ok(row);
          const target = { userId: "user-recording", conversationId: row.id };
          yield* markMachineListening("user-recording");
          const video = mp4Bytes(603, 1311);
          const saved: { name: string; contents: Uint8Array }[] = [];

          const door = () =>
            Promise.resolve({
              readFile: () => Promise.resolve(null),
              writeFile: (file: { readonly name: string; readonly contents: Uint8Array }) => {
                saved.push(file);

                return Promise.resolve(`/workspace/.agent/attachments/${file.name}`);
              },
            });

          const call = yield* wokenOnHub(
            runComputerTool(
              target,
              { action: "stop_recording", caption: "Signing in on the phone" },
              door,
            ),
            Effect.gen(function* () {
              const [claimed] = yield* claimMachineCommands("user-recording", new Date(0), [
                MACHINE_COMMAND_KIND.COMPUTER,
              ]);

              assert.ok(claimed !== undefined);

              const post = (mp4: Uint8Array) =>
                bytes(
                  request({
                    method: "POST",
                    userId: "user-recording",
                    path: MACHINE_COMMAND_RECORDING,
                    body: JSON.stringify({
                      id: claimed.id,
                      mp4: Buffer.from(mp4).toString("base64"),
                    }),
                  }),
                );

              const refused = yield* post(mp4Bytes(603, 1311, true));
              assert.equal(
                refused.status,
                HOSTED_HTTP_STATUS.BAD_REQUEST,
                "an MP4 no player streams is refused",
              );
              assert.equal((yield* post(video)).status, HOSTED_HTTP_STATUS.OK);

              yield* settleMachineCommand("user-recording", claimed.id, {
                computer: {
                  recorded: { seconds: 10, width: 603, height: 1311, byteCount: video.byteLength },
                },
              });
            }),
          );

          const answer = Schema.decodeUnknownSync(
            Schema.Struct({
              status: Schema.Literal(MACHINE_COMMAND_STATUS.RAN),
              seconds: Schema.Number,
              caption: Schema.String,
              path: Schema.String,
              picture: Schema.Struct({ id: Schema.String, mediaType: Schema.String }),
            }),
          )(call.answered);

          assert.equal(answer.caption, "Signing in on the phone");
          assert.equal(answer.picture.mediaType, MP4_TYPE);
          assert.deepEqual(
            saved.map((file) => file.contents),
            [video],
            "saved as it came",
          );
          assert.equal(answer.path, `/workspace/.agent/attachments/${saved[0]?.name}`);
          const kept = yield* readConversationPicture(row.id, answer.picture.id);
          assert.ok(Option.isSome(kept), "kept beside the transcript");
          assert.deepEqual(kept.value.bytes, video);
        }),
      ),
  );
});
