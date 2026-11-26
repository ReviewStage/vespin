/**
 * hosts-procedures.ts -- the account's enrolled machines as Settings › Machines reads and changes them: listed, removed, each machine's own settings for agents changed, and a box's pairing read, approved, or denied by its code.
 *
 * A machine is any device of the account's that holds a device secret, a
 * box its approved pairing keyed and a Mac its desktop enrolled alike
 * (`@repo/database/models/host-store`), so each is listed, judged against
 * the floor, and removed the same way; a desktop that never enrolled is not
 * listed.
 *
 * Every procedure is the account's own, on its bearer or its browser's
 * session (`accountMiddleware`), so the Hosts list works in a browser and on
 * a phone as in the desktop. A host removed is refused at once on its
 * secret (`auth/device-secret.ts`), its box cleans itself up as it hears
 * so, and its agents' running turns are settled lost with it; a host may
 * leave on its own secret the same way (`removeAccountHost`). The apps each
 * of the account's machines always allow are read for an agent's `@` where
 * it is typed off that machine, and only while the reader has Computer use
 * on. Each of the account's machines, enrolled or one whose app only
 * joined to take commands, has its own settings for agents' commands and
 * apps changed from any device of the member's, which the machine follows
 * live, and is removed the same way, as a host where it runs agents. An
 * ask one of the account's machines holds is answered from any of its
 * devices the same way, the first answer standing; an Allow given after
 * its window closed tells the agent in the owner's words to try again. Each host is
 * listed with whether its daemon is below the floor, where its setup
 * stands, where its update to a newer release stands, whether its program
 * has called in since it joined, and, for a Mac, the user it runs as, and
 * every answer names the install script on the service's own origin, which the
 * install and upgrade commands name (`@repo/features/host-wire`).
 *
 * A box's pairing is read, approved, or denied by its user code, whatever
 * its case and dash, and only while it is pending and its code has not
 * lapsed (`@repo/database/models/host-pairing-store`). The read answers
 * what the approve screen shows: the box as it named itself and the
 * address its start came from, so a member sees whose box they would let
 * run their agents, and no workspace to connect it to, since a box is no
 * longer connected to a workspace. An approve makes the host under an id
 * minted here, never one the box named, listed from that moment and keyed
 * with a secret on its box's next poll, as the account's own. An approve
 * that still names a workspace, as a released desktop or iPhone build may
 * send, is refused as not permitted before it guesses, and its pairing
 * waits for another answer. Each of the three is a guess: one that
 * finds no pending pairing is answered not found and counts against the
 * account, and an account past the limit is refused as held, with when its
 * window ends, until it does.
 */

import { randomUUID } from "node:crypto";
import { runningTurnIds } from "@repo/database/models/abandoned-turns";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { type HostPrincipal, ownDeviceHost } from "@repo/database/models/device-agent-store";
import {
  allowedAppsOf,
  changeMachine,
  devicesSeenSince,
  removeMachine,
} from "@repo/database/models/device-store";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_APPROVAL,
  HOST_PAIRING_GUESS,
  type HostPairingApproval,
  type HostPairingGuessed,
  readHostPairing,
} from "@repo/database/models/host-pairing-store";
import {
  hostAgentConversations,
  hostsOf,
  removeHostDevice,
} from "@repo/database/models/host-store";
import { answerMachineAsk } from "@repo/database/models/machine-command-ask-store";
import { storeWriter } from "@repo/database/models/writer";
import { MACHINE_OWNER } from "@repo/features/device-agent-wire";
import {
  HOST_WIRE,
  type HostPairingTarget,
  hostUserCodeOf,
  hostVersionMeets,
} from "@repo/features/host-wire";
import {
  lateAllowedWords,
  MACHINE_ASK_DECISION,
  type MachineAskSubject,
} from "@repo/features/machine-ask-wire";
import { EXPERIMENT } from "@repo/settings";
import { MESSAGE_CHANNEL } from "@repo/wire";
import { Clock, Effect, Option } from "effect";
import { HOST_VERSION } from "../auth/device-secret.js";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_HOST_PAIRING_ACTION,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  hostPairingHeld,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { steerMemberWords } from "./coder-host/steer.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { settleLostHostTurns } from "./lost-host-turns.js";

export interface HostsProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The install script's address on the origin the request reached, so a Preview's command names its own. */
export function installScriptUrlOf(request: Request): string {
  return new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, new URL(request.url).origin).href;
}

/**
 * Settles every turn still running of the agents pinned to a host just
 * removed as lost (`settleLostHostTurns`). Note that every agent's running
 * turns are read once, before any is settled, and only those are settled,
 * because a removed host may enroll again under its id and begin a turn
 * while this runs, and that turn is the new enrollment's. A failure here is
 * logged and the remove still answers done, because the host is already
 * removed and a retry would find no host to remove; whatever was left reads
 * as lost once its lease runs out, and is settled at the agent's next touch.
 */
