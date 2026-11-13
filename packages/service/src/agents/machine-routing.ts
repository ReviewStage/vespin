/**
 * machine-routing.ts -- which machine an agent's terminal command or action on an app goes to, and why none where it can go nowhere.
 *
 * A call may reach the machines of the people its task lets agents use:
 * where the workspace has Following on, each follower whose "Let agents
 * here use my machines" switch is on; otherwise the one member whose Mac
 * its commands have always run on (`machineOwnerOf`), the task's assignee
 * or its agent's starter. Of those machines, one is reachable for a call
 * where it listened for commands lately and, for a shell command, its
 * command mode is not Never. A Mac's switch for apps stays on the Mac
 * itself, so an action on an app may go to a machine that then refuses it.
 *
 * The machine a call goes to is the one it names, by name or id; else the
 * agent's default machine (`agent.target_device_id`); else the machine the
 * agent itself runs on, where it is reachable; else the owner's machine
 * that listened last. A default that cannot take the call, or is gone,
 * refuses it, rather than moving it to another machine without a word, and
 * the refusal names the machines that could; so does a name two machines
 * share. A recording's stop goes to the machine the recording started on
 * (`machine_recording`), whatever the call names, and is refused with that
 * machine's name where it cannot take it. A Mac from before machines
 * claimed commands listens as its account alone, so where none of the
 * owner's machines listens as a device but the account does, the call is
 * queued for the account, as it was before.
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
  type MachineCommandKind,
} from "@repo/features/machine-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { EXPERIMENT } from "@repo/settings";
import { Clock, Duration, Effect, Option } from "effect";
import { experimentOnIn } from "./workspace-experiment-on.js";

/** How lately a machine must have listened to count as online: one held read, and room for the next to arrive, as `machine-command.ts` counts an account. */
const ONLINE_WITHIN = Duration.seconds(45);

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
      /** The machine refused, where the call was meant for one. */
      readonly machine?: RoutedMachine;
    };

/** A machine a call may reach, with whether its owner lets the task's agents use it. */
interface Candidate extends CommandMachine {
  readonly lets: boolean;
}

/** The people whose machines the call may reach, each with whether they let the task's agents use them. */
function peopleOf(routing: MachineRouting) {
  return Effect.gen(function* () {
    const { taskId, workspaceId } = routing;

    if (taskId === null || workspaceId === null) return [{ userId: routing.userId, lets: true }];

    if (!(yield* experimentOnIn(workspaceId, EXPERIMENT.FOLLOWING))) {
      return [{ userId: routing.userId, lets: true }];
    }

    const followers = yield* listTaskFollowers(routing.userId, taskId);

    return Option.match(followers, {
      onNone: () => [{ userId: routing.userId, lets: true }],
      onSome: (all) =>
        all.map((follower) => ({ userId: follower.userId, lets: follower.machines })),
    });
  });
}

function routed(machine: CommandMachine): RoutedMachine {
  return {
    id: machine.id,
    name: machine.name,
    owner: { userId: machine.userId, name: machine.ownerName },
  };
}

/** A machine as a refusal lists it: its name, and its owner's where it is not the caller's own. */
function listed(machine: CommandMachine): string {
  return `${machine.name} (${machine.ownerName})`;
}

/** The machines that could take the call, as a refusal ends: named, with how to choose one; a note that there are none otherwise. */
function others(reachable: readonly CommandMachine[], refused?: CommandMachine): string {
  const rest = reachable.filter((machine) => machine.id !== refused?.id);

  if (rest.length === 0) return " No other machine can take it now.";

  return ` It can go to ${rest.map(listed).join(", ")}: name one in \`machine\`.`;
}

/** Why the machine given cannot take a call of the kind given; none where it can. */
function whyNot(
  machine: Candidate,
  kind: MachineCommandKind,
  online: (machine: CommandMachine) => boolean,
): string | undefined {
  if (!machine.lets) {
    return `${machine.ownerName} doesn't let this task's agents use their machines.`;
  }

  if (!online(machine))
    return `${machine.name} is offline, or ${PRODUCT_NAME} isn't running on it.`;

  if (kind === MACHINE_COMMAND_KIND.SHELL && machine.commandMode === MACHINE_COMMAND_MODE.NEVER) {
    return `${machine.name} doesn't let agents run commands (its Settings › This Mac is set to Never).`;
  }

  return undefined;
}

/** The machines a call names: the one with its id, or else every one so named, whatever its case. */
function named(candidates: readonly Candidate[], name: string): readonly Candidate[] {
  const wanted = name.trim();
  const byId = candidates.filter((machine) => machine.id === wanted);

  if (byId.length > 0) return byId;

  return candidates.filter((machine) => machine.name.toLowerCase() === wanted.toLowerCase());
}

