/**
 * machine-routing.ts -- which machine an agent's terminal command or action on an app goes to, and why none where it can go nowhere.
 *
 * Three rules decide it. First, whose machines count: the owner's always,
 * the task's assignee or, where it has none, its agent's starter
 * (`machineOwnerOf`), and a teammate's only while they follow the task with
 * their "Let agents here use my machines" switch on; a local agent's own
 * machine always counts for that agent. Of those, a machine can take a call
 * where it listened for commands lately and, for a shell command, its
 * command mode is not Never, or, for an action on an app, its switch for
 * apps is not off. A Mac whose app never carried that switch up keeps it on
 * the Mac itself, so an action on an app may go to it and be refused there.
 *
 * Second, which machine: the one the call names by id; else the agent's
 * own pick (`agent.target_device_id`); else, for a local agent's action on
 * an app, the machine it runs on; else the owner's default machine, as they
 * set it in Settings › Machines (`isDefaultMachine`), read at each call so
 * a change there is followed at once. A machine so chosen that cannot take
 * the call refuses it, rather than moving it to another without a word,
 * and nothing rewrites a pick: a reassignment that leaves one out of reach
 * refuses the next call. A refusal lists the machines that could take it,
 * each by its id: in words for the model, and as data (`why`, `others`) for
 * the transcript, which says why in its own words and offers each to make
 * the agent's pick.
 *
 * Third, a local agent runs no terminal command on its own machine through
 * a call, since its own shell runs there already; such a call is refused
 * however it got there. A Mac from before machines claimed commands listens
 * as its account alone, so where the owner's default is out of reach and
 * none of the owner's machines listens as a device but the account does,
 * the call is queued for the account, as it was before.
 */

import {
  type CommandMachine,
  commandMachinesOf,
  type MachineRouting,
  machineRoutingOf,
} from "@repo/database/models/machine-command-store";
import { listTaskFollowers } from "@repo/database/models/task-follower-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import {
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  MACHINE_UNREACHED,
  type MachineCommandKind,
  type MachineUnreached,
} from "@repo/features/machine-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Clock, Duration, Effect, Option } from "effect";

/** How lately a machine must have listened to count as online: one held read, and room for the next to arrive, as `machine-command.ts` counts an account. */
export const ONLINE_WITHIN = Duration.seconds(45);

export const MACHINE_ROUTE = {
  /** The call goes to one machine, queued for it alone. */
  MACHINE: "machine",
  /** The call goes to the account's Macs from before machines claimed commands, queued for none. */
  ACCOUNT: "account",
  /** The call goes nowhere, and why. */
  REFUSED: "refused",
} as const;

/** A machine as a call's answer names it: its id and name, and whose it is. */
// A type rather than an interface, so an answer naming one is a `WireRecord` the model is handed as it stands.
export type RoutedMachine = {
  readonly id: string;
  readonly name: string;
  readonly owner: { readonly userId: string; readonly name: string };
};

export type MachineRoute =
  | { readonly kind: typeof MACHINE_ROUTE.MACHINE; readonly machine: RoutedMachine }
  | { readonly kind: typeof MACHINE_ROUTE.ACCOUNT; readonly userId: string }
  | {
      readonly kind: typeof MACHINE_ROUTE.REFUSED;
      readonly reason: string;
      /** Why, as data the transcript says in its own words; `reason` is the model's. */
      readonly why: MachineUnreached;
      /** The machines that could take the call now, which the transcript offers to make the default. */
      readonly others: readonly RoutedMachine[];
      /** The machine refused, where the call was meant for one. */
      readonly machine?: RoutedMachine;
    };

/** A machine a call may reach, with whether its owner lets the task's agents use it and whether it listened lately. */
interface Candidate extends CommandMachine {
  readonly lets: boolean;
  readonly online: boolean;
}

/** A machine as the panel lists it to be an agent's default: as an answer names it, with whether its owner lets the task's agents use it and whether it listened lately. */
export type ListedMachine = RoutedMachine & { readonly lets: boolean; readonly online: boolean };

/** A person whose machines a call may reach, with whether they let the task's agents use them. */
interface Person {
  readonly userId: string;
  readonly lets: boolean;
}

/**
 * The people whose machines the call may reach: the owner, who always
 * lets, each follower with whether their switch is on, and a local agent's
 * starter, whose own machine that agent always reaches whatever their
 * switch says (`candidatesOf`).
 */
