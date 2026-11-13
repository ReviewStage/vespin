import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { openThisMachineDevice } from "./this-machine-device.js";

/**
 * This install as a device of each account: the id it is to an account is
 * kept across launches, starts as the host's own where one enrolled, is
 * the account's alone, and is replaced only where the service refused it.
 * A temporary state folder, synthetic accounts, and counted ids throughout.
 */

const NODE = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** Ids minted in order: `minted-1`, `minted-2`, and so on. */
const counter = () => {
  let minted = 0;

  return () => {
    minted += 1;

    return `minted-${minted}`;
  };
};

it.effect(
  "an account's id is kept across launches, starts as the host's own, and is replaced only when renewed",
  () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("this-machine-device-");
      const createId = counter();

      const launch = (hostDeviceId: Option.Option<string>) =>
        openThisMachineDevice({ stateRoot, hostDeviceId: Effect.succeed(hostDeviceId), createId });

      const first = yield* launch(Option.some("host-device"));
      const owner = yield* first.idFor("user-owner");
      const other = yield* first.idFor("user-other");
      const relaunched = yield* launch(Option.none());
      const ownerAgain = yield* relaunched.idFor("user-owner");
      const renewed = yield* relaunched.renewFor("user-other");
      const otherAgain = yield* (yield* launch(Option.none())).idFor("user-other");

      assert.equal(owner, "host-device", "the host's own id, where one enrolled");
      assert.equal(other, "host-device", "the service refuses it later where it is not theirs");
      assert.equal(ownerAgain, "host-device", "kept across a launch that reads no host");
      assert.equal(renewed, "minted-1");
      assert.equal(otherAgain, "minted-1", "the renewed id is the one kept");
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);

it.effect(
  "where the ids can't be written, an account keeps one id for the run, and a renewed one replaces it",
  () =>
    Effect.gen(function* () {
      const scratch = yield* temporaryDirectoryScoped("this-machine-device-");
      const fileSystem = yield* FileSystem.FileSystem;
      // A state folder that is a file, so no id can ever be written under it.
      const stateRoot = `${scratch}/state`;
      yield* fileSystem.writeFileString(stateRoot, "");

      const device = yield* openThisMachineDevice({
        stateRoot,
        hostDeviceId: Effect.succeed(Option.none()),
        createId: counter(),
      });

      const first = yield* device.idFor("user-owner");
      const again = yield* device.idFor("user-owner");
      const renewed = yield* device.renewFor("user-owner");
      const afterRenewal = yield* device.idFor("user-owner");

      assert.equal(first, "minted-1");
      assert.equal(again, "minted-1", "the same id for the run, though none was kept");
      assert.equal(renewed, "minted-2");
      assert.equal(afterRenewal, "minted-2", "never the refused id again");
    }).pipe(Effect.scoped, Effect.provide(NODE)),
);
