import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { loopbackConsent } from "@repo/credentials/node";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH, IDEMPOTENCY_KEY } from "@repo/features";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WorkspacesLiveAnswer } from "@repo/features/workspace-live";
import { GATEWAY_ERROR, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { HOST_CAPABILITY } from "@repo/settings";
import { type RecordedRequest, recordingHttpClient } from "@repo/wire/testing";
import { Context, Effect, ErrorReporter, Layer, Option, Path, Result } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { AccountSourceHost } from "./account-source.js";
import { hostAssemblyLayer } from "./compose-host.js";
import { HostAssemblyTag, HostTag, hostStandingLayer } from "./effect/host.js";
import {
  LoopbackListener,
  MirrorPlatform,
  SecretCipher,
  SignInConsent,
  TerminalSocket,
  THIS_MAC_AGENT_STATUS,
  ThisMacHost,
} from "./effect/seams.js";
import {
  ALL_CLIENT_CAPABILITIES,
  ALL_HOST_PLATFORM_CONCERNS,
  type ClientCapability,
  HOST_CONCERN,
  hostCapabilities,
  NOT_ON_THIS_PLATFORM,
} from "./host-concerns.js";
import { LocalStoreBackend } from "./local-copy.js";
import { LocalDatabaseDriver } from "./local-database.js";
import { nodeSqliteDriverLayer } from "./node/index.js";
import { oauthAccountSourceLayer } from "./oauth-account-source.js";
import type { SecretCipher as SecretCipherType } from "./settings-store.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";
import { machineOver } from "./testing/host-machine.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";
import { planListRow } from "./testing/task-list-rows.js";

/**
 * The host assembled with a chosen set of platform concerns, on a fixture
 * run over a state root of the test's own: a host built without them stands
 * with none of their seams provided and refuses their methods, where the
 * desktop's, built with all of them, answers.
 */

/** The desktop's own account source, over its cipher and its loopback consent. */
const desktopAccountSource = Layer.provide(
  oauthAccountSourceLayer,
  Layer.merge(
    Layer.succeed(SecretCipher, {
      isAvailable: () => false,
      encrypt: (plainText) => new TextEncoder().encode(plainText),
      decrypt: (cipherText) => new TextDecoder().decode(cipherText),
    }),
    Layer.succeed(SignInConsent, { open: loopbackConsent }),
  ),
);

/** A client offering one capability of its own, as a browser might. */
const CLIENT: readonly ClientCapability[] = [HOST_CAPABILITY.MICROPHONE];

/** What a standing host answers for an agent's terminals and the client's bootstrap, and which concerns it says it runs. */
const askedOfStandingHost = Effect.gen(function* () {
  const { concerns } = yield* HostAssemblyTag;
  const { gateway } = yield* HostTag;
  const terminals = yield* gateway.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: "agent" });
  const bootstrap = yield* gateway.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP, {});

  return { concerns, terminals, bootstrapped: bootstrap.ok };
});