function peopleOf(routing: MachineRouting) {
  return Effect.gen(function* () {
    const { taskId, workspaceId } = routing;
    const owner: Person = { userId: routing.userId, lets: true };

    const followers =
      taskId === null || workspaceId === null
        ? []
        : Option.getOrElse(yield* listTaskFollowers(routing.userId, taskId), () => []);

    const people: Person[] = [owner];

    for (const follower of followers) {
      if (follower.userId !== owner.userId) {
        people.push({ userId: follower.userId, lets: follower.machines });
      }
    }

    const starter = routing.starterId;

    if (
      routing.deviceId !== null &&
      starter !== null &&
      !people.some((person) => person.userId === starter)
    ) {
      people.push({ userId: starter, lets: false });
    }

    return people;
  });
}

/** The machines of the people given, each with whether its owner lets the task's agents use it and whether it listened lately. */
function machinesOfPeople(people: readonly Person[]) {
  return Effect.gen(function* () {
    const lets = new Map(people.map((person) => [person.userId, person.lets]));
    const machines = yield* commandMachinesOf(people.map((person) => person.userId));
    const since = (yield* Clock.currentTimeMillis) - Duration.toMillis(ONLINE_WITHIN);

    const candidates: readonly Candidate[] = machines.map((machine) => ({
      ...machine,
      lets: lets.get(machine.userId) === true,
      online: machine.seenAt !== null && machine.seenAt.getTime() >= since,
    }));

    return candidates;
  });
}

/** The machines a call made under the routing given may reach, as `machinesOfPeople` reads them, a local agent's own machine let whatever its owner's switch says. */
function candidatesOf(routing: MachineRouting) {
  return Effect.map(Effect.flatMap(peopleOf(routing), machinesOfPeople), (candidates) =>
    candidates.map((machine) =>
      machine.id === routing.deviceId ? { ...machine, lets: true } : machine,
    ),
  );
}

function routed(machine: CommandMachine): RoutedMachine {
  return {
    id: machine.id,
    name: machine.name,
    owner: { userId: machine.userId, name: machine.ownerName },
  };
}

/** A machine as a refusal lists it: its name, its owner's, and the id a call names it by. */
function listed(machine: CommandMachine): string {
  return `${machine.name} (${machine.ownerName}), id "${machine.id}"`;
}

/** The machines that could take the call, but the one refused. */
function othersThan(reachable: readonly CommandMachine[], refused?: CommandMachine) {
  return reachable.filter((machine) => machine.id !== refused?.id);
}

/** The machines that could take the call, as a refusal ends: named, with how to choose one; a note that there are none otherwise. */
function othersWords(rest: readonly CommandMachine[]): string {
  if (rest.length === 0) return " No other machine can take it now.";

  return ` It can go to ${rest.map(listed).join("; ")}: pass one's id in \`machine\`.`;
}

/** A call refused for the reason given, in the model's words and as data, naming the machines that could take it but the one refused. */
function refusal(
  why: { readonly code: MachineUnreached; readonly words: string },
  reachable: readonly CommandMachine[],
  refused?: CommandMachine,
): MachineRoute {
  const rest = othersThan(reachable, refused);

  return {
    kind: MACHINE_ROUTE.REFUSED,
    reason: `${why.words}${othersWords(rest)}`,
    why: why.code,
    others: rest.map(routed),
    ...(refused === undefined ? undefined : { machine: routed(refused) }),
  };
}

/** Why the machine given cannot take a call of the kind given from an agent running on the machine of the id given, none where it runs on none, as data and in the model's words; none where it can. */
function whyNot(
  machine: Candidate,
  kind: MachineCommandKind,
  ownId: string | null,
): { readonly code: MachineUnreached; readonly words: string } | undefined {
  if (kind === MACHINE_COMMAND_KIND.SHELL && machine.id === ownId) {
    return {
      code: MACHINE_UNREACHED.OWN_SHELL,
      words: `Not run: you run on ${machine.name} yourself, so run the command from your own shell.`,
    };
  }

  if (!machine.lets) {
    return {
      code: MACHINE_UNREACHED.NOT_LET,
      words: `Not run: ${machine.ownerName} doesn't let this task's agents use their machines.`,
    };
  }

  if (!machine.online) {
    return {
      code: MACHINE_UNREACHED.OFFLINE,
      words: `Not run: ${machine.name} is offline, or ${PRODUCT_NAME} isn't running on it.`,
    };
  }

  if (kind === MACHINE_COMMAND_KIND.SHELL && machine.commandMode === MACHINE_COMMAND_MODE.NEVER) {
    return {
      code: MACHINE_UNREACHED.COMMANDS_NEVER,
      words: `Not run: ${machine.name} doesn't let agents run commands (its Settings › This Mac is set to Never).`,
    };
  }

  // Note that a machine whose app never carried its switch up decides on the Mac itself, as before the switch was kept here.
  if (kind === MACHINE_COMMAND_KIND.COMPUTER && machine.computerUse === false) {
    return {
      code: MACHINE_UNREACHED.APPS_OFF,
      words: `Not run: ${machine.name} doesn't let agents use its apps (Let agents use its apps is off for it in Settings › Machines).`,
    };
  }

  return undefined;
}

