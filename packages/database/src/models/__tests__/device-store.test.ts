import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import { MAC_COMMAND_MODE } from "@repo/features/mac-command-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { device } from "../../schemas/device.js";
import { DEVICE_LAYOUT, getTestDB } from "../../testing/index.js";
import {
  beatDevice,
  devicesNamed,
  devicesSeenSince,
  joinCommandDevice,
  markAwayDevices,
  registerDevice,
  saveCommandDeviceSettings,
} from "../device-store.js";
import { enrollOwnDevice, hostsOf, removeHost } from "../host-store.js";

/**
 * An account's Macs, over a real dialect: a Mac is registered, beaten, and
 * read by its own account alone, an id another account holds is never taken
 * over, a Mac that stopped beating is no longer read as there, a host's
 * update stands until its own beat names none, a Mac quiet past fresh is marked away once and its next beat clears it, and the Macs a read's local agents name are read by their ids alone.
 * A Mac joining for its commands carries its own settings up once.
 * Synthetic accounts and Macs throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

it.layer(getTestDB())("the device store", (it) => {
  it.effect("another account neither takes over, beats, nor reads an account's Mac", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const id = randomUUID();
      const since = new Date(0);

      const registered = yield* registerDevice(owner, {
        id,
        name: "Studio",
        ...DEVICE_LAYOUT,
      });

      const takenOver = yield* registerDevice(other, {
        id,
        name: "Not yours",
        ...DEVICE_LAYOUT,
      });

      const beatenByOther = yield* beatDevice(other, id);

      assert.equal(registered, true);
      assert.equal(takenOver, false, "an id another account holds is not moved");
      assert.equal(beatenByOther, false);
      assert.deepEqual(yield* devicesSeenSince(other, since), []);
      assert.deepEqual(
        (yield* devicesSeenSince(owner, since)).map((device) => device.name),
        ["Studio"],
        "the owner's Mac keeps its name",
      );
    }),
  );

  it.effect(
    "a Mac joining for its commands carries its settings up once, to its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;

        const machine = {
          deviceId: randomUUID(),
          name: "Studio",
          platform: DEVICE_PLATFORM.DARWIN,
          arch: DEVICE_ARCH.ARM64,
        };

        const carried = {
          commandMode: MAC_COMMAND_MODE.NEVER,
          alwaysAllowedApps: ["com.apple.Notes"],
        };

        const changed = { commandMode: MAC_COMMAND_MODE.ALWAYS, alwaysAllowedApps: [] };

        const first = yield* joinCommandDevice(owner, { ...machine, settings: carried });
        const again = yield* joinCommandDevice(owner, { ...machine, settings: changed });
        const byOther = yield* joinCommandDevice(other, { ...machine, settings: changed });
        const savedByOther = yield* saveCommandDeviceSettings(other, machine.deviceId, changed);
        const saved = yield* saveCommandDeviceSettings(owner, machine.deviceId, changed);
        const afterSave = yield* joinCommandDevice(owner, { ...machine, settings: carried });

        assert.deepEqual(first, Option.some(carried));
        assert.deepEqual(again, Option.some(carried), "a later join keeps what was carried");
        assert.deepEqual(byOther, Option.none(), "another account's join takes nothing over");
        assert.equal(savedByOther, false);
        assert.equal(saved, true);
        assert.deepEqual(afterSave, Option.some(changed));
      }),
  );

  it.effect(
    "a Mac whose host was removed stands again as its app joins, records its machine, and is not listed as a host",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const id = randomUUID();
        const machineId = "a".repeat(64);

        yield* enrollOwnDevice(owner, {
          id,
          version: "0.2.1",
          secretHash: `secret-${randomUUID()}`,
          machine: { name: "Studio", platform: DEVICE_PLATFORM.DARWIN, arch: DEVICE_ARCH.ARM64 },
        });
        yield* removeHost(owner, id);

        const joined = yield* joinCommandDevice(owner, {
          deviceId: id,
          name: "Studio",
          platform: DEVICE_PLATFORM.DARWIN,
          arch: DEVICE_ARCH.ARM64,
          machineId,
          model: "Mac mini (M4, 2024)",
          settings: { commandMode: MAC_COMMAND_MODE.ASK, alwaysAllowedApps: [] },
        });

        const [row] = yield* Database.use((db) =>
          db
            .select({
              removedAt: device.removedAt,
              machineId: device.machineId,
              model: device.model,
            })
            .from(device)
            .where(eq(device.id, id)),
        );

        assert.ok(Option.isSome(joined));
        assert.deepEqual(row, { removedAt: null, machineId, model: "Mac mini (M4, 2024)" });
        assert.deepEqual(yield* hostsOf(owner), [], "a row with no secret is no host");
      }),
  );

  it.effect("a Mac reads as there from its last beat on, and not after", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const id = randomUUID();
      yield* registerDevice(owner, { id, name: "Laptop", ...DEVICE_LAYOUT });
      // Note that the cutoff is measured from the clock's reading, which the layer's clock carries from test to test.
      const cutoff = new Date((yield* Clock.currentTimeMillis) + 45_000);
      yield* TestClock.adjust("60 seconds");

      const staleRead = yield* devicesSeenSince(owner, cutoff);
      const beaten = yield* beatDevice(owner, id);
      const freshRead = yield* devicesSeenSince(owner, cutoff);

      assert.deepEqual(staleRead, [], "a Mac silent past the cutoff is not there");
      assert.equal(beaten, true);
      assert.deepEqual(
        freshRead.map((device) => device.id),
        [id],
      );
    }),
  );

  it.effect(
    "a host's update stands through a touch that says nothing of it, and its own beat naming none clears it",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const id = randomUUID();
        yield* enrollOwnDevice(owner, {
          id,
          version: "0.2.1",
          secretHash: `secret-${randomUUID()}`,
          machine: { name: "fra-01", platform: DEVICE_PLATFORM.LINUX, arch: DEVICE_ARCH.X64 },
        });

        const listed = Effect.map(hostsOf(owner), (hosts) =>
          hosts.map((host) => [host.update, host.updateFailure]),
        );

        yield* beatDevice(owner, id, { update: HOST_UPDATE.WAITING });
        // A held read touches the device with no word of its update.
        yield* beatDevice(owner, id);
        const touched = yield* listed;
        yield* beatDevice(owner, id, {});
        const cleared = yield* listed;

        assert.deepEqual(touched, [[HOST_UPDATE.WAITING, null]]);
        assert.deepEqual(cleared, [[null, null]]);
      }),
  );

  it.effect(
    "the machine a Mac's enroll names is listed and offered, a register naming none leaves it, and one naming another replaces it",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const id = randomUUID();
        const [first, moved] = ["a".repeat(64), "b".repeat(64)];

        const machines = Effect.gen(function* () {
          const listed = (yield* hostsOf(owner)).map((host) => [host.machineId, host.model]);

          const offered = (yield* devicesSeenSince(owner, new Date(0))).map((seen) => [
            seen.machineId,
            seen.model,
          ]);

          return { listed, offered };
        });

        yield* enrollOwnDevice(owner, {
          id,
          version: "0.2.1",
          secretHash: `secret-${randomUUID()}`,
          machineId: first,
          model: "MacBook Air (M2, 2022)",
          machine: { name: "Studio", platform: DEVICE_PLATFORM.DARWIN, arch: DEVICE_ARCH.ARM64 },
        });
        // Note that a register from a host older than the field names no machine.
        yield* registerDevice(owner, { id, name: "Studio", ...DEVICE_LAYOUT });
        const kept = yield* machines;
        yield* registerDevice(owner, { id, name: "Studio", ...DEVICE_LAYOUT, machineId: moved });
        const replaced = yield* machines;

        assert.deepEqual(kept, {
          listed: [[first, "MacBook Air (M2, 2022)"]],
          offered: [[first, "MacBook Air (M2, 2022)"]],
        });
        assert.deepEqual(replaced.listed, [[moved, "MacBook Air (M2, 2022)"]]);
      }),
  );

  it.effect(
    "the Macs agents are pinned to are read by id, whichever account holds each, and only those",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const [studio, laptop, unnamed] = [randomUUID(), randomUUID(), randomUUID()];
        yield* registerDevice(owner, { id: studio, name: "Studio", ...DEVICE_LAYOUT });
        yield* registerDevice(other, { id: laptop, name: "Laptop", ...DEVICE_LAYOUT });
        yield* registerDevice(owner, { id: unnamed, name: "Spare", ...DEVICE_LAYOUT });

        const named = yield* devicesNamed([studio, laptop, studio, randomUUID()]);

        assert.deepEqual([...named.values()].map((device) => device.name).sort(), [
          "Laptop",
          "Studio",
        ]);
      }),
  );
  it.effect(
    "a Mac quiet past fresh is marked away once, as the sweep finds it, and its next beat clears the mark",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner } = yield* openAccounts;
        const id = randomUUID();
        yield* registerDevice(owner, { id, name: "Studio", ...DEVICE_LAYOUT });

        const awayAt = Effect.map(
          db.select({ awayAt: device.awayAt }).from(device).where(eq(device.id, id)),
          (rows) => rows[0]?.awayAt ?? null,
        );

        const freshMs = 60_000;

        yield* markAwayDevices(yield* Clock.currentTimeMillis, freshMs);
        const whileFresh = yield* awayAt;
        yield* TestClock.adjust(freshMs + 1_000);
        const sweptAt = yield* Clock.currentTimeMillis;
        yield* markAwayDevices(sweptAt, freshMs);
        const marked = yield* awayAt;
        yield* TestClock.adjust(60_000);
        yield* markAwayDevices(yield* Clock.currentTimeMillis, freshMs);
        const markedAgain = yield* awayAt;
        yield* beatDevice(owner, id);
        const cleared = yield* awayAt;

        assert.equal(whileFresh, null);
        assert.equal(marked?.getTime(), sweptAt);
        assert.equal(markedAgain?.getTime(), sweptAt);
        assert.equal(cleared, null);
      }),
  );
});
