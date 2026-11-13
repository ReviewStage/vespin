import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  claimMachineCommand,
  claimMachineCommands,
  machineCommandResult,
  machineCommandsWaiting,
  machineOwnerOf,
  macListeningSince,
  markMachineListening,
  queueMachineCommand,
  withdrawMachineCommand,
} from "@repo/database/models/machine-command-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  type ComputerPermission,
  MACHINE_COMMAND_BOUNDS,
  MACHINE_COMMAND_KIND,
  type MacComputerAction,
  type MacComputerResult,
  type MachineCommand,
  type MachineCommandKind,
  type MachineCommandResult,
  type MacShellResult,
  machineCommandSchema,
} from "@repo/features/machine-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { UnparsedWireValue } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
import { Clock, Duration, Effect, Option, Result, Schema } from "effect";
import { heldUntil } from "../http/held-read.js";
import { COMMAND_DESCRIPTION } from "./command-description.js";

/**
 * machine-command.ts -- a command an agent runs on the developer's own Mac: queued for the account, run by a signed-in Mac that holds the read for it, and its result handed back to the call.
 *
 * Any agent may call it, the brain, a coding agent, and either's
 * workers. Settings › This Mac sets what the Mac does with a command: Ask
 * every time (the default) asks the developer first and runs it only once
 * they allow it, Always allow runs it at once, and Never stops the Mac
 * listening. The call refuses at once where no
 * Mac of the account listened lately, since nothing would take the command.
 * Otherwise it queues the command, looks for its result until the
 * command's own timeout and a grace for the Mac to answer have passed, and
 * withdraws the row whichever way it ends, so a row stands only while its
 * call does. A Mac may take a command only within the claim window of its
 * queueing, so one it takes always ends inside the call's wait, and a row
 * a call that died left behind is never run later. An ask the Mac's read
 * would refuse is refused before it is queued. The Mac's side is `GET /api/mac-commands`, held open while
 * nothing waits and answered with every waiting command claimed for it,
 * and `POST`, its result (`machine-commands-procedures.ts`).
 *
 * A command is of a kind (`MACHINE_COMMAND_KIND`), and a Mac is handed only
 * the kinds its read named: shell, which every Mac runs, an older one's
 * read naming nothing, and each other kind a newer one names. So a call of
 * another kind is refused at once where no Mac that runs it listened
 * lately, rather than left for a Mac that would never take it, and a Mac
 * that took a command it would not run answers why, which the call
 * answers as not run.
 *
 * An agent's call runs on the Mac of the member its task is assigned to,
 * or its starter's where that task is assigned to no one
 * (`machineOwnerOf`), so a task handed to another member hands its agents'
 * commands to their Mac. Note that who has written to the agent decides
 * nothing: the Mac's own setting (Ask every time by default) is the one
 * guard.
 */

const MACHINE_COMMAND_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read, and a call waiting on its result, looks again where the sync hub cannot wake it. */
  POLL: Duration.millis(500),
  /** How lately a Mac must have read for a call to count it listening: one hold, and room for the next read to arrive. */
  LISTENER_FRESH: Duration.seconds(45),
  /**
   * How long a command may wait for a Mac to take it; one not taken by then
   * is never run. A listening Mac takes one within a poll, and a command
   * taken inside this window ends inside the call's wait. Note that it
   * outlasts the Mac's held-read deadline (`HOSTED_DEADLINE.HELD`, 35
   * seconds), the follow's rest after a read that failed (`LIVE_RESTART`,
   * 5), and the retried read's claim, because a read that hangs without
   * an error just before a command is queued must still find it claimable
   * once the Mac asks again.
   */
  CLAIM_WINDOW: Duration.seconds(60),
  /** How long past the command's own timeout a call waits for the Mac to say what it did: the claim window, and room for the answer to travel. */
  ANSWER_GRACE: Duration.seconds(65),
} as const;

export const MACHINE_COMMAND_STATUS = {
  RAN: "ran",
  NOT_RUN: "not-run",
} as const;