const endedHostAgents = (host: HostPrincipal) =>
  Effect.gen(function* () {
    const conversations = yield* hostAgentConversations(host);

    const lost = yield* Effect.forEach(conversations, (conversationId) =>
      Effect.map(runningTurnIds(conversationId), (ids) => ({
        conversationId,
        runningTurnIds: ids,
      })),
    );

    yield* settleLostHostTurns(lost);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("a removed host's agents' turns were not settled", failure),
    ),
  );

/**
 * Removes the host's device, a member's own or a workspace's machine:
 * stamped removed, so its secret is refused at once and its box cleans
 * itself up as it hears so, and every agent's running turns on it settled
 * lost. Answers the transaction it removed in, or none where its owner held
 * no such device standing.
 */
export const removeHostOf = (host: HostPrincipal) =>
  Effect.gen(function* () {
    const removed = yield* hostedStoreOrUnavailable(removeHostDevice(host));

    if (removed !== undefined) yield* endedHostAgents(host);

    return removed;
  });

/**
 * Removes the account's host of the id given, as Settings › Hosts' Remove
 * and the host's own leave (`device-agents-procedures.ts`) both do
 * (`removeHostOf`), and counts the change. Answers the transaction it
 * removed in, or none where no host of that id stood.
 */
export const removeAccountHost = (userId: string, id: string) =>
  Effect.gen(function* () {
    const removed = yield* removeHostOf(ownDeviceHost(userId, id));

    if (removed === undefined) return undefined;
    yield* recordServerEvent(
      SERVER_EVENT.HOST_PAIRING_CHANGE,
      { userId },
      { action: SERVER_HOST_PAIRING_ACTION.REMOVE },
    );

    return removed;
  });

/** A remove answered with the transaction it removed in, or refused as not found where none was removed. */
/** Writes the words a member's message carries, as the agents' own tools do. */
const writer = storeWriter({ tools: CODER_TOOL_SET });

/**
 * The agent an ask was for, told in its owner's words that the ask was
 * allowed after its call gave up, so it tries again, which its machine now
 * lets through; nothing where the ask names no agent, the owner may not see
 * it, or the agent takes no words from them. Note that the line goes under
 * the ask's own id, so it is sent once however often it is asked, and that
 * the answer stands whether or not it lands.
 */
const toldToTryAgain = (
  userId: string,
  askId: string,
  late: { readonly agentId?: string; readonly subject: MachineAskSubject },
) =>
  Effect.gen(function* () {
    if (late.agentId === undefined) return;
    const agent = Option.getOrUndefined(yield* readVisibleAgent(userId, late.agentId));

    if (agent === undefined) return;

    // Note that the words are the service's in the owner's name, so the line says so, and no Manager's chat holds it as theirs.
    yield* steerMemberWords(writer, userId, agent, {
      text: lateAllowedWords(late.subject),
      clientKey: askId,
      metadata: { channel: MESSAGE_CHANNEL.TYPED, app_words: true },
    });
  }).pipe(Effect.ignore);

const removedOrNotFound = (txid: string | undefined) =>
  txid === undefined ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.succeed({ ...DONE, txid });

/** A code's eight letters, or the request refused as invalid where it is none, which its schema already refused. */
const codeOf = (typed: string) => {
  const code = hostUserCodeOf(typed);

  return code === undefined ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.succeed(code);
};

/** What a guess found, or its refusal: not found where it found no pending pairing, held, with until when, where the account is past the limit. */
const foundOrRefused = <A>(guessed: HostPairingGuessed<A>) => {
  switch (guessed.guess) {
    case HOST_PAIRING_GUESS.FOUND:
      return Effect.succeed(guessed.found);
    case HOST_PAIRING_GUESS.MISSED:
      return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    case HOST_PAIRING_GUESS.HELD:
      return Effect.fail(hostPairingHeld(guessed.heldUntil.getTime()));
  }
};

/** An approve that names no target: the approver's own machine, as every approve before targets did. */
const JUST_ME: HostPairingTarget = { kind: MACHINE_OWNER.USER };

