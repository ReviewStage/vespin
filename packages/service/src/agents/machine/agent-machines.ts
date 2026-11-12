/**
 * agent-machines.ts -- the two agent machines behind one: each call answered by the machine its agent's row names, a cloud sandbox or the starter's Mac.
 *
 * A call that holds an agent asks the machine its row names
 * (`agent.machine`), and one that holds a place or a runner asks the
 * machine that place names. A call that holds a session alone, as a door
 * and a later call's find do, asks the Mac first whether the session is a
 * local agent's, and a cloud sandbox otherwise, so a sandbox's session costs
 * one read of the store before its own call.
 *
 * The deployment composes it once for the native harnesses and the doors
 * (`agentMachinesLayer`), and a launch's end and the sweep's retire, which
 * hold no edge's runner for a checkout, compose its lifecycle alone
 * (`deploymentLifecycle`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Sandbox } from "@repo/sandbox";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import { AgentMachine, type AgentMachineService, type MachineLifecycle } from "./agent-machine.js";
import { type DeviceMachineService, deviceMachine } from "./device-machine.js";
import { type SandboxMachineOptions, sandboxLifecycle, sandboxMachine } from "./sandbox-machine.js";

/** The lifecycle of whichever machine answers for the session, or for the place or runner named. */
function routedLifecycle(cloud: MachineLifecycle, mac: DeviceMachineService): MachineLifecycle {
  const of = (machine: AgentMachineKind): MachineLifecycle =>
    machine === AGENT_MACHINE.DEVICE ? mac : cloud;

  const bySession = <A, E, R>(
    session: string,
    call: (machine: MachineLifecycle) => Effect.Effect<A, E, R>,
  ) => Effect.flatMap(mac.owns(session), (owned) => call(owned ? mac : cloud));

  return {
    findPlace: (userId, session) =>
      bySession(session, (machine) => machine.findPlace(userId, session)),
    recordRunner: (place, record) => of(place.machine).recordRunner(place, record),
    firewall: {
      write: (place, userId, sources) => of(place.machine).firewall.write(place, userId, sources),
      keepLaunch: (place, userId, launch) =>
        of(place.machine).firewall.keepLaunch(place, userId, launch),
    },
    stop: (place) => of(place.machine).stop(place),
    discard: (found) => of(found.machine).discard(found),
    writeFiles: (place, files) => of(place.machine).writeFiles(place, files),
    writeLine: (handle, text) => of(handle.machine).writeLine(handle, text),
    wrote: (handle, text) => of(handle.machine).wrote(handle, text),
    runnerExit: (handle, within) => of(handle.machine).runnerExit(handle, within),
    kill: (handle) => of(handle.machine).kill(handle),
    readFile: (session, path, bound) =>
      bySession(session, (machine) => machine.readFile(session, path, bound)),
    restoreCheckout: (session, snapshot) =>
      bySession(session, (machine) => machine.restoreCheckout(session, snapshot)),
    diffCheckout: (session, range) =>
      bySession(session, (machine) => machine.diffCheckout(session, range)),
    phoneVideo: (session, path) =>
      bySession(session, (machine) => machine.phoneVideo(session, path)),
  };
}

/** Both machines behind one, as above. */
function routedMachine(cloud: AgentMachineService, mac: DeviceMachineService): AgentMachineService {
  const of = (machine: AgentMachineKind | undefined): AgentMachineService =>
    machine === AGENT_MACHINE.DEVICE ? mac : cloud;

  return {
    ...routedLifecycle(cloud, mac),
    layout: (agent) => of(agent.machine).layout(agent),
    deliverCredentials: (agent, credentials) =>
      of(agent.machine).deliverCredentials(agent, credentials),
    open: (ask, use) => of(ask.agent.machine).open(ask, use),
    resume: (found, agent, setup) => of(found.machine).resume(found, agent, setup),
    checkOutMissing: (place, target, agent, setup) =>
      of(place.machine).checkOutMissing(place, target, agent, setup),
    launchRunner: (place, launch) => of(place.machine).launchRunner(place, launch),
  };
}

/** The deployment's machines' lifecycle, over the runtime's `Sandbox`. */
export const deploymentLifecycle: Effect.Effect<
  MachineLifecycle,
  never,
  HttpClient.HttpClient | DatabaseServices | Sandbox
> = Effect.gen(function* () {
  return routedLifecycle(sandboxLifecycle(yield* Sandbox), yield* deviceMachine);
});

/** The deployment's machines behind one, over the runtime's `Sandbox`, its checkout run through the edge's runner. */
export function agentMachinesLayer(
  options: SandboxMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient | DatabaseServices | Sandbox> {
  return Layer.effect(
    AgentMachine,
    Effect.gen(function* () {
      return routedMachine(sandboxMachine(yield* Sandbox, options.run), yield* deviceMachine);
    }),
  );
}