/** Why a call ran nothing, or never heard back, in words the model can act on. */
const MACHINE_COMMAND_REFUSAL = {
  NO_MAC:
    `Not run: ${PRODUCT_NAME} is not running on the developer's Mac, or they switched off ` +
    "Settings › Let agents run commands on this Mac.",
  NO_ANSWER:
    "No answer: the developer's Mac did not say what the command did in time; it may or may " +
    "not have run.",
  UNAVAILABLE: "Not run: the command could not be queued. The call may be made again.",
  UNREADABLE:
    "Not run: `command` must be one non-empty shell command, and `timeout_seconds` a whole " +
    `number from 1 to ${MACHINE_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS}.`,
  NO_COMPUTER:
    `Not run: ${PRODUCT_NAME} is not running on the developer's Mac, or that Mac cannot use ` +
    "apps for agents; updating it there may let it.",
  COMPUTER_UNREADABLE:
    "Not run: the action does not read; name the app, and only the fields its action takes.",
} as const;

/** Why a call ran nothing by its kind: no Mac that runs that kind listening, or an ask the Mac's read would refuse. */
const MACHINE_COMMAND_KIND_REFUSAL = {
  [MACHINE_COMMAND_KIND.SHELL]: {
    NO_MAC: MACHINE_COMMAND_REFUSAL.NO_MAC,
    UNREADABLE: MACHINE_COMMAND_REFUSAL.UNREADABLE,
  },
  [MACHINE_COMMAND_KIND.COMPUTER]: {
    NO_MAC: MACHINE_COMMAND_REFUSAL.NO_COMPUTER,
    UNREADABLE: MACHINE_COMMAND_REFUSAL.COMPUTER_UNREADABLE,
  },
} as const satisfies Record<
  MachineCommandKind,
  { readonly NO_MAC: string; readonly UNREADABLE: string }
>;

/** What a call answers: what a shell command or an action on an app did, or why nothing ran. */
// A type rather than an interface, so a result is a `WireRecord` the model is handed as it stands.
export type MachineCommandAnswer =
  | ({ readonly status: typeof MACHINE_COMMAND_STATUS.RAN } & MacShellResult)
  | ({ readonly status: typeof MACHINE_COMMAND_STATUS.RAN } & MacComputerResult)
  | {
      readonly status: typeof MACHINE_COMMAND_STATUS.NOT_RUN;
      readonly reason: string;
      /** The grants the Mac lacked for an action on an app, which the transcript offers the place to turn on. */
      readonly missingPermissions?: readonly ComputerPermission[];
    };

/**
 * What a call asks of the Mac: a command of one kind, what that kind
 * carries, and how long it may run, the default where unsaid.
 */
export type MachineCommandAsk =
  | {
      readonly kind: typeof MACHINE_COMMAND_KIND.SHELL;
      readonly command: string;
      readonly timeoutSeconds?: number;
    }
  | {
      readonly kind: typeof MACHINE_COMMAND_KIND.COMPUTER;
      readonly conversationId: string;
      readonly action: MacComputerAction;
      readonly timeoutSeconds?: number;
    };

const readMachineCommand = readEither(machineCommandSchema);

const RUN_ON_MAC_INPUT = Schema.Struct({
  command: describeWire(
    Schema.String.check(Schema.isMinLength(1)),
    "One shell command, run in the developer's login shell from their home folder on their Mac, " +
      'such as "git -C ~/code/app status", "ls ~/code", or "node --version".',
  ),
  description: COMMAND_DESCRIPTION,
  timeout_seconds: Schema.optionalKey(
    describeWire(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: MACHINE_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS }),
      ),
      `Seconds before the command is killed; ${MACHINE_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS} when ` +
        `left out, at most ${MACHINE_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS}. Ask for longer only for a ` +
        "command that needs it, such as a test suite or a build.",
    ),
  ),
});

const readInput = readEither(RUN_ON_MAC_INPUT);

/**
 * The tool as every agent is offered it, the brain, a coding agent,
 * and either's workers alike: its name, its words, and its input schema.
 */
