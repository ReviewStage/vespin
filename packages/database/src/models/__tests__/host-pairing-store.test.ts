import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  DEVICE_ARCH,
  DEVICE_PLATFORM,
  type DevicePlatform,
  MACHINE_NETWORK,
  MACHINE_OWNER,
} from "@repo/features/device-agent-wire";
import {
  HOST_PAIRING_POLL_STATUS,
  HOST_VERSION_FOR,
  type HostPairingTarget,
} from "@repo/features/host-wire";
import { inArray } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { hostPairing, hostPairingGuess } from "../../schemas/host-pairing.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { workspaceOwnedMachinesOf } from "../device-store.js";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_APPROVAL,
  HOST_PAIRING_GUESS,
  openHostPairing,
  pollHostPairing,
  readHostPairing,
} from "../host-pairing-store.js";
import { enrollOwnDevice, hostBySecret, hostsOf, removeHost } from "../host-store.js";

/**
 * A box's pairings, over a real dialect: once one account approved or
 * denied a code, no account reads, approves, or denies it again, and the
 * approve made one host on the machine its box named, listed under its
 * approver alone; an approve never
 * takes over a device that stands; a box that polls past its collect
 * grace is handed no secret; and a start deletes a lapsed pairing, the
 * address it kept with it, a host whose box never collected its secret, and
 * a guess window that ended, while a keyed host, a live pairing, the host
 * it approved, and a window still open stay; and a host whose box never
 * collected its secret leaves the list as its pairing lapses, before any
 * start deletes it.
 * Synthetic accounts, codes, hashes, addresses, and boxes throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

/** The machine every test box names at its start, a digest's shape. */
const MACHINE_ID = "a".repeat(64);

/** What a test box starts its pairing as, where it is not the usual Linux box on `MACHINE_ID`. */
interface TestBox {
  readonly platform?: DevicePlatform;
  readonly version?: string;
  readonly machineId?: string;
}

/** A pending pairing opened under a fresh code and poll secret hash for the box given: that code and hash. */
const openedBox = (box: TestBox) =>
  Effect.gen(function* () {
    const userCode = randomUUID();
    const pollSecretHash = `poll-${randomUUID()}`;

    const kept = yield* openHostPairing({
      pollSecretHash,
      userCode,
      name: "fra-01",
      platform: box.platform ?? DEVICE_PLATFORM.LINUX,
      arch: DEVICE_ARCH.X64,
      version: box.version ?? HOST_VERSION_FOR.WORKSPACE_MACHINE,
      machineId: box.machineId ?? MACHINE_ID,
      ip: "203.0.113.7",
    });

    assert.ok(Option.isSome(kept));

    return { userCode, pollSecretHash };
  });

/** A pending pairing of the usual test box. */
const opened = openedBox({});

const MISSED = { guess: HOST_PAIRING_GUESS.MISSED };

/** An approve for the approver alone. */
const JUST_ME: HostPairingTarget = { kind: MACHINE_OWNER.USER };

/** An approve for the workspace given, its agents kept to the open internet. */
const toWorkspace = (workspaceId: string): HostPairingTarget => ({
  kind: MACHINE_OWNER.WORKSPACE,
  workspaceId,
  network: MACHINE_NETWORK.PUBLIC_ONLY,
});

/** What an approve that found its pairing but was refused for the reason given answers. */
const refusedFor = (approval: typeof HOST_PAIRING_APPROVAL.MACHINE_OWNED_ELSEWHERE) => ({
  guess: HOST_PAIRING_GUESS.FOUND,
  found: { approval },
});