/** The host an approve made, or its refusal: owned elsewhere where its Mac stands as another owner's host, and invalid where a workspace was asked of a box unfit to be one's, which no screen offers. */
const approvedOrRefused = (approved: HostPairingApproval) => {
  switch (approved.approval) {
    case HOST_PAIRING_APPROVAL.APPROVED:
      return Effect.succeed(approved.deviceId);
    case HOST_PAIRING_APPROVAL.MACHINE_OWNED_ELSEWHERE:
      return Effect.fail(HOSTED_REFUSAL.MACHINE_OWNED_ELSEWHERE);
    case HOST_PAIRING_APPROVAL.UNFIT_FOR_WORKSPACE:
      return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
};

/** The hosts resource, on the account's bearer or session. */
export function hostsProcedures(seams: HostsProcedureSeams) {
  const hosts = hosted.hosts.use(accountMiddleware(seams.resolveUserId));

  return {
    list: hosts.list.effect(function* ({ context }) {
      const rows = yield* hostedStoreOrUnavailable(hostsOf(context.userId));

      return {
        hosts: rows.map((row) => ({
          id: row.id,
          name: row.name,
          platform: row.platform,
          seenAt: row.lastSeenAt.getTime(),
          version: row.version,
          upgradeNeeded: row.version === null || !hostVersionMeets(row.version, HOST_VERSION.FLOOR),
          ...(row.setup === null ? undefined : { setup: row.setup }),
          ...(row.setupFailure === null ? undefined : { setupFailure: row.setupFailure }),
          ...(row.update === null ? undefined : { update: row.update }),
          ...(row.updateFailure === null ? undefined : { updateFailure: row.updateFailure }),
          ...(row.machineId === null ? undefined : { machineId: row.machineId }),
          ...(row.model === null ? undefined : { model: row.model }),
          // Note that a register always writes the home folder and nothing else does, so a host with none has not called in since it joined.
          calledIn: row.home !== null,
        })),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    presence: hosts.presence.effect(function* ({ context }) {
      const owned = yield* hostedStoreOrUnavailable(devicesSeenSince(context.userId, new Date(0)));
      const now = yield* Clock.currentTimeMillis;

      return {
        devices: owned.map((row) => ({
          deviceId: row.id,
          // Note that the age is taken on this clock, which wrote the beat, so a reader's clock never enters it.
          ageMs: Math.max(0, now - row.lastSeenAt.getTime()),
        })),
      };
    }),
    // Note that a reader with Computer use off is answered no machine, since nothing of it stands for them.
    allowedApps: hosts.allowedApps.effect(function* ({ context }) {
      const on = yield* hostedStoreOrUnavailable(
        accountExperimentOn(context.userId, EXPERIMENT.COMPUTER_USE),
      );

      if (!on) return { machines: [] };

      return { machines: yield* hostedStoreOrUnavailable(allowedAppsOf(context.userId)) };
    }),
    remove: hosts.remove.effect(function* ({ context, input }) {
      return yield* removedOrNotFound(yield* removeAccountHost(context.userId, input.id));
    }),
    changeMachine: hosts.changeMachine.effect(function* ({ context, input }) {
      const { id, ...change } = input;

      return yield* removedOrNotFound(
        yield* hostedStoreOrUnavailable(changeMachine(context.userId, id, change)),
      );
    }),
    // Note that the first answer stands, from whichever device, and a later one is answered with it.
    answerMachineAsk: hosts.answerMachineAsk.effect(function* ({ context, input }) {
      const standing = yield* hostedStoreOrUnavailable(answerMachineAsk(context.userId, input));

      if (standing === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { answer, txid, late } = standing;

      if (late !== undefined && answer.decision !== MACHINE_ASK_DECISION.DENY) {
        yield* toldToTryAgain(context.userId, input.id, late);
      }

      return txid === undefined ? answer : { ...answer, txid };
    }),
    // Note that a machine that runs agents is removed as a host is, so its agents' running turns are settled lost with it; any other only stops being listed and routed to.
    removeMachine: hosts.removeMachine.effect(function* ({ context, input }) {
      const host = yield* removeAccountHost(context.userId, input.id);

      if (host !== undefined) return { ...DONE, txid: host };

      return yield* removedOrNotFound(
        yield* hostedStoreOrUnavailable(removeMachine(context.userId, input.id)),
      );
    }),
    readPairing: hosts.readPairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);

      const { workspaceFit: _workspaceFit, ...pending } = yield* foundOrRefused(
        yield* hostedStoreOrUnavailable(readHostPairing(context.userId, code)),
      );

      // Note that no workspace is offered, so a released build that draws the picker for a box fit to be a workspace's offers Just me alone.
      return { ...pending, expiresAt: pending.expiresAt.getTime(), workspaces: [] };
    }),
    approvePairing: hosts.approvePairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      const target = input.target ?? JUST_ME;

      // Note that a workspace target is refused before the guess, which a refusal never spends, so no machine is ever connected to a workspace.
      if (target.kind === MACHINE_OWNER.WORKSPACE) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }

      // Note that the host's id is minted here, so a pairing never names a device that stands.
      const deviceId = yield* approvedOrRefused(
        yield* foundOrRefused(
          yield* hostedStoreOrUnavailable(
            approveHostPairing(context.userId, code, randomUUID(), target),
          ),
        ),
      );

      yield* recordServerEvent(
        SERVER_EVENT.HOST_PAIRING_CHANGE,
        { userId: context.userId },
        { action: SERVER_HOST_PAIRING_ACTION.APPROVE },
      );

      return { deviceId };
    }),
    denyPairing: hosts.denyPairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      yield* foundOrRefused(yield* hostedStoreOrUnavailable(denyHostPairing(context.userId, code)));
      yield* recordServerEvent(
        SERVER_EVENT.HOST_PAIRING_CHANGE,
        { userId: context.userId },
        { action: SERVER_HOST_PAIRING_ACTION.DENY },
      );

      return DONE;
    }),
  };
}