export const RUN_ON_MAC_TOOL = {
  name: AGENT_TOOL.RUN_ON_MAC,
  description:
    "Run one shell command on the developer's own Mac, the Mac of your task's assignee or, on a " +
    "task assigned to no one or to a member who left, of the member who started " +
    "you, in their login shell from their home " +
    "folder, and read what it printed. The developer's Mac may ask them first, and they may " +
    "decline, in which case the call answers `not-run`. It reaches whatever the developer's account on the Mac reaches: their local checkouts and " +
    "uncommitted work, installed tools, running servers. Never walk the whole home folder, as " +
    "`find ~`, `du ~`, or `grep -r ~` do, which makes macOS ask the developer for their Music, " +
    "Photos, Desktop, and Documents; find a checkout with Spotlight, such as " +
    "`mdfind -name <folder>`, or ask the developer where it is. Use it for what only the Mac has; " +
    "read the task's repository where you have it. Nothing reads stdin, so a command that asks " +
    `for input fails. It is killed after ${MACHINE_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS} seconds ` +
    "unless `timeout_seconds` says otherwise. Answers the exit code, stdout, and stderr, each " +
    `cut to ${MACHINE_COMMAND_BOUNDS.MAX_OUTPUT_CHARS} characters, or \`not-run\` and why, such as ` +
    `${PRODUCT_NAME} not running on the Mac.`,
  inputSchema: RUN_ON_MAC_INPUT,
} as const;

/** A call that ran nothing on the Mac, and why. */
export function machineCommandNotRun(reason: string): MachineCommandAnswer {
  return { status: MACHINE_COMMAND_STATUS.NOT_RUN, reason };
}

/** Whether a Mac of the account read for its commands within the freshness window. */
export function macListening(userId: string): TaskStoreEffect<boolean> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    macListeningSince(
      userId,
      new Date(now - Duration.toMillis(MACHINE_COMMAND_SERVICE.LISTENER_FRESH)),
    ),
  );
}

/** What a call answers for what the Mac said: what a shell command did, or why the Mac ran nothing. */
function answered(result: MachineCommandResult): MachineCommandAnswer {
  if ("refused" in result) {
    const { refused, missingPermissions } = result;
    const reason = { status: MACHINE_COMMAND_STATUS.NOT_RUN, reason: refused } as const;

    return missingPermissions === undefined ? reason : { ...reason, missingPermissions };
  }

  return { status: MACHINE_COMMAND_STATUS.RAN, ...result };
}

/** The account's topic, which every write to its commands notifies (`machineCommandSync`): a command queued, claimed, settled, or withdrawn. */
function commandTopics(userId: string): readonly SyncTopic[] {
  return [[TOPIC.ACCOUNT, userId]];
}

/** The command's result once a Mac settles it, looked for again as each write to the account's commands lands, until the deadline; nothing past it. */
function awaitedResult(
  userId: string,
  queued: MachineCommand,
): TaskStoreEffect<Option.Option<MachineCommandResult>> {
  const deadline = Duration.sum(
    Duration.seconds(queued.timeoutSeconds),
    MACHINE_COMMAND_SERVICE.ANSWER_GRACE,
  );

  return Effect.map(
    heldUntil(
      machineCommandResult(userId, queued.id),
      Option.isSome,
      commandTopics(userId),
      MACHINE_COMMAND_SERVICE.POLL,
      deadline,
    ),
    (held) => Option.flatMap(held, ({ read }) => read),
  );
}

/**
 * Runs one command on the account's Mac and answers what it came to:
 * refused at once where no Mac that runs its kind listens, and the row
 * withdrawn however the wait ends, an interrupted call's included.
 */
export function askMac(
  userId: string,
  ask: MachineCommandAsk,
): Effect.Effect<MachineCommandAnswer, never, DatabaseServices> {
  const refusal = MACHINE_COMMAND_KIND_REFUSAL[ask.kind];

  const asked = readMachineCommand({
    ...ask,
    id: randomUUID(),
    timeoutSeconds: ask.timeoutSeconds ?? MACHINE_COMMAND_BOUNDS.DEFAULT_TIMEOUT_SECONDS,
  });

  // A command the Mac's read would refuse is refused here, before it is queued where it would spoil that read.
  if (Result.isFailure(asked)) return Effect.succeed(machineCommandNotRun(refusal.UNREADABLE));
  const queued = asked.success;

  const run = Effect.gen(function* () {
    if (!(yield* macListening(userId))) return machineCommandNotRun(refusal.NO_MAC);

    const result = yield* queueMachineCommand(userId, queued).pipe(
      Effect.andThen(awaitedResult(userId, queued)),
      Effect.ensuring(Effect.ignore(withdrawMachineCommand(userId, queued.id))),
    );

    if (Option.isNone(result)) return machineCommandNotRun(MACHINE_COMMAND_REFUSAL.NO_ANSWER);

    return answered(result.value);
  });

  return Effect.catch(run, () =>
    Effect.succeed(machineCommandNotRun(MACHINE_COMMAND_REFUSAL.UNAVAILABLE)),
  );
}

