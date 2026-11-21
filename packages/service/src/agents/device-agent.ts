/**
 * device-agent.ts -- what a local agent's Mac takes from the service: its lines and its requests, held for while none waits, and a launch line's secrets opened once as it is claimed.
 *
 * Every function is the Mac's side of `machine/device-machine.ts`, under the
 * host its device secret names (`HostPrincipal`): its device and that
 * device's owner, a member's own Mac or box or a workspace's machine, and
 * answers nothing where the owner holds no such device
 * (`deviceAgentDeviceOf`). A held read counts as the device's beat,
 * withdraws the owner's work queued too long ago for any device to take
 * (`DEVICE_AGENT_SERVICE.EXPIRY`, past the longest a coding agent's turn may
 * run), and answers what waits for that device as soon as anything does, or
 * nothing once the hold ends, woken by a write to its own lines and requests
 * (`TOPIC.DEVICE`); it claims nothing, since the device claims each row by
 * its id. What a line's agent needs of its own account, a launch's secrets
 * opened and its turns settled, is read under the account the agent was
 * started by (`deviceAgentPin`), since a workspace's machine runs every
 * member's. A launch line's claim hands its secrets over opened from the
 * row's seal, which the same claim cleared, so the device is handed them
 * once and the row never holds them again.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { failAgentBoot } from "@repo/database/models/agent-boot-store";
import { latestTurnsOf, readAgent } from "@repo/database/models/agent-store";
import {
  claimDeviceAgentLine,
  deviceAgentLineSettledOn,
  deviceAgentLinesWaiting,
  deviceAgentPin,
  deviceAgentRequestsWaiting,
  type HostPrincipal,
  latestDeviceAgentLaunch,
  settleDeviceAgentLine,
  withdrawExpiredDeviceAgentRows,
} from "@repo/database/models/device-agent-store";
import { beatDevice, hostLayout } from "@repo/database/models/device-store";
import { openMacLaunchSecrets, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { storeWriter } from "@repo/database/models/writer";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { BOOT_FAILURE } from "@repo/features/agent-boot";
import {
  DEVICE_AGENT_LINE_KIND,
  type DeviceAgentLaunchSecrets,
  type DeviceLaunchUnstarted,
  deviceAgentLaunchSecretsSchema,
} from "@repo/features/device-agent-wire";
import { Clock, DateTime, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { TURN_FAILURE, TURN_STATUS } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { heldUntil } from "../http/held-read.js";
import { launchStoppedDetail } from "./coder-host/status.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

const DEVICE_AGENT_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read looks again where the sync hub cannot wake it. */
  POLL: Duration.millis(500),
  /**
   * How long a row may wait before it is withdrawn: past a day, so a line a
   * Mac away that long would take is one whose turn the minute sweep long
   * since failed past its deadline (`coder-host/reconcile.ts`).
   */
  EXPIRY: Duration.hours(26),
} as const;

type DeviceAgentEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const decodeSecrets = Schema.decodeUnknownResult(
  Schema.fromJsonString(deviceAgentLaunchSecretsSchema),
);

/**
 * Whether the host may follow the device it names: its owner holds it, and
 * it registered. Every procedure of the device's asks this first, and
 * answers not found where it is false.
 */
export function deviceAgentDeviceOf(host: HostPrincipal): DeviceAgentEffect<boolean> {
  return Effect.map(hostLayout(host), Option.isSome);
}

/**
 * What a held read answers: the rows waiting, read again as each write to
 * the device's lines and requests lands, which notifies its topic
 * (`deviceAgentLineSync`, `deviceAgentRequestSync`), until any is or the
 * hold ends; the device beaten and its owner's expired rows withdrawn first.
 */
function heldRead<A>(
  host: HostPrincipal,
  waiting: DeviceAgentEffect<readonly A[]>,
): DeviceAgentEffect<readonly A[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* beatDevice(host);
    yield* withdrawExpiredDeviceAgentRows(
      host.owner,
      new Date(now - Duration.toMillis(DEVICE_AGENT_SERVICE.EXPIRY)),
    );
    const topics: readonly SyncTopic[] = [[TOPIC.DEVICE, host.deviceId]];

    const found = yield* heldUntil(
      waiting,
      (rows) => rows.length > 0,
      topics,
      DEVICE_AGENT_SERVICE.POLL,
      DEVICE_AGENT_SERVICE.HOLD,
    );

    return Option.match(found, { onNone: () => [], onSome: ({ read }) => read });
  });
}

/** The device's held read of its agents' lines, in their order. */
export function deviceAgentLinesFor(host: HostPrincipal) {
  return heldRead(host, deviceAgentLinesWaiting(host));
}

/** The device's held read of its agents' tools' requests, oldest first. */
export function deviceAgentRequestsFor(host: HostPrincipal) {
  return heldRead(host, deviceAgentRequestsWaiting(host));
}

/**
 * A launch line's secrets opened from the seal its claim took off the row,
 * bound to its account and agent; none where the deployment holds no ring
 * that opens it, which the log says by its kind alone.
 */
