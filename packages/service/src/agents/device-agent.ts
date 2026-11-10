/**
 * device-agent.ts -- what a local agent's Mac takes from the service: its lines and its requests, held for while none waits, and a launch line's secrets opened once as it is claimed.
 *
 * Every function is the Mac's side of `machine/device-machine.ts`, under the
 * account its sign-in token names and the device it names, and answers
 * nothing where the account holds no such Mac (`deviceAgentDeviceOf`). A held read counts as the Mac's beat,
 * withdraws the account's work queued too long ago for any Mac to take
 * (`DEVICE_AGENT_SERVICE.EXPIRY`, past the longest a coding agent's turn may
 * run), and answers what waits for that Mac as soon as anything does, or
 * nothing once the hold ends; it claims nothing, since the Mac claims each
 * row by its id. A launch line's claim hands its secrets over opened from
 * the row's seal, which the same claim cleared, so the Mac is handed them
 * once and the row never holds them again.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { failAgentBoot } from "@repo/database/models/agent-boot-store";
import { latestTurnsOf, readAgent } from "@repo/database/models/agent-store";
import {
  claimDeviceAgentLine,
  deviceAgentLineStanding,
  deviceAgentLinesWaiting,
  deviceAgentRequestsWaiting,
  latestDeviceAgentLaunch,
  settleDeviceAgentLine,
  withdrawExpiredDeviceAgentRows,
} from "@repo/database/models/device-agent-store";
import { beatDevice, deviceLayout } from "@repo/database/models/device-store";
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
 * Whether the account may follow the Mac it names: the Mac is its own.
 * Every procedure of the Mac's asks this first, and answers not found where
 * it is false.
 */
export function deviceAgentDeviceOf(userId: string, deviceId: string): DeviceAgentEffect<boolean> {
  return Effect.map(deviceLayout(userId, deviceId), Option.isSome);
}

/**
 * What a held read answers: the rows waiting, read again as each write to
 * the account's lines and requests lands, which notifies its topic
 * (`deviceAgentLineSync`, `deviceAgentRequestSync`), until any is or the
 * hold ends; the Mac beaten and the expired rows withdrawn first.
 */
function heldRead<A>(
  userId: string,
  deviceId: string,
  waiting: DeviceAgentEffect<readonly A[]>,
): DeviceAgentEffect<readonly A[]> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* beatDevice(userId, deviceId);
    yield* withdrawExpiredDeviceAgentRows(
      userId,
      new Date(now - Duration.toMillis(DEVICE_AGENT_SERVICE.EXPIRY)),
    );
    const topics: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];
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

/** The Mac's held read of its agents' lines, in their order. */
export function deviceAgentLinesFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentLinesWaiting(userId, deviceId));
}

/** The Mac's held read of its agents' tools' requests, oldest first. */
export function deviceAgentRequestsFor(userId: string, deviceId: string) {
  return heldRead(userId, deviceId, deviceAgentRequestsWaiting(userId, deviceId));
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
 * One line claimed for the account's Mac under the token it minted for the
 * line, where it names one, with a launch line's secrets opened once; none
 * where it is not that Mac's, another claim took it, it was settled, or it
 * was withdrawn. The same claim asked again under the same token is
 * answered the line again, and a launch line's secrets as gone, since the
 * first claim took them. A launch line whose secrets do not open is handed
 * over without them, for the Mac to settle as a runner that never started.
 */
export function claimedDeviceAgentLine(
  userId: string,
  deviceId: string,
  id: string,
  claimToken?: string,
) {
  return Effect.gen(function* () {
    const claimed = yield* claimDeviceAgentLine(userId, deviceId, id, claimToken);
    if (Option.isNone(claimed)) return Option.none();
    const { sealedSecrets, secretsGone, ...line } = claimed.value;
    if (secretsGone) return Option.some({ line, secretsGone: true as const });
    if (line.kind !== DEVICE_AGENT_LINE_KIND.LAUNCH || sealedSecrets === null) {
      return Option.some({ line });
    }
    const secrets = yield* openedSecrets(userId, line.agentId, sealedSecrets);
    return Option.some(Option.isSome(secrets) ? { line, secrets: secrets.value } : { line });
  });
}

/**
 * One line the account's Mac claimed, settled; whether it was. A launch
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
  userId: string,
  deviceId: string,
  id: string,
  exitCode?: number,
  unstarted?: DeviceLaunchUnstarted,
) {
  return Effect.gen(function* () {
    const fresh = yield* settleDeviceAgentLine(userId, deviceId, id, exitCode);
    const settled = Option.isSome(fresh)
      ? fresh
      : Option.filter(
          yield* deviceAgentLineStanding(userId, id),
          (standing) => standing.settled && standing.deviceId === deviceId,
        );
    if (Option.isNone(settled)) return false;
    const { agentId, kind } = settled.value;
    if (kind !== DEVICE_AGENT_LINE_KIND.LAUNCH) return true;
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
