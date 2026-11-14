/**
 * machine-routing.test.ts -- which machine an agent's call goes to, over a real dialect.
 *
 * A call goes to the machine it names, else to the agent's pick, else, for a
 * local agent's action on an app, to the machine it runs on, else to its
 * owner's default machine from Settings, followed as it changes; a machine
 * so chosen that cannot take it refuses it, naming the machines that can,
 * in words for the model and as data for the transcript, with why. The
 * owner's machines always count, a follower's only while their switch is
 * on, and a local agent's own machine always counts for it but takes none
 * of its terminal commands. A shell command never goes to a machine set to
 * Never. Where none of the owner's machines listens but a Mac from before
 * machines claimed does, the call goes to the account.
 *
 * Synthetic accounts, workspaces, and machines throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { changeMachine, registerDevice } from "@repo/database/models/device-store";
import { markMachineListening } from "@repo/database/models/machine-command-store";
import { followTask, setFollowerMachines } from "@repo/database/models/task-follower-store";
import { createTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { device } from "@repo/database/schemas/device";
import { task } from "@repo/database/schemas/task";
import {
  DEVICE_LAYOUT,
  getTestDB,
  joinWorkspace,
  openTaskAgent,
  openWorkspace,
} from "@repo/database/testing";
import {
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  MACHINE_UNREACHED,
  type MachineCommandKind,
  type MachineCommandMode,
} from "@repo/features/machine-command-wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { defaultMachinesOf, MACHINE_ROUTE, type MachineRoute, routeOf } from "./machine-routing.js";

const NO_MACHINE = "Not run: no machine can take it.";

/** The developer who started the agent, and a teammate in their workspace, each by name. */
const openPeople = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, teammate] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const [id, name] of [
    [owner, "Ana"],
    [teammate, "Ben"],
  ] as const) {
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
  }

  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Release" });
  const agentId = yield* openTaskAgent(owner, workspace, taskId);

  const [row] = yield* db
    .select({ conversationId: agentTable.conversationId })
    .from(agentTable)
    .where(eq(agentTable.id, agentId));

  assert.ok(row !== undefined);
  const target = { userId: owner, conversationId: row.conversationId };

  return { owner, teammate, workspace, taskId, agentId, target };
});

/** How many machines joined so far, so each joins after the last and the first is the default until another is picked. */
let joined = 0;

/** A machine of the account, listening now where `online`, with the command mode given; its id. */
const openMachine = (
  userId: string,
  name: string,
  online: boolean,
  commandMode: MachineCommandMode = MACHINE_COMMAND_MODE.ASK,
) =>
  Effect.gen(function* () {
    const id = randomUUID();
    yield* registerDevice(userId, { id, name, ...DEVICE_LAYOUT });
    joined += 1;
    const createdAt = new Date(joined * 1_000);

    yield* Database.use((db) =>
      db.update(device).set({ commandMode, createdAt }).where(eq(device.id, id)),
    );

    if (online) yield* markMachineListening(userId, id);

    return id;
  });

/** Where a call of the kind given, naming the machine's id given, goes, with the account's own listener answering as given. */
const route = (
  target: { readonly userId: string; readonly conversationId: string },
  ask: {
    readonly kind?: MachineCommandKind;
    readonly machineId?: string;
    readonly account?: boolean;
  },
) =>
  routeOf(target, {
    kind: ask.kind ?? MACHINE_COMMAND_KIND.SHELL,
    machineId: ask.machineId,
    accountListening: () => Effect.succeed(ask.account ?? false),
    noMachine: NO_MACHINE,
  });

/** The agent of the id set to run on the machine of the id given, as a local agent does, or picking it, as its composer chip does. */
const setAgent = (agentId: string, set: { deviceId?: string; targetDeviceId?: string | null }) =>
  Database.use((db) => db.update(agentTable).set(set).where(eq(agentTable.id, agentId)));