const openedSecrets = (userId: string, agentId: string, sealed: string) =>
  Effect.gen(function* () {
    const environment = yield* Effect.serviceOption(HostedEnvironment);
    const keys = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);

    if (ring === undefined || Result.isFailure(ring)) {
      yield* Effect.logWarning("a local agent's launch secrets found no key ring to open them");

      return Option.none<DeviceAgentLaunchSecrets>();
    }

    const opened = openMacLaunchSecrets(ring.success, { userId, agentId }, sealed);

    const read = Result.isSuccess(opened)
      ? decodeSecrets(Redacted.value(opened.success))
      : undefined;

    if (read === undefined || Result.isFailure(read)) {
      yield* Effect.logWarning("a local agent's launch secrets did not open");

      return Option.none<DeviceAgentLaunchSecrets>();
    }

    return Option.some(read.success);
  });

/**
 * One line claimed for the host's device under the token it minted for the
 * line, where it names one, with a launch line's secrets opened once, under
 * the account of the agent it is for; none where it is not that device's,
 * another claim took it, it was settled, or it was withdrawn. The same claim asked again under the same token is
 * answered the line again, and a launch line's secrets as gone, since the
 * first claim took them. A launch line whose secrets do not open is handed
 * over without them, for the Mac to settle as a runner that never started.
 */
export function claimedDeviceAgentLine(host: HostPrincipal, id: string, claimToken?: string) {
  return Effect.gen(function* () {
    const claimed = yield* claimDeviceAgentLine(host, id, claimToken);

    if (Option.isNone(claimed)) return Option.none();
    const { sealedSecrets, secretsGone, ...line } = claimed.value;

    if (secretsGone) return Option.some({ line, secretsGone: true as const });

    if (line.kind !== DEVICE_AGENT_LINE_KIND.LAUNCH || sealedSecrets === null) {
      return Option.some({ line });
    }

    const pin = yield* deviceAgentPin(line.agentId);

    // Note that a launch whose agent is gone is handed over without its secrets, for the device to settle as a runner that never started.
    if (Option.isNone(pin)) return Option.some({ line });
    const secrets = yield* openedSecrets(pin.value.userId, line.agentId, sealedSecrets);

    return Option.some(Option.isSome(secrets) ? { line, secrets: secrets.value } : { line });
  });
}

/**
 * One line the host's device claimed, settled; whether it was, its agent's
 * turns read under the account the agent was started by. A launch
 * line that was the agent's newest settles its runner as gone, so a turn
 * of the agent's still under way, whose runner posted no END before it
 * ended, as when the app quit or the Mac's switch went off mid-turn, is
 * settled lost (`settleRunnerLostTurns`) and the agent offers Continue
 * rather than running until its deadline passes. A launch whose runner
 * ended before it took the turn its message's send queued, as one its Mac
 * settled unstarted, leaves that turn still queued, and it is settled the
 * same way, whatever the Mac said of why, in words naming the step its host
 * last reported where it reported one, and by the reason the Mac said where
 * it said one (`launchStoppedDetail`). A turn the runner ended itself
 * is already settled, and is left as it stands. An older launch a newer one
 * replaced settles nothing of the newer one's turn.
 *
 * Note that a line this Mac already settled is answered as settled again,
 * and its runner's turn settled again, which settles nothing a second time,
 * because the line's own write and the turn's are two writes: a settle whose
 * turn write failed after its line's landed is asked again by the Mac, and
 * must still reach the turn.
 */
export function settledDeviceAgentLine(
  host: HostPrincipal,
  id: string,
  exitCode?: number,
  unstarted?: DeviceLaunchUnstarted,
) {
  return Effect.gen(function* () {
    const fresh = yield* settleDeviceAgentLine(host, id, exitCode);
    const settled = Option.isSome(fresh) ? fresh : yield* deviceAgentLineSettledOn(host, id);

    if (Option.isNone(settled)) return false;
    const { agentId, kind } = settled.value;

    if (kind !== DEVICE_AGENT_LINE_KIND.LAUNCH) return true;
    const pin = yield* deviceAgentPin(agentId);

    if (Option.isNone(pin)) return true;
    const { userId } = pin.value;
    const newest = yield* latestDeviceAgentLaunch(userId, agentId);

    if (Option.isNone(newest) || newest.value.id !== id) return true;
    const agent = yield* readAgent(userId, agentId);

    if (Option.isNone(agent)) return true;
    // A launch that settled before its runner was up fails the agent's first launch, where that is what it booted.
    yield* failAgentBoot(agentId, BOOT_FAILURE.MAC_UNSTARTED, yield* DateTime.nowAsDate);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const { conversationId } = agent.value;
    const turn = (yield* latestTurnsOf(userId, [conversationId])).get(conversationId);
    // Note that a launch whose turn opened is a runner gone however it ended, failed as the sweep fails one (`runner_lost`), which is
    // what a carry-on reads it by (`coder-host/carry-on.ts`); one that never took its turn, which stands queued, is worded by the step it stopped at.
    const unopened = !newest.value.stopped && turn?.status === TURN_STATUS.QUEUED;
    const detail = unopened ? launchStoppedDetail(newest.value.step, unstarted) : undefined;
    yield* settleRunnerLostTurns(
      writer,
      agent.value.conversationId,
      yield* Clock.currentTimeMillis,
      detail,
      undefined,
      unopened ? TURN_FAILURE.MODEL : TURN_FAILURE.RUNNER_LOST,
    );

    return true;
  });
}
