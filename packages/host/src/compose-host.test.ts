import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { loopbackConsent } from "@repo/credentials/node";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { LIVE_POLL_URL } from "@repo/features/live-wire";
import type { WorkspacesLiveAnswer } from "@repo/features/workspace-live";
import { GATEWAY_ERROR, GATEWAY_METHOD } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { HOST_CAPABILITY } from "@repo/settings";
import { recordingHttpClient } from "@repo/wire/testing";
import { Effect, ErrorReporter, Layer, Option, Path, Result } from "effect";
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
import { ENTITY_STORE_FILE_NAME } from "./entity-store.js";
import {
  ALL_CLIENT_CAPABILITIES,
  ALL_HOST_PLATFORM_CONCERNS,
  type ClientCapability,
  HOST_CONCERN,
  hostCapabilities,
  NOT_ON_THIS_PLATFORM,
} from "./host-concerns.js";
import { LocalDatabaseDriver } from "./local-database.js";
import { nodeSqliteDriverLayer } from "./node/index.js";
import { oauthAccountSourceLayer } from "./oauth-account-source.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";
import { machineOver } from "./testing/host-machine.js";
import { scriptedSpawner } from "./testing/scripted-spawner.js";

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

describe("the account's lists kept on disk", () => {
  it.effect("are deleted as the account gate closes at a sign-out", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-entities-");
      const fileSystem = yield* FileSystem.FileSystem;
      const file = (yield* Path.Path).join(stateRoot, ENTITY_STORE_FILE_NAME);
      yield* fileSystem.writeFileString(file, "sealed lists");

      const account = {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      } as const;

      let gate: AccountSourceHost | undefined;

      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(
          Layer.merge(
            machineOver(stateRoot),
            fixedAccountSource({
              account,
              opened: (opened) => {
                gate = opened;
              },
            }),
          ),
        ),
      );

      yield* Effect.provide(
        Effect.suspend(() => gate?.stopCapabilities ?? Effect.die("the source was never opened")),
        host,
      );

      assert.equal(yield* fileSystem.exists(file), false);
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

  /** The live run signed in to Dana's account on `driver`, its service answering the workspaces read alone, every report kept, once its workspaces' first answer was taken; the sign-out its gate runs handed back. */
  const signedIn = (driver: Layer.Layer<LocalDatabaseDriver>) =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("host-local-database-");
      const reported: unknown[] = [];
      let gate: AccountSourceHost | undefined;

      const service = recordingHttpClient((request) =>
        request.pathname === HOSTED_SERVICE_PATH.LIVE_WORKSPACES
          ? Response.json({
              ...WORKSPACES,
              // Note that each part's rows travel as JSON text, as the service answers them.
              queries: Object.fromEntries(
                Object.entries(WORKSPACES.queries).map(([part, query]) => [
                  part,
                  { ...query, rows: JSON.stringify(query.rows) },
                ]),
              ),
            })
          : new Response(null, { status: 503 }),
      );

      const host = hostStandingLayer.pipe(
        Layer.provideMerge(hostAssemblyLayer([])),
        Layer.provide(
          Layer.mergeAll(
            machineOver(stateRoot, { service: service.layer }),
            fixedAccountSource({
              account: SIGNED_IN,
              opened: (opened) => {
                gate = opened;
              },
            }),
            driver,
          ),
        ),
      );

      yield* Layer.build(host).pipe(
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
});
