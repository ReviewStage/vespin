/**
 * move.ts -- a coding agent moved between the cloud, one of its starter's Macs, and a machine its workspace owns, in the same agent: its row pointed at the new place, its work handed on, and a mark in its transcript.
 *
 * A move keeps the agent: its id, its tab, its transcript, its branch and
 * pull request. Only where it runs changes. An agent at work is refused
 * rather than stopped, as `/clear` refuses one (`clear.ts`), so the panel
 * stops it first and the agent waits at the new place for the developer's
 * next message, as any stopped agent does; nothing carries it on by itself.
 * The move holds the conversation's dispatch claim as a send does
 * (`dispatch-claim.ts`), so a message on its way either reaches the old
 * place before it or the new one after it.
 *
 * The runner at the old place is halted first, its sandbox or its Mac's
 * folder kept. Work an agent left in the cloud is copied whole, what it had
 * not committed or pushed included, to a branch of its own (`snapshot.ts`);
 * an agent leaving a Mac or a workspace's machine brings only what it
 * pushed, since its folder is read by nothing but that machine, and the
 * folder stays there. The row then
 * names the new place (`moveAgentPlace`), its runner's bearer retired and
 * the sandbox and session a Start handed it let go, any launch still open
 * on a Mac is settled, and the conversation keeps the move for the next
 * message (`turn-context.ts`'s `moved`): that message opens the harness's
 * session afresh with the agent's own steps replayed (`runner-sessions.ts`),
 * since the old session's instructions name the place it left, and tells
 * the agent once where it runs now and where its work stands
 * (`movedWords`). The transcript gains a mark after its last row
 * (`markAgentMoved`), which the tab draws where the place changed.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  hasRepository,
  moveAgentPlace,
  readAgent,
  readAgentRouting,
} from "@repo/database/models/agent-store";
import { cancelAgentWakeup } from "@repo/database/models/agent-wakeups";
import { settleMovedDeviceAgentLaunches } from "@repo/database/models/device-agent-store";
import { machinesNamed } from "@repo/database/models/device-store";
import { DispatchClaimHeld, underDispatchClaim } from "@repo/database/models/dispatch-claim";
import { latestTurnsOf } from "@repo/database/models/message-reads";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { StoreWriter } from "@repo/database/models/writer";
import {
  AGENT_MACHINE,
  type AgentMachineKind,
  type AgentRunsOnRequest,
} from "@repo/features/agent-wire";
import type { MovedPlace } from "@repo/wire/ui-messages";
import { Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { admitsPlanWriter, controlsAgent } from "../agent-reach.js";
import { harnessOf, type NativeRuntime } from "./native-runtime.js";
import { runnerHalted } from "./runtime-sessions.js";
import { copySourceWork, SNAPSHOT_MISS, type SourceCopyServices } from "./snapshot.js";
import { ownDeviceOf, startMachineOf } from "./start.js";
import { checkoutsOn } from "./takeover.js";
import type { AgentMoved } from "./turn-context.js";
import { heldNativeTurnHanded, keptNativeTurnHanded } from "./turn-message.js";

/** A place as the move reads it: the cloud, or one of the starter's Macs or a machine of the agent's workspace, by its id and name. */
interface MovePlace {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | null;
  readonly name: string | undefined;
}

const THE_CLOUD: MovePlace = { machine: AGENT_MACHINE.VERCEL, deviceId: null, name: undefined };

/** The place the agent runs at now, its machine named as its row holds it, unnamed where that row is gone. */
const placeOf = Effect.fnUntraced(function* (
  agent: Agent,
): Effect.fn.Return<MovePlace, HostedRefusal, DatabaseServices> {
  const machine = agent.machine ?? AGENT_MACHINE.VERCEL;

  if (machine === AGENT_MACHINE.VERCEL) return THE_CLOUD;
  const deviceId = agent.deviceId ?? null;

  if (deviceId === null) return { machine, deviceId, name: undefined };
  const named = yield* hostedStoreOrUnavailable(machinesNamed([deviceId]));

  return { machine, deviceId, name: named.get(deviceId)?.name };
});