it.layer(getTestDB())("a box's pairings", (it) => {
  it.effect(
    "once one account approved or denied a code, no account reads, approves, or denies it again, and the approve made one host on the box's machine, its approver's alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const approved = yield* opened;
        const denied = yield* opened;
        const deviceId = randomUUID();

        const approve = yield* approveHostPairing(owner, approved.userCode, deviceId, JUST_ME);
        const deny = yield* denyHostPairing(owner, denied.userCode);
        const afterwards = [];

        for (const { userCode } of [approved, denied]) {
          afterwards.push(
            yield* readHostPairing(other, userCode),
            yield* approveHostPairing(other, userCode, randomUUID(), JUST_ME),
            yield* denyHostPairing(other, userCode),
            yield* approveHostPairing(owner, userCode, randomUUID(), JUST_ME),
          );
        }

        assert.deepEqual(approve, {
          guess: HOST_PAIRING_GUESS.FOUND,
          found: { approval: HOST_PAIRING_APPROVAL.APPROVED, deviceId },
        });
        assert.deepEqual(deny, { guess: HOST_PAIRING_GUESS.FOUND, found: true });
        assert.deepEqual(
          afterwards,
          Array.from({ length: 8 }, () => MISSED),
        );
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => [host.id, host.machineId]),
          [[deviceId, MACHINE_ID]],
        );
        assert.deepEqual(yield* hostsOf(other), []);
      }),
  );

  it.effect("an approve under the id of a device that stands fails, and writes nothing", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;

      const standing = {
        id: randomUUID(),
        version: "0.1.0",
        secretHash: `secret-${randomUUID()}`,
        machine: { name: "theirs", platform: DEVICE_PLATFORM.LINUX, arch: DEVICE_ARCH.X64 },
      };

      yield* enrollOwnDevice(other, standing);
      const pairing = yield* opened;

      const taken = yield* Effect.exit(
        approveHostPairing(owner, pairing.userCode, standing.id, JUST_ME),
      );

      assert.ok(Exit.isFailure(taken));
      assert.deepEqual(
        Option.map(yield* hostBySecret(standing.secretHash), (host) => host.owner),
        Option.some({ kind: MACHINE_OWNER.USER, userId: other }),
      );
      assert.equal((yield* readHostPairing(owner, pairing.userCode)).guess, "found");
      assert.deepEqual(yield* hostsOf(owner), []);
    }),
  );

  it.effect(
    "a host whose box never collected its secret is listed until its pairing lapses, with no start, and is not removed after",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const collected = yield* opened;
        const uncollected = yield* opened;
        const [collectedId, uncollectedId] = [randomUUID(), randomUUID()];
        yield* approveHostPairing(owner, collected.userCode, collectedId, JUST_ME);
        yield* approveHostPairing(owner, uncollected.userCode, uncollectedId, JUST_ME);
        yield* pollHostPairing(collected.pollSecretHash, `secret-${randomUUID()}`);

        yield* TestClock.adjust("9 minutes");
        const beforeLapse = (yield* hostsOf(owner)).map((host) => host.id).sort();
        yield* TestClock.adjust("1 minute");

        assert.deepEqual(beforeLapse, [collectedId, uncollectedId].sort());
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [collectedId],
        );
        assert.equal(yield* removeHost(owner, uncollectedId), undefined);
      }),
  );

  it.effect(
    "a start deletes lapsed pairings, the address each kept, a host whose box never collected its secret, and ended guess windows, and leaves what is live",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, other } = yield* openAccounts;
        const collected = yield* opened;
        const uncollected = yield* opened;
        const pending = yield* opened;
        const [collectedId, uncollectedId, liveId] = [randomUUID(), randomUUID(), randomUUID()];
        yield* approveHostPairing(owner, collected.userCode, collectedId, JUST_ME);
        yield* approveHostPairing(owner, uncollected.userCode, uncollectedId, JUST_ME);
        yield* readHostPairing(other, randomUUID());
        const polled = yield* pollHostPairing(collected.pollSecretHash, `secret-${randomUUID()}`);
        const listedBefore = (yield* hostsOf(owner)).map((host) => host.id).sort();

        yield* TestClock.adjust("16 minutes");
        const late = yield* pollHostPairing(uncollected.pollSecretHash, `secret-${randomUUID()}`);
        const live = yield* opened;
        yield* approveHostPairing(owner, live.userCode, liveId, JUST_ME);
        const livePending = yield* opened;

        assert.equal(polled.status, HOST_PAIRING_POLL_STATUS.APPROVED);
        assert.equal(late.status, HOST_PAIRING_POLL_STATUS.EXPIRED, "past its grace, no secret");
        assert.deepEqual(listedBefore, [collectedId, uncollectedId].sort());
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id).sort(),
          [collectedId, liveId].sort(),
        );

        const kept = yield* db
          .select({ ip: hostPairing.ip })
          .from(hostPairing)
          .where(
            inArray(hostPairing.pollSecretHash, [
              collected.pollSecretHash,
              uncollected.pollSecretHash,
              pending.pollSecretHash,
            ]),
          );

        assert.deepEqual(kept, []);

        const windows = yield* db
          .select({ userId: hostPairingGuess.userId })
          .from(hostPairingGuess)
          .where(inArray(hostPairingGuess.userId, [owner, other]));

        assert.deepEqual(windows, [{ userId: owner }]);
        assert.equal((yield* readHostPairing(owner, livePending.userCode)).guess, "found");
        assert.equal(
          (yield* pollHostPairing(live.pollSecretHash, `secret-${randomUUID()}`)).status,
          HOST_PAIRING_POLL_STATUS.APPROVED,
        );
      }),
  );
  it.effect(
    "an approve to a workspace makes the workspace's machine, connected by its approver and none of their own, and the box's poll names the workspace",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);
        const pairing = yield* opened;
        const deviceId = randomUUID();
        const secretHash = `secret-${randomUUID()}`;

        yield* approveHostPairing(owner, pairing.userCode, deviceId, toWorkspace(workspace));
        const polled = yield* pollHostPairing(pairing.pollSecretHash, secretHash);

        assert.deepEqual(polled, {
          status: HOST_PAIRING_POLL_STATUS.APPROVED,
          deviceId,
          owner: { kind: MACHINE_OWNER.WORKSPACE, workspaceId: workspace },
          userId: owner,
        });
        assert.deepEqual(
          Option.map(yield* hostBySecret(secretHash), (host) => host.owner),
          Option.some({ kind: MACHINE_OWNER.WORKSPACE, workspaceId: workspace }),
        );
        assert.deepEqual(
          (yield* workspaceOwnedMachinesOf(owner, workspace)).map((machine) => [
            machine.id,
            machine.connectedBy,
            machine.network,
          ]),
          [[deviceId, owner, MACHINE_NETWORK.PUBLIC_ONLY]],
        );
        assert.deepEqual(yield* hostsOf(owner), []);
      }),
  );

  it.effect(
    "a Mac is one owner's: one standing as a member's own is refused to a workspace, one standing as a workspace's is refused to a member, and each pairing still waits",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);
        const [personalMac, workspaceMac] = ["d".repeat(64), "e".repeat(64)];
        const mac = (machineId: string) => ({ platform: DEVICE_PLATFORM.DARWIN, machineId });
        const first = yield* openedBox(mac(personalMac));
        yield* approveHostPairing(other, first.userCode, randomUUID(), JUST_ME);
        const second = yield* openedBox(mac(workspaceMac));
        yield* approveHostPairing(owner, second.userCode, randomUUID(), toWorkspace(workspace));
        const toTheWorkspace = yield* openedBox(mac(personalMac));
        const toAMember = yield* openedBox(mac(workspaceMac));

        const refused = [
          yield* approveHostPairing(
            owner,
            toTheWorkspace.userCode,
            randomUUID(),
            toWorkspace(workspace),
          ),
          yield* approveHostPairing(owner, toAMember.userCode, randomUUID(), JUST_ME),
        ];

        const { MACHINE_OWNED_ELSEWHERE } = HOST_PAIRING_APPROVAL;
        assert.deepEqual(refused, [
          refusedFor(MACHINE_OWNED_ELSEWHERE),
          refusedFor(MACHINE_OWNED_ELSEWHERE),
        ]);

        for (const { userCode } of [toTheWorkspace, toAMember]) {
          assert.equal((yield* readHostPairing(owner, userCode)).guess, HOST_PAIRING_GUESS.FOUND);
        }
      }),
  );

  it.effect(
    "a Linux box's machine holds no owner to it, since one image may ship one machine id to many boxes",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);
        const personal = yield* opened;
        yield* approveHostPairing(other, personal.userCode, randomUUID(), JUST_ME);
        const shared = yield* opened;

        const approved = yield* approveHostPairing(
          owner,
          shared.userCode,
          randomUUID(),
          toWorkspace(workspace),
        );

        assert.ok(
          approved.guess === HOST_PAIRING_GUESS.FOUND &&
            approved.found.approval === HOST_PAIRING_APPROVAL.APPROVED,
        );
      }),
  );

  it.effect(
    "a box whose daemon cannot be a workspace's machine is read as unfit for one, refused to one, and still waits for its member",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);
        const older = yield* openedBox({ version: "0.13.0" });

        const read = yield* readHostPairing(owner, older.userCode);

        const refused = yield* approveHostPairing(
          owner,
          older.userCode,
          randomUUID(),
          toWorkspace(workspace),
        );

        const mine = yield* approveHostPairing(owner, older.userCode, randomUUID(), JUST_ME);

        assert.ok(read.guess === HOST_PAIRING_GUESS.FOUND && !read.found.workspaceFit);
        assert.deepEqual(refused, {
          guess: HOST_PAIRING_GUESS.FOUND,
          found: { approval: HOST_PAIRING_APPROVAL.UNFIT_FOR_WORKSPACE },
        });
        assert.ok(
          mine.guess === HOST_PAIRING_GUESS.FOUND &&
            mine.found.approval === HOST_PAIRING_APPROVAL.APPROVED,
        );
      }),
  );
});
