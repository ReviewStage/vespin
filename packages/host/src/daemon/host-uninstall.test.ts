import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { Effect, Exit, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import { systemError } from "effect/PlatformError";
import { writeHostDevice } from "../host-device-record.js";
import { keepOwnedAgent } from "../local-agent-state.js";
import { HOST_LEAVE_OUTCOME } from "./host-leave.js";
import { uninstallBundledHost } from "./host-uninstall.js";

const SERVICE = "https://app.test";

const DEVICE = {
  deviceId: "6bbcb1b9-6706-4c97-9197-374756ceee07",
  deviceSecret: `lkd_${"a".repeat(43)}`,
  serviceOrigin: SERVICE,
} as const;

/** An agent whose folder the host made, and one whose folder another install made beside it. */
const OWNED_AGENT = "0b6f9a4e-1c1d-4d2e-9f3a-5b7c8d9e0f12";
const OTHER_AGENT = "7a1e2d3c-4b5a-4c6d-8e7f-901a2b3c4d5e";

/** A Mac the bundled host ran on: its record, one agent's folder it made, another install's agent's folder, and the account's shared clones. */
const mac = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* temporaryDirectoryScoped("host-uninstall-");
  const home = `${root}/home`;
  const stateRoot = `${home}/.local/state/vespin-host`;

  const folders = {
    owned: `${home}/.vespin/agents/${OWNED_AGENT}`,
    other: `${home}/.vespin/agents/${OTHER_AGENT}`,
    clones: `${home}/.vespin/clones`,
  };

  yield* writeHostDevice(stateRoot, DEVICE);
  yield* keepOwnedAgent(stateRoot, OWNED_AGENT);

  for (const folder of Object.values(folders)) {
    yield* fileSystem.makeDirectory(folder, { recursive: true });
  }

  return { home, stateRoot, folders };
});

const standing = (paths: readonly string[]) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    Effect.forEach(paths, (each) => fileSystem.exists(each)),
  );

describe("the bundled host's uninstall", () => {
  it.effect.each([
    { removeAgentFolders: true, ownedStands: false },
    { removeAgentFolders: false, ownedStands: true },
  ])(
    "leaves the account on the box's secret and removes its state, and the folders of the agents it made only where asked (removeAgentFolders: $removeAgentFolders)",
    ({ removeAgentFolders, ownedStands }) =>
      Effect.gen(function* () {
        const { home, stateRoot, folders } = yield* mac;
        const http = recordingHttpClient(() => jsonResponse({ done: true }));

        const left = yield* uninstallBundledHost({
          stateRoot,
          home,
          version: "0.1.0",
          removeAgentFolders,
        }).pipe(Effect.provide(http.layer));

        expect(left).toBe(HOST_LEAVE_OUTCOME.LEFT);
        expect(http.requests.map((each) => [each.pathname, each.authorization])).toEqual([
          [HOSTED_SERVICE_PATH.DEVICE_AGENT_LEAVE, `Bearer ${DEVICE.deviceSecret}`],
        ]);
        expect(yield* standing([stateRoot, folders.owned, folders.other, folders.clones])).toEqual([
          false,
          ownedStands,
          true,
          true,
        ]);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("still removes the host from the Mac where the service does not take the leave", () =>
    Effect.gen(function* () {
      const { home, stateRoot } = yield* mac;

      const http = recordingHttpClient(() =>
        jsonResponse({ error: "unavailable" }, HTTP_STATUS.SERVER_ERROR),
      );

      const left = yield* uninstallBundledHost({
        stateRoot,
        home,
        version: "0.1.0",
        removeAgentFolders: false,
      }).pipe(Effect.provide(http.layer));

      expect(left).toBe(HOST_LEAVE_OUTCOME.UNANSWERED);
      expect(yield* standing([stateRoot])).toEqual([false]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("removes the state, and says so, where an agent's folder cannot be removed", () =>
    Effect.gen(function* () {
      const { home, stateRoot, folders } = yield* mac;
      const http = recordingHttpClient(() => jsonResponse({ done: true }));

      // Note that the owned agent's folder refuses its removal, as one the member's own permissions lock does.
      const locked = Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fileSystem) => ({
          ...fileSystem,
          remove: (path: string, options?: Parameters<typeof fileSystem.remove>[1]) =>
            path === folders.owned
              ? Effect.fail(
                  systemError({
                    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- Effect's systemError takes its tag as data
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "remove",
                    pathOrDescriptor: path,
                  }),
                )
              : fileSystem.remove(path, options),
        })),
      ).pipe(Layer.provide(NodeFileSystem.layer));

      const uninstalled = yield* uninstallBundledHost({
        stateRoot,
        home,
        version: "0.1.0",
        removeAgentFolders: true,
      }).pipe(Effect.provide(Layer.merge(http.layer, locked)), Effect.exit);

      expect(Exit.isFailure(uninstalled)).toBe(true);
      expect(yield* standing([stateRoot, folders.owned])).toEqual([false, true]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );

  it.effect("removes the state where a file lands in it as it empties", () =>
    Effect.gen(function* () {
      const { home, stateRoot } = yield* mac;
      const http = recordingHttpClient(() => jsonResponse({ done: true }));
      let landed = false;

      // Note that the first removal of the state has the app's keep-awake choice land in it, which fails it as not empty, as Node's `rm` fails with ENOTEMPTY.
      const raced = Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fileSystem) => ({
          ...fileSystem,
          remove: (path: string, options?: Parameters<typeof fileSystem.remove>[1]) =>
            Effect.suspend(() => {
              if (path !== stateRoot || landed) return fileSystem.remove(path, options);
              landed = true;

              return Effect.andThen(
                fileSystem.writeFileString(`${stateRoot}/keep-awake.json`, "{}\n"),
                Effect.fail(
                  systemError({
                    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- Effect's systemError takes its tag as data
                    _tag: "Unknown",
                    module: "FileSystem",
                    method: "remove",
                    pathOrDescriptor: path,
                  }),
                ),
              );
            }),
        })),
      ).pipe(Layer.provide(NodeFileSystem.layer));

      const left = yield* uninstallBundledHost({
        stateRoot,
        home,
        version: "0.1.0",
        removeAgentFolders: false,
      }).pipe(Effect.provide(Layer.merge(http.layer, raced)));

      expect(left).toBe(HOST_LEAVE_OUTCOME.LEFT);
      expect(yield* standing([stateRoot])).toEqual([false]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );
});