it.layer(getTestDB())("which machine an agent's call goes to", (it) => {
  it.effect(
    "a call goes to the machine whose id it names, else the agent's pick, else the owner's Settings default as it stands; one that cannot take it, its apps switched off for an action on an app among them, or a pick that is gone, is refused listing the ids of the ones that can",
    () =>
      Effect.gen(function* () {
        const { owner, agentId, target } = yield* openPeople;
        const laptop = yield* openMachine(owner, "Laptop", true);
        const studio = yield* openMachine(owner, "Studio", false);
        const ana = { userId: owner, name: "Ana" };

        const toLaptop = {
          kind: MACHINE_ROUTE.MACHINE,
          machine: { id: laptop, name: "Laptop", owner: ana },
        };

        const studioOffline = {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `Not run: Studio is offline, or Vespin isn't running on it. It can go to Laptop (Ana), id "${laptop}": pass one's id in \`machine\`.`,
          why: MACHINE_UNREACHED.OFFLINE,
          others: [toLaptop.machine],
          machine: { id: studio, name: "Studio", owner: ana },
        };

        assert.deepEqual(yield* route(target, {}), toLaptop, "the owner's first machine");
        yield* changeMachine(owner, studio, { makeDefault: true });

        assert.deepEqual(
          yield* route(target, {}),
          studioOffline,
          "the default picked in Settings, never moved to another without a word",
        );

        assert.deepEqual(
          yield* route(target, { machineId: laptop }),
          toLaptop,
          "a call naming a machine goes there whatever the default",
        );

        yield* changeMachine(owner, laptop, { makeDefault: true });
        assert.deepEqual(yield* route(target, {}), toLaptop, "followed as it changes");

        yield* setAgent(agentId, { targetDeviceId: studio });
        assert.deepEqual(yield* route(target, {}), studioOffline, "the agent's pick first");
        assert.deepEqual(yield* route(target, { machineId: laptop }), toLaptop, "by its id");

        yield* Database.use((db) =>
          db.update(device).set({ computerUse: false }).where(eq(device.id, laptop)),
        );

        const appsOff = yield* route(target, {
          kind: MACHINE_COMMAND_KIND.COMPUTER,
          machineId: laptop,
        });

        assert.match(
          appsOff.kind === MACHINE_ROUTE.REFUSED ? appsOff.reason : "",
          /^Not run: Laptop doesn't let agents use its apps \(Let agents use its apps is off for it in Settings › Machines\)\./u,
          "an action on an app is refused where the machine's apps switch is off",
        );
        assert.equal(
          appsOff.kind === MACHINE_ROUTE.REFUSED ? appsOff.why : undefined,
          MACHINE_UNREACHED.APPS_OFF,
          "and says why as data, for the card",
        );
        assert.deepEqual(
          yield* route(target, { machineId: laptop }),
          toLaptop,
          "a shell command still goes",
        );
        assert.deepEqual(yield* route(target, { machineId: "Laptop" }), {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `Not run: no machine this task's agents may use has the id "Laptop". It can go to Laptop (Ana), id "${laptop}": pass one's id in \`machine\`.`,
          why: MACHINE_UNREACHED.UNKNOWN_MACHINE,
          others: [toLaptop.machine],
        });

        yield* Database.use((db) =>
          db
            .update(device)
            .set({ removedAt: new Date(0) })
            .where(eq(device.id, studio)),
        );

        assert.deepEqual(yield* route(target, {}), {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `Not run: this agent's default machine was removed, or its owner no longer lets this task's agents use it. It can go to Laptop (Ana), id "${laptop}": pass one's id in \`machine\`.`,
          why: MACHINE_UNREACHED.DEFAULT_GONE,
          others: [toLaptop.machine],
        });
      }),
  );

  it.effect(
    "a follower's machine is reached only while their switch is on, and never by a shell command where it is set to Never",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId, target } = yield* openPeople;
        const bens = yield* openMachine(teammate, "Studio", true, MACHINE_COMMAND_MODE.NEVER);
        yield* followTask(owner, { taskId, followerId: teammate, machines: true });
        const computer = { kind: MACHINE_COMMAND_KIND.COMPUTER, machineId: bens };
        const on = yield* route(target, computer);
        const shell = yield* route(target, { machineId: bens });
        yield* setFollowerMachines(teammate, taskId, false);
        const switchedOff = yield* route(target, computer);

        assert.deepEqual(on, {
          kind: MACHINE_ROUTE.MACHINE,
          machine: { id: bens, name: "Studio", owner: { userId: teammate, name: "Ben" } },
        });
        assert.match(shell.kind === MACHINE_ROUTE.REFUSED ? shell.reason : "", /set to Never/u);
        assert.match(
          switchedOff.kind === MACHINE_ROUTE.REFUSED ? switchedOff.reason : "",
          /^Not run: Ben doesn't let this task's agents use their machines\./u,
        );
      }),
  );

  it.effect(
    "the owner's machines count whatever their own switch says, and a reassignment moves a call with no pick to the new owner's default but leaves a pick it puts out of reach refused",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId, agentId, target } = yield* openPeople;
        const anas = yield* openMachine(owner, "Laptop", true);
        const bens = yield* openMachine(teammate, "Studio", true);
        yield* followTask(owner, { taskId, followerId: owner, machines: false });
        yield* setFollowerMachines(owner, taskId, false);
        const ownSwitchOff = yield* route(target, {});

        yield* Database.use((db) =>
          db.update(task).set({ assigneeId: teammate }).where(eq(task.id, taskId)),
        );

        const reassigned = yield* route(target, {});
        yield* setAgent(agentId, { targetDeviceId: anas });
        const pickOutOfReach = yield* route(target, {});

        assert.equal(ownSwitchOff.kind === MACHINE_ROUTE.MACHINE && ownSwitchOff.machine.id, anas);
        assert.equal(reassigned.kind === MACHINE_ROUTE.MACHINE && reassigned.machine.id, bens);
        assert.equal(
          pickOutOfReach.kind === MACHINE_ROUTE.REFUSED && pickOutOfReach.why,
          MACHINE_UNREACHED.NOT_LET,
          "nothing rewrites the pick",
        );
      }),
  );

  it.effect(
    "a local agent's action on an app goes to the machine it runs on, which always counts for it, and its terminal command never does but goes to the owner's default elsewhere",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId, agentId, target } = yield* openPeople;
        const laptop = yield* openMachine(owner, "Laptop", true);
        const studio = yield* openMachine(owner, "Studio", true);
        const bens = yield* openMachine(teammate, "Mini", true);
        yield* setAgent(agentId, { deviceId: laptop });
        const computer = { kind: MACHINE_COMMAND_KIND.COMPUTER };
        const appsHere = yield* route(target, computer);
        const shellOnDefault = yield* route(target, {});
        const shellNamed = yield* route(target, { machineId: laptop });
        yield* changeMachine(owner, studio, { makeDefault: true });
        const shellElsewhere = yield* route(target, {});

        // Note that the starter's own switch is off and the task is a teammate's, yet the machine the agent runs on still counts for it.
        yield* followTask(owner, { taskId, followerId: owner, machines: false });
        yield* setFollowerMachines(owner, taskId, false);

        yield* Database.use((db) =>
          db.update(task).set({ assigneeId: teammate }).where(eq(task.id, taskId)),
        );

        const appsAfterReassign = yield* route(target, computer);
        const shellAfterReassign = yield* route(target, {});

        const own = (route: MachineRoute) =>
          route.kind === MACHINE_ROUTE.MACHINE && route.machine.id;

        const why = (route: MachineRoute) => route.kind === MACHINE_ROUTE.REFUSED && route.why;

        assert.equal(own(appsHere), laptop);
        assert.equal(why(shellOnDefault), MACHINE_UNREACHED.OWN_SHELL, "its default is its own");
        assert.match(
          shellOnDefault.kind === MACHINE_ROUTE.REFUSED ? shellOnDefault.reason : "",
          /^Not run: you run on Laptop yourself, so run the command from your own shell\. It can go to Studio \(Ana\)/u,
        );
        assert.equal(why(shellNamed), MACHINE_UNREACHED.OWN_SHELL, "named, too");
        assert.equal(own(shellElsewhere), studio);
        assert.equal(own(appsAfterReassign), laptop);
        assert.equal(own(shellAfterReassign), bens, "the new owner's default");
      }),
  );

  it.effect(
    "a local agent's terminal command for its own machine is refused, even where an old Mac listens as the account",
    () =>
      Effect.gen(function* () {
        const { owner, agentId, target } = yield* openPeople;
        const laptop = yield* openMachine(owner, "Laptop", false);
        yield* setAgent(agentId, { deviceId: laptop });
        const routed = yield* route(target, { account: true });

        assert.equal(
          routed.kind === MACHINE_ROUTE.REFUSED && routed.why,
          MACHINE_UNREACHED.OWN_SHELL,
        );
      }),
  );

  it.effect(
    "an agent's default may be set to a machine of anyone who lets the task's agents use theirs, online or not, and to no machine of a follower whose switch is off",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId, target } = yield* openPeople;
        const laptop = yield* openMachine(owner, "Laptop", false);
        const studio = yield* openMachine(teammate, "Studio", true);
        yield* followTask(owner, { taskId, followerId: teammate, machines: true });
        const listed = (yield* defaultMachinesOf(target)).map(({ id, online }) => ({ id, online }));
        yield* setFollowerMachines(teammate, taskId, false);
        const switchedOff = (yield* defaultMachinesOf(target)).map(({ id }) => id);

        assert.deepEqual(
          [...listed].sort((a, b) => a.id.localeCompare(b.id)),
          [
            { id: laptop, online: false },
            { id: studio, online: true },
          ].sort((a, b) => a.id.localeCompare(b.id)),
        );
        assert.deepEqual(switchedOff, [laptop]);
      }),
  );

  it.effect(
    "a Mac from before machines claimed takes the call as its account, only where none of the owner's machines listens",
    () =>
      Effect.gen(function* () {
        const { owner, target } = yield* openPeople;
        const asAccount = yield* route(target, { account: true });
        const nowhere = yield* route(target, {});
        yield* openMachine(owner, "Laptop", true);
        const claimed = yield* route(target, { account: true });

        assert.deepEqual(asAccount, { kind: MACHINE_ROUTE.ACCOUNT, userId: owner });
        assert.deepEqual(nowhere, {
          kind: MACHINE_ROUTE.REFUSED,
          reason: `${NO_MACHINE} No other machine can take it now.`,
          why: MACHINE_UNREACHED.NO_MACHINE,
          others: [],
        });
        assert.equal(claimed.kind, MACHINE_ROUTE.MACHINE);
      }),
  );
});