/** How a call is routed: its kind, the machine it names, whether a Mac of an account listens as its account alone, as one from before machines claimed does, and why it went nowhere where none of the owner's machines could take it. */
export interface RouteAsk {
  readonly kind: MachineCommandKind;
  readonly machineId?: string | undefined;
  readonly accountListening: (userId: string) => TaskStoreEffect<boolean>;
  readonly noMachine: string;
}

/**
 * Where a call made in the conversation given goes: the machine it names,
 * else the agent's pick, else a local agent's own machine for an action on
 * an app, else the owner's default machine, as the module says.
 */
export function routeOf(
  target: ConversationTarget,
  { kind, machineId, accountListening, noMachine }: RouteAsk,
): TaskStoreEffect<MachineRoute> {
  return Effect.gen(function* () {
    const routing = yield* machineRoutingOf(target);
    const candidates = yield* candidatesOf(routing);
    const whyNotHere = (machine: Candidate) => whyNot(machine, kind, routing.deviceId);
    const reachable = candidates.filter((machine) => whyNotHere(machine) === undefined);
    const byId = (id: string | null) => candidates.find((machine) => machine.id === id);

    const to = (machine: Candidate): MachineRoute => {
      const why = whyNotHere(machine);

      return why === undefined
        ? { kind: MACHINE_ROUTE.MACHINE, machine: routed(machine) }
        : refusal(why, reachable, machine);
    };

    if (machineId !== undefined) {
      const named = byId(machineId);

      if (named !== undefined) return to(named);

      return refusal(
        {
          code: MACHINE_UNREACHED.UNKNOWN_MACHINE,
          words: `Not run: no machine this task's agents may use has the id ${JSON.stringify(machineId)}.`,
        },
        reachable,
      );
    }

    // Note that a pick that cannot take the call refuses it, since moving it to another machine without a word could run it where the developer didn't mean.
    if (routing.targetDeviceId !== null) {
      const picked = byId(routing.targetDeviceId);

      if (picked !== undefined) return to(picked);

      return refusal(
        {
          code: MACHINE_UNREACHED.DEFAULT_GONE,
          words:
            "Not run: this agent's default machine was removed, or its owner no longer lets this task's agents use it.",
        },
        reachable,
      );
    }

    const own = byId(routing.deviceId);

    if (own !== undefined && kind === MACHINE_COMMAND_KIND.COMPUTER) return to(own);

    const ownersDefault = candidates.find(
      (machine) => machine.userId === routing.userId && machine.isDefault,
    );

    if (ownersDefault !== undefined && whyNotHere(ownersDefault) === undefined) {
      return to(ownersDefault);
    }

    // A Mac from before machines claimed commands listens as its account alone, and takes what is queued for none.
    const ownersOnline = candidates.some(
      (machine) => machine.userId === routing.userId && machine.online,
    );

    if (!ownersOnline && (yield* accountListening(routing.userId))) {
      return { kind: MACHINE_ROUTE.ACCOUNT, userId: routing.userId };
    }

    if (ownersDefault !== undefined) return to(ownersDefault);

    return refusal({ code: MACHINE_UNREACHED.NO_MACHINE, words: noMachine }, reachable);
  });
}

/** A machine as a list names it (`ListedMachine`). */
function listedOf(machine: Candidate): ListedMachine {
  return { ...routed(machine), lets: machine.lets, online: machine.online };
}

/**
 * The machines a call made in the conversation given may reach by policy,
 * those whose owners let the task's agents use them, online or not, the
 * one that listened last first: what an agent's default machine may be set
 * to, and what the panel lists to pick one from.
 */
export function defaultMachinesOf(
  target: ConversationTarget,
): TaskStoreEffect<readonly ListedMachine[]> {
  return Effect.gen(function* () {
    const candidates = yield* candidatesOf(yield* machineRoutingOf(target));

    return candidates.filter((machine) => machine.lets).map(listedOf);
  });
}

/**
 * The machines of a task's followers, each with whether its owner lets the
 * task's agents use it and whether it listened lately, as a follower's card
 * lists them, read for the account given; none where the account does not
 * reach the task.
 */
export function followerMachinesOf(
  userId: string,
  taskId: string,
): TaskStoreEffect<readonly ListedMachine[]> {
  return Effect.gen(function* () {
    const followers = yield* listTaskFollowers(userId, taskId);

    if (Option.isNone(followers)) return [];

    const people = followers.value.map((follower) => ({
      userId: follower.userId,
      lets: follower.machines,
    }));

    return (yield* machinesOfPeople(people)).map(listedOf);
  });
}