/**
 * The place asked for, admitted as a Start's is: a Mac as the starter's
 * own, standing, and not removed (`ownDeviceOf`); a workspace's machine as
 * one the agent's own workspace owns, there, and ready to run agents in
 * VMs (`startMachineOf`), whoever of its members moves it.
 */
const askedPlaceOf = Effect.fnUntraced(function* (
  agent: Agent,
  runsOn: AgentRunsOnRequest,
  runtime: NativeRuntime,
): Effect.fn.Return<MovePlace, HostedRefusal, DatabaseServices> {
  switch (runsOn.machine) {
    case AGENT_MACHINE.VERCEL:
      return THE_CLOUD;
    case AGENT_MACHINE.DEVICE: {
      const device = yield* ownDeviceOf(agent.userId, runsOn.deviceId);

      return { machine: device.machine, deviceId: device.deviceId, name: device.name };
    }

    case AGENT_MACHINE.WORKSPACE: {
      const asked = {
        machine: AGENT_MACHINE.WORKSPACE,
        deviceId: runsOn.deviceId,
        workspaceId: agent.organizationId,
      } as const;

      const placed = yield* startMachineOf(agent.userId, asked, runtime, hasRepository(agent));
      const deviceId = placed.deviceId ?? runsOn.deviceId;
      const named = yield* hostedStoreOrUnavailable(machinesNamed([deviceId]));

      return { machine: AGENT_MACHINE.WORKSPACE, deviceId, name: named.get(deviceId)?.name };
    }
  }
});

/** A place as the transcript's mark keeps it: a Mac by its id and name, the cloud as neither. */
function markedPlace(place: MovePlace): MovedPlace {
  return {
    ...(place.deviceId === null ? undefined : { deviceId: place.deviceId }),
    ...(place.name === undefined ? undefined : { name: place.name }),
  };
}

/** A place as the agent's next turn is told it (`movedWords`). */
function toldSide(place: MovePlace): AgentMoved["from"] {
  return {
    onMac: place.machine !== AGENT_MACHINE.VERCEL,
    ...(place.machine === AGENT_MACHINE.WORKSPACE ? { workspace: true } : undefined),
    ...(place.name === undefined ? undefined : { name: place.name }),
  };
}

/**
 * The checkout path the agent's earlier tool results name, where the new
 * place keeps its checkout at another; none where both stand at the same
 * path, as sandboxes do, or where either Mac's folders are not known.
 */
const movedFromPath = Effect.fnUntraced(function* (agent: Agent, from: MovePlace, to: MovePlace) {
  const [off, onto] = yield* Effect.all([
    checkoutsOn(agent.userId, from.machine, from.deviceId),
    checkoutsOn(agent.userId, to.machine, to.deviceId),
  ]);

  if (Option.isNone(off) || Option.isNone(onto)) return undefined;
  const old = off.value.checkoutPathOf(agent.id);

  return old === onto.value.checkoutPathOf(agent.id) ? undefined : old;
});

/**
 * The branch an agent leaving the cloud has its checkout copied to
 * (`copySourceWork`); none where it leaves a Mac, works in no repository, or
 * left nothing to copy, as one that never opened a sandbox. A copy that
 * failed or ran past its bound is refused as unavailable, so the agent stays
 * where its work is and the move may be asked again.
 */
const copiedBranchOf = Effect.fnUntraced(function* (
  agent: Agent,
  from: MovePlace,
): Effect.fn.Return<string | undefined, HostedRefusal, SourceCopyServices> {
  if (from.machine !== AGENT_MACHINE.VERCEL || !hasRepository(agent)) return undefined;
  // Note that the key is a fresh one, since no Start is made under it and every move copies anew.
  const copy = yield* copySourceWork(agent.userId, agent, agent.repository, false, randomUUID());

  if (copy.copied) return copy.branch;

  if (copy.miss === SNAPSHOT_MISS.FAILED || copy.miss === SNAPSHOT_MISS.TIMED_OUT) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }

  return undefined;
});

