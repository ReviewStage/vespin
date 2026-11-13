/**
 * machine-routing.test.ts -- which machine an agent's call goes to, over a real dialect.
 *
 * A call goes to the machine it names, else to the agent's default, else to
 * its owner's machine that listened last; a default or a named machine that
 * cannot take it refuses it, naming the machines that can. With Following
 * on, a follower's machines are reached only while their switch is on, and
 * a shell command never goes to a machine set to Never. Where none of the
 * owner's machines listens but a Mac from before machines claimed does, the
 * call goes to the account.
 *
 * Synthetic accounts, workspaces, and machines throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { registerDevice } from "@repo/database/models/device-store";
import { markMachineListening } from "@repo/database/models/machine-command-store";
import { followTask, setFollowerMachines } from "@repo/database/models/task-follower-store";
import { createTask } from "@repo/database/models/task-store";
import { setWorkspaceExperiment } from "@repo/database/models/workspace-experiment-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { device } from "@repo/database/schemas/device";
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
  type MachineCommandKind,
  type MachineCommandMode,
} from "@repo/features/machine-command-wire";
import { EXPERIMENT } from "@repo/settings";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { MACHINE_ROUTE, routeOf } from "./machine-routing.js";

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
    yield* Database.use((db) => db.update(device).set({ commandMode }).where(eq(device.id, id)));

    if (online) yield* markMachineListening(userId, id);

    return id;
  });

/** Where a call of the kind given, naming the machine given, goes, with the account's own listener answering as given. */
const route = (
  target: { readonly userId: string; readonly conversationId: string },
  ask: { readonly kind?: MachineCommandKind; readonly name?: string; readonly account?: boolean },
) =>
  routeOf(target, {
    kind: ask.kind ?? MACHINE_COMMAND_KIND.SHELL,
    name: ask.name,
    accountListening: () => Effect.succeed(ask.account ?? false),
    noMachine: NO_MACHINE,
  });

it.layer(getTestDB())("which machine an agent's call goes to", (it) => {
  it.effect(
    "a call goes to the machine it names, else the agent's default, else the owner's that listened; one that cannot take it is refused naming the ones that can",
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

        assert.deepEqual(yield* route(target, {}), toLaptop, "the owner's that listened");

        yield* Database.use((db) =>
          db.update(agentTable).set({ targetDeviceId: studio }).where(eq(agentTable.id, agentId)),
        );

        assert.deepEqual(yield* route(target, {}), {
          kind: MACHINE_ROUTE.REFUSED,
          reason:
            "Not run: Studio is offline, or Vespin isn't running on it. It can go to Laptop (Ana): name one in `machine`.",
          machine: { id: studio, name: "Studio", owner: ana },
        });
        assert.deepEqual(yield* route(target, { name: "laptop" }), toLaptop, "by name, any case");
        assert.deepEqual(yield* route(target, { name: "Mini" }), {
          kind: MACHINE_ROUTE.REFUSED,
          reason:
            'Not run: no machine this task\'s agents may use is named "Mini". It can go to Laptop (Ana): name one in `machine`.',
        });
      }),
  );

  it.effect(
    "with Following on, a follower's machine is reached only while their switch is on, and never by a shell command where it is set to Never",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, workspace, taskId, target } = yield* openPeople;
        const bens = yield* openMachine(teammate, "Studio", true, MACHINE_COMMAND_MODE.NEVER);
        yield* followTask(owner, { taskId, followerId: teammate, machines: true });
        const computer = { kind: MACHINE_COMMAND_KIND.COMPUTER, name: "Studio" };
        const off = yield* route(target, computer);

        yield* setWorkspaceExperiment({
          organizationId: workspace,
          experiment: EXPERIMENT.FOLLOWING,
          on: true,
          by: owner,
        });

        const on = yield* route(target, computer);
        const shell = yield* route(target, { name: "Studio" });
        yield* setFollowerMachines(teammate, taskId, false);
        const switchedOff = yield* route(target, computer);

        assert.equal(off.kind, MACHINE_ROUTE.REFUSED, "a follower's machines need Following on");
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
        });
        assert.equal(claimed.kind, MACHINE_ROUTE.MACHINE);
      }),
  );
});