/** How a call is routed: its kind, the machine it names, whether a Mac of an account listens as its account alone, as one from before machines claimed does, and why it went nowhere where none of the owner's machines could take it. */
export interface RouteAsk {
  readonly kind: MachineCommandKind;
  readonly name?: string | undefined;
  readonly accountListening: (userId: string) => TaskStoreEffect<boolean>;
  readonly noMachine: string;
  /** The machine the conversation's recording runs on, which a stop goes to whatever else would choose; none for every other call. */
  readonly recordingOn?: string | undefined;
}

/**
 * Where a call made in the conversation given goes: the machine it names,
 * or else the agent's default, or else as the module says.
 */
export function routeOf(
  target: ConversationTarget,
  { kind, name, accountListening, noMachine, recordingOn }: RouteAsk,
): TaskStoreEffect<MachineRoute> {
  return Effect.gen(function* () {
    const routing = yield* machineRoutingOf(target);
    const people = yield* peopleOf(routing);
    const lets = new Map(people.map((person) => [person.userId, person.lets]));
    const machines = yield* commandMachinesOf(people.map((person) => person.userId));

    const candidates = machines.map((machine) => ({
      ...machine,
      lets: lets.get(machine.userId) === true,
    }));

    const since = (yield* Clock.currentTimeMillis) - Duration.toMillis(ONLINE_WITHIN);

    const online = (machine: CommandMachine) =>
      machine.seenAt !== null && machine.seenAt.getTime() >= since;

    const reachable = candidates.filter((machine) => whyNot(machine, kind, online) === undefined);

    const to = (machine: Candidate): MachineRoute => {
      const why = whyNot(machine, kind, online);

      return why === undefined
        ? { kind: MACHINE_ROUTE.MACHINE, machine: routed(machine) }
        : {
            kind: MACHINE_ROUTE.REFUSED,
            reason: `Not run: ${why}${others(reachable, machine)}`,
            machine: routed(machine),
          };
    };

    // Note that a stop goes where its recording runs, since only that Mac holds the video, and no other machine can say anything of it.
    if (recordingOn !== undefined) {
      const recorder = candidates.find((machine) => machine.id === recordingOn);

      if (recorder === undefined) {
        return {
          kind: MACHINE_ROUTE.REFUSED,
          reason:
            "Not run: the machine this recording runs on was removed, or its owner no longer lets this task's agents use it.",
        };
      }

      const why = whyNot(recorder, kind, online);

      if (why === undefined) return { kind: MACHINE_ROUTE.MACHINE, machine: routed(recorder) };

      return {
        kind: MACHINE_ROUTE.REFUSED,
        reason: `Not run: ${why} The recording runs there, so only it can stop it.`,
        machine: routed(recorder),
      };
    }

    if (name !== undefined) {
      const [machine, ...more] = named(candidates, name);

      if (machine === undefined) {
        return {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `Not run: no machine this task's agents may use is named ${JSON.stringify(name)}.${others(reachable)}`,
        };
      }

      // Note that a name two machines share refuses, since either could take one call and the next could go to the other.
      if (more.length > 0) {
        const ids = [machine, ...more].map((each) => `${listed(each)}: ${each.id}`);

        return {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `Not run: more than one machine is named ${JSON.stringify(name)}; name one in \`machine\` by its id (${ids.join(", ")}).`,
        };
      }

      return to(machine);
    }

    // Note that a default that cannot take the call refuses it, since moving it to another machine without a word could run it where the developer didn't mean.
    if (routing.targetDeviceId !== null) {
      const fallback = candidates.find((machine) => machine.id === routing.targetDeviceId);

      if (fallback !== undefined) return to(fallback);

      return {
        kind: MACHINE_ROUTE.REFUSED,
        reason: `Not run: this agent's default machine was removed, or its owner no longer lets this task's agents use it.${others(reachable)}`,
      };
    }

    const own = reachable.find((machine) => machine.id === routing.deviceId);

    if (own !== undefined) return to(own);

    const owners = reachable.find((machine) => machine.userId === routing.userId);

    if (owners !== undefined) return to(owners);

    // A Mac from before machines claimed commands listens as its account alone, and takes what is queued for none.
    const ownersOnline = candidates.some(
      (machine) => machine.userId === routing.userId && online(machine),
    );

    if (
      !ownersOnline &&
      lets.get(routing.userId) === true &&
      (yield* accountListening(routing.userId))
    ) {
      return { kind: MACHINE_ROUTE.ACCOUNT, userId: routing.userId };
    }

    return { kind: MACHINE_ROUTE.REFUSED, reason: `${noMachine}${others(reachable)}` };
  });
}