describe("the host's platform concerns", () => {
  it.effect("left out, need no spawner or terminal socket, and refuse their methods", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-browser-");

      // Note that nothing here provides a `ChildProcessSpawner` or a
      // `TerminalSocket`. The layer's type, narrowed to the concerns chosen,
      // asks for neither, and a build that reached for one anyway would die
      // here on the missing service.
      const browser = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource())),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, browser);

      const notHere = {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: NOT_ON_THIS_PLATFORM },
      };

      assert.deepEqual(asked.terminals, notHere);
      assert.equal(asked.concerns.has(HOST_CONCERN.MACHINE_COMMANDS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TERMINALS), false);
      assert.equal(asked.concerns.has(HOST_CONCERN.TASKS), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [HOST_CAPABILITY.MICROPHONE]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("all chosen, as the desktop chooses them, answer", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-desktop-");

      const desktop = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer(ALL_HOST_PLATFORM_CONCERNS)),
        Layer.provide(
          Layer.mergeAll(
            machineOver(stateRoot),
            desktopAccountSource,
            scriptedSpawner(() => ({ exitCode: 0 })).layer,
            Layer.succeed(TerminalSocket, () => Effect.succeed({ unreachable: true as const })),
            Layer.succeed(LoopbackListener, () => Effect.succeed(undefined)),
            Layer.succeed(MirrorPlatform, {
              folder: stateRoot,
              prefetchScript: () => "exit 1",
              worktreeScript: () => "exit 1",
              listScript: () => "exit 1",
              removeScript: () => "exit 1",
            }),
            Layer.succeed(ThisMacHost, {
              stateRoot,
              home: stateRoot,
              launcher: `${stateRoot}/vespin-host`,
              runsHost: false,
              registers: false,
              status: Effect.succeed(THIS_MAC_AGENT_STATUS.NOT_FOUND),
              registeredHere: Effect.succeed(false),
              job: Effect.succeed(Option.none()),
              register: Effect.succeed(Result.fail("no agent in a fixture")),
              unregister: Effect.succeed(Result.fail("no agent in a fixture")),
              loaded: Effect.succeed(false),
              install: () => Effect.succeed(Result.fail("no install in a fixture")),
              uninstall: () => Effect.succeed(Result.fail("no install in a fixture")),
              machine: Effect.succeed({
                name: "Studio",
                platform: DEVICE_PLATFORM.DARWIN,
                arch: DEVICE_ARCH.ARM64,
              }),
            }),
          ),
        ),
      );

      const asked = yield* Effect.provide(askedOfStandingHost, desktop);

      // A fixture run signs no account in, so the terminals concern itself answers, and refuses as signed out.
      assert.deepEqual(asked.terminals, {
        ok: false,
        error: { code: GATEWAY_ERROR.REFUSED, message: "signed out" },
      });
      // The host answers the bootstrap itself, folded in with the composers' methods.
      assert.equal(asked.bootstrapped, true);

      for (const concern of ALL_HOST_PLATFORM_CONCERNS)
        assert.equal(asked.concerns.has(concern), true);
      assert.deepEqual(hostCapabilities(asked.concerns, CLIENT), [
        HOST_CAPABILITY.MICROPHONE,
        HOST_CAPABILITY.MACHINE_COMMANDS,
        HOST_CAPABILITY.TERMINALS,
        HOST_CAPABILITY.LOCAL_TERMINALS,
        HOST_CAPABILITY.PORT_FORWARDS,
      ]);
      // The desktop answers every client capability too: its Zoom, login item and Keyboard shortcuts page stand on DESKTOP_APP.
      assert.deepEqual(hostCapabilities(asked.concerns, ALL_CLIENT_CAPABILITIES), [
        HOST_CAPABILITY.UPDATES,
        HOST_CAPABILITY.MICROPHONE,
        HOST_CAPABILITY.MACHINE_COMMANDS,
        HOST_CAPABILITY.MAC_TERMINAL,
        HOST_CAPABILITY.TERMINALS,
        HOST_CAPABILITY.LOCAL_TERMINALS,
        HOST_CAPABILITY.PORT_FORWARDS,
        HOST_CAPABILITY.CLI_INSTALL,
        HOST_CAPABILITY.DESKTOP_APP,
      ]);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe("the host's account source", () => {
  it.effect("another source than the desktop's stands with no sign-in consent or cipher", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-account-source-");

      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;

      // Note that nothing here provides a `SignInConsent` or a `SecretCipher`:
      // they are the desktop's source's own requirements, so the assembly's
      // type asks for neither, and a build that reached for one would die here.
      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource({ account }))),
      );

      const answered = yield* Effect.provide(
        Effect.flatMap(HostTag, ({ gateway }) => gateway.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT)),
        host,
      );

      assert.deepEqual(answered, { ok: true, result: { account } });
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});

describe("the file an older build kept the account's lists in", () => {
  it.effect("is deleted unread as the host stands", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-entities-");
      const fileSystem = yield* FileSystem.FileSystem;
      const file = (yield* Path.Path).join(stateRoot, "entities.sealed");
      yield* fileSystem.writeFileString(file, "sealed lists");

      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;

      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(Layer.merge(machineOver(stateRoot), fixedAccountSource({ account }))),
      );

      const stands = yield* Effect.provide(fileSystem.exists(file), host);

      assert.equal(stands, false);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );
});