/**
 * One `run_on_mac` call made in the conversation, whichever agent made it:
 * its input read against the tool's schema, then run on the Mac of its
 * task's assignee (`machineOwnerOf`) as `askMac` runs it. The one door every agent's tool goes through, so each
 * root's tool is a line.
 */
export function runOnMacTool(
  target: ConversationTarget,
  input: UnparsedWireValue,
): Effect.Effect<MachineCommandAnswer, never, DatabaseServices> {
  const read = readInput(input);

  if (Result.isFailure(read))
    return Effect.succeed(machineCommandNotRun(MACHINE_COMMAND_REFUSAL.UNREADABLE));
  const { command, timeout_seconds } = read.success;
  const kind = MACHINE_COMMAND_KIND.SHELL;

  const ask: MachineCommandAsk =
    timeout_seconds === undefined
      ? { kind, command }
      : { kind, command, timeoutSeconds: timeout_seconds };

  return Effect.gen(function* () {
    const owner = yield* Effect.result(machineOwnerOf(target));

    // Note that a read that fails refuses, because a command run on a guess could land on the wrong Mac.
    if (Result.isFailure(owner)) return machineCommandNotRun(MACHINE_COMMAND_REFUSAL.UNAVAILABLE);

    return yield* askMac(owner.success, ask);
  });
}

/**
 * One command a Mac heard of live, claimed for it by its id where it still
 * waits inside the claim window; none where another Mac took it, its call
 * withdrew it, or it waited too long. The window is kept here, on the
 * service's clock, because the live statement can measure nothing from
 * one. Note that any kind is claimed, because the Mac hears only of the
 * kinds it named. A Mac that joined as a device claims as it, so a command
 * meant for another machine is never its; one that names none claims only
 * what was queued for no device.
 */
export function claimedMachineCommand(
  userId: string,
  id: string,
  deviceId?: string,
): TaskStoreEffect<Option.Option<MachineCommand>> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    claimMachineCommand(
      userId,
      id,
      new Date(now - Duration.toMillis(MACHINE_COMMAND_SERVICE.CLAIM_WINDOW)),
      Object.values(MACHINE_COMMAND_KIND),
      deviceId,
    ),
  );
}

/**
 * The Mac's held read, naming the kinds it runs: it is counted listening
 * for them as the read arrives, and answered with every waiting command of
 * those kinds claimed for it as soon as one waits, looked for again as each
 * write to the account's commands lands, or with none once the hold ends. A
 * command of any other kind is left waiting for a Mac that runs it, or for
 * its call to give up on it. Note that a command aging out of the claim
 * window wakes nothing, because it only leaves what the read waits for.
 */
export function machineCommandsFor(
  userId: string,
  kinds: readonly MachineCommandKind[],
): TaskStoreEffect<readonly MachineCommand[]> {
  const queuedSince = Effect.map(
    Clock.currentTimeMillis,
    (now) => new Date(now - Duration.toMillis(MACHINE_COMMAND_SERVICE.CLAIM_WINDOW)),
  );

  return markMachineListening(userId).pipe(
    Effect.andThen(
      heldUntil(
        Effect.flatMap(queuedSince, (since) => machineCommandsWaiting(userId, since, kinds)),
        (any) => any,
        commandTopics(userId),
        MACHINE_COMMAND_SERVICE.POLL,
        MACHINE_COMMAND_SERVICE.HOLD,
      ),
    ),
    Effect.andThen(
      Effect.flatMap(queuedSince, (since) => claimMachineCommands(userId, since, kinds)),
    ),
  );
}