/**
 * The agent moved to the place asked, as the header says; refused where the
 * caller may not write to it, where it is archived, where it works, where
 * it runs on no harness, where it already runs there, where the Mac
 * asked is not the starter's own, standing, and where the workspace's
 * machine asked is not its workspace's, there, and ready.
 */
export const movedAgent = /* @__PURE__ */ Effect.fn("web/movedAgent")(function* (
  writer: Effect.Effect<StoreWriter>,
  account: string,
  agent: Agent,
  runsOn: AgentRunsOnRequest,
): Effect.fn.Return<void, HostedRefusal, DatabaseServices | SourceCopyServices> {
  // An agent on its starter's own GitHub token takes words from its starter alone, and so is moved by them alone.
  if (!controlsAgent(account, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* admitsPlanWriter(account, agent);

  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(agent.userId, agent.id));
  const runtime = harnessOf(Option.getOrUndefined(routing)?.runtime);

  if (runtime === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const target = { userId: agent.userId, conversationId: agent.conversationId };

  // Note that the move holds the conversation's dispatch claim throughout, so no message reaches the
  // old place between the read that finds no turn under way and the row naming the new one, and
  // the agent is read again under it, so a move asked twice at once moves from where the first left it.
  const moved = Effect.gen(function* () {
    const read = yield* hostedStoreOrUnavailable(readAgent(agent.userId, agent.id));

    if (Option.isNone(read) || read.value.archivedAt !== null) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }

    const standing = read.value;

    // Note that control is asked again of the agent as it stands, since a move just before may have put it on its starter's Mac.
    if (!controlsAgent(account, standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);

    const [from, to] = yield* Effect.all([
      placeOf(standing),
      askedPlaceOf(standing, runsOn, runtime),
    ]);

    if (from.machine === to.machine && from.deviceId === to.deviceId) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    const latest = yield* hostedStoreOrUnavailable(
      latestTurnsOf(agent.userId, [agent.conversationId]),
    );

    if (latest.get(agent.conversationId)?.settledAt === null) {
      return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
    }

    const sessionId = yield* hostedStoreOrUnavailable(recordedRuntimeSession(target));

    if (sessionId !== undefined && !(yield* runnerHalted(standing, runtime, sessionId))) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }

    const [copiedBranch, movedFrom] = yield* Effect.all([
      copiedBranchOf(standing, from),
      movedFromPath(standing, from, to),
    ]);

    const told: AgentMoved = {
      from: toldSide(from),
      to: toldSide(to),
      ...(movedFrom === undefined ? undefined : { movedFrom }),
      ...(copiedBranch === undefined ? undefined : { copiedBranch }),
    };

    // Note that the row, the launches, what the next message is told, and the mark are written in one
    // transaction, so a failed write leaves the agent where it stood rather than at a new place it was
    // never told of, or with no mark where it moved.
    const store = yield* writer;

    const steps = Effect.gen(function* () {
      yield* cancelAgentWakeup(agent.id);
      yield* moveAgentPlace(agent.userId, standing, { machine: to.machine, deviceId: to.deviceId });

      if (from.machine !== AGENT_MACHINE.VERCEL) {
        yield* settleMovedDeviceAgentLaunches(agent.userId, agent.id);
      }

      const handed = yield* heldNativeTurnHanded(target);
      yield* keptNativeTurnHanded(target, { ...handed, moved: told });

      return yield* store.markAgentMoved(target, { from: markedPlace(from), to: markedPlace(to) });
    });

    // Note that a conversation gone fails inside the transaction, so nothing written before the mark stands.
    const written = Effect.gen(function* () {
      const marked = yield* hostedStoreOrUnavailable(steps);

      if (Result.isFailure(marked)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    });

    const client = yield* SqlClient.SqlClient;
    yield* client.withTransaction(written);
  });

  // Note that messages that kept the claim past a send's own wait read as an agent at work.
  yield* underDispatchClaim(agent.conversationId, moved).pipe(
    Effect.mapError((failure) => {
      if (failure instanceof DispatchClaimHeld) return HOSTED_REFUSAL.AGENT_NOT_READY;

      return "_tag" in failure ? HOSTED_REFUSAL.UNAVAILABLE : failure;
    }),
  );
});