describe("the account's local database", () => {
  const SIGNED_IN = {
    status: ACCOUNT_STATUS.SIGNED_IN,
    id: "user-dana",
    email: "dana@example.com",
    provider: ACCOUNT_PROVIDER.GITHUB,
  } as const;

  /** The account's one workspace, as the service's workspaces read answers it, rows inline. */
  const WORKSPACES: WorkspacesLiveAnswer = {
    url: LIVE_POLL_URL,
    queries: {
      workspaces: {
        capability: "",
        queryFingerprint: "",
        expiresAt: Number.MAX_SAFE_INTEGER,
        digest: "w1",
        rows: [
          {
            id: "workspace-acme",
            name: "Acme",
            slug: "acme",
            own: true,
            personal: true,
            role: "owner",
            memberCount: 1,
            photoVersion: null,
            ownerImage: null,
          },
        ],
      },
      installations: {
        capability: "",
        queryFingerprint: "",
        expiresAt: Number.MAX_SAFE_INTEGER,
        digest: "i1",
        rows: [],
      },
      experiments: {
        capability: "",
        queryFingerprint: "",
        expiresAt: Number.MAX_SAFE_INTEGER,
        digest: "e1",
        rows: [],
      },
    },
  };

  /** The task a waiting write below renames, as the task list holds it. */
  const INVITES = planListRow("7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", "Teammate invitations");

  /** `queries` as the service answers them at the poll address, each part's rows as JSON text. */
  const polled = (queries: Readonly<Record<string, { readonly rows?: readonly unknown[] }>>) =>
    Response.json({
      url: LIVE_POLL_URL,
      queries: Object.fromEntries(
        Object.entries(queries).map(([part, query]) => [
          part,
          {
            capability: "",
            queryFingerprint: "",
            expiresAt: Number.MAX_SAFE_INTEGER,
            digest: part,
            ...query,
            rows: JSON.stringify(query.rows ?? []),
          },
        ]),
      ),
    });

  /** How a launch's service answers: the workspaces read and the task list, its one task, and a rename as `renamed` answers it; anything else unanswered. */
  const SERVICE = {
    /** A rename unanswered, as a service out of reach leaves it. */
    UNANSWERED: "unanswered",
    /** A rename under a key the service took already, which stands it down. */
    WRITTEN: "written",
  } as const;

  type RenameAnswer = (typeof SERVICE)[keyof typeof SERVICE];

  const answered = (renamed: RenameAnswer) => (request: RecordedRequest) => {
    if (request.pathname === HOSTED_SERVICE_PATH.LIVE_WORKSPACES) return polled(WORKSPACES.queries);

    if (request.pathname === HOSTED_SERVICE_PATH.LIVE_TASKS) {
      return polled({ tasks: { rows: [INVITES] }, agents: {} });
    }

    if (request.pathname === `/api/tasks/${INVITES.id}` && renamed === SERVICE.WRITTEN) {
      return Response.json({ error: HOSTED_API_ERROR.ALREADY_WRITTEN }, { status: 409 });
    }

    return new Response(null, { status: 503 });
  };

  /** The idempotency keys the service was sent a rename of the task under, in order. */
  const renameKeys = (requests: readonly RecordedRequest[]) =>
    requests.flatMap((request) =>
      request.pathname === `/api/tasks/${INVITES.id}`
        ? [request.headers.get(IDEMPOTENCY_KEY.HEADER)]
        : [],
    );

  /**
   * The live run signed in to Dana's account on `driver`, over `stateRoot`
   * (a new one where none is given), its service answering as `renamed`
   * says and its account source sealing with `cipher` where one is given,
   * every report kept, once its workspaces' first answer was taken; the
   * service's requests, the host's acts, and the sign-out its gate runs
   * handed back.
   */
  const signedIn = (
    driver: Layer.Layer<LocalDatabaseDriver> | Layer.Layer<LocalStoreBackend>,
    launch: {
      readonly stateRoot?: string;
      readonly cipher?: SecretCipherType;
      readonly renamed?: RenameAnswer;
    } = {},
  ) =>
    Effect.gen(function* () {
      const stateRoot =
        launch.stateRoot ?? (yield* temporaryDirectoryScoped("host-local-database-"));

      const reported: unknown[] = [];
      let gate: AccountSourceHost | undefined;

      const service = recordingHttpClient(answered(launch.renamed ?? SERVICE.UNANSWERED));

      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(
          Layer.mergeAll(
            machineOver(stateRoot, { service: service.layer }),
            fixedAccountSource({
              account: SIGNED_IN,
              ...(launch.cipher === undefined ? undefined : { tokenCipher: launch.cipher }),
              opened: (opened) => {
                gate = opened;
              },
            }),
            driver,
          ),
        ),
      );

      const built = yield* Layer.build(host).pipe(
        Effect.provide(
          ErrorReporter.layer([
            ErrorReporter.make(({ error, attributes }) => {
              reported.push({ message: error.message, ...attributes });
            }),
          ]),
        ),
      );

      // Note that the service's fake answers on the event loop, so the host is let run a turn of it at a time until its follow polls the workspaces read again, which it does once their first answer is taken.
      const polled = () =>
        service.requests.some(
          (request) =>
            request.searchParams.get("poll") === "true" &&
            request.pathname === HOSTED_SERVICE_PATH.LIVE_WORKSPACES,
        );

      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve))).pipe(
        Effect.repeat({ until: polled, times: 1_000 }),
      );
      const folder = (yield* Path.Path).join(stateRoot, "accounts", SIGNED_IN.id);

      return {
        folder,
        reported,
        polled,
        requests: service.requests,
        acts: Context.get(built, HostAssemblyTag).acts,
        signOut: Effect.suspend(() => gate?.stopCapabilities ?? Effect.die("never opened")),
      };
    });

  it.effect("keeps a list the service answered at sign-in, and is deleted at a sign-out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* signedIn(nodeSqliteDriverLayer);
        const fileSystem = yield* FileSystem.FileSystem;
        const database = new DatabaseSync(`${host.folder}/local.sqlite`, { readOnly: true });

        const kept = database
          .prepare("SELECT read, key FROM held WHERE kind = 'workspace'")
          .all()
          .map((row) => ({ read: row.read, key: row.key }));

        database.close();
        assert.deepEqual(kept, [{ read: "workspaces", key: "workspace-acme" }]);

        yield* host.signOut;
        assert.equal(yield* fileSystem.exists(host.folder), false);
      }),
    ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("that will not open is reported by its tag alone, and the lists follow on", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* signedIn(
          Layer.succeed(LocalDatabaseDriver, {
            open: () => {
              throw new Error("no such module: node:sqlite at /Users/dana");
            },
          }),
        );

        assert.deepEqual(host.reported, [
          {
            message: "host.localDatabase.openFailed",
            reason: "host.localDatabase.openFailed",
            failure: "LocalDatabaseFailed",
            cause: "Error",
          },
        ]);
        assert.equal(host.polled(), true);
      }),
    ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect(
    "keeps a list on the platform's own store that keeps no queues, and forgets it at a sign-out",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const kept: string[] = [];
          const forgotten: string[] = [];

          const host = yield* signedIn(
            Layer.succeed(LocalStoreBackend, {
              keepsCollections: false,
              open: () =>
                Effect.succeed({
                  rows: {
                    answered: (answer) =>
                      Effect.sync(() => {
                        if (answer.read === "workspaces" && "every" in answer.held)
                          kept.push(...answer.held.every);
                      }),
                    loaded: () => Effect.undefined,
                  },
                  queues: undefined,
                  collections: Effect.undefined,
                }),
              forget: (accountId) =>
                Effect.sync(() => {
                  forgotten.push(accountId);
                }),
            }),
          );

          assert.deepEqual(kept, ["workspace-acme"]);

          yield* host.signOut;
          assert.deepEqual(forgotten, [SIGNED_IN.id]);
        }),
      ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );

  /** Lets the host run on the event loop until the service was sent a rename, or a thousand turns pass. */
  const renameSent = (requests: readonly RecordedRequest[]) =>
    Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve))).pipe(
      Effect.repeat({ until: () => renameKeys(requests).length > 0, times: 1_000 }),
    );

  it.effect("sends a write left waiting at a quit after the relaunch, under its key", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-local-database-");

      const asked = yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* signedIn(nodeSqliteDriverLayer, { stateRoot });
          yield* host.acts.TASKS_RENAME({ taskId: INVITES.id, name: "Invites" });
          yield* renameSent(host.requests);

          return renameKeys(host.requests);
        }),
      );

      const relaunched = yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* signedIn(nodeSqliteDriverLayer, {
            stateRoot,
            renamed: SERVICE.WRITTEN,
          });

          yield* renameSent(host.requests);

          return renameKeys(host.requests);
        }),
      );

      assert.equal(asked.length, 1);
      assert.deepEqual(relaunched, asked);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
  );
});
