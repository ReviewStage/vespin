/**
 * agent-machines.ts -- the agent machines behind one: each call answered by the machine its agent's row names, a cloud sandbox or the starter's Mac, and refused for a machine its workspace owns.
 *
 * A call that holds an agent asks the machine its row names
 * (`agent.machine`), and one that holds a place or a runner asks the
 * machine that place names. A call that holds a session alone, as a door
 * and a later call's find do, asks the Mac first whether the session is a
 * local agent's, and a cloud sandbox otherwise, so a sandbox's session costs
 * one read of the store before its own call.
 *
 * An agent on a machine its workspace owns (`AGENT_MACHINE.WORKSPACE`)
 * has no machine of ours to answer it yet, so every call for it fails
 * closed (`pendingWorkspaceMachine`) rather than fall through to a cloud
 * sandbox, which would run a workspace's agent on the deployment's own
 * Vercel account: a launch or a write to it is refused by name
 * (`LaunchRefused`'s `workspaceMachinesPending`), and a call that can only
 * fail as a machine's is unavailable, as a stopped sandbox's is. Its
 * session's doors still ask the Mac and then a cloud sandbox, which holds
 * no place opened for it.
 *
 * The deployment composes it once for the native harnesses and the doors
 * (`agentMachinesLayer`), and a launch's end and the sweep's retire, which
 * hold no edge's runner for a checkout, compose its lifecycle alone
 * (`deploymentLifecycle`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { AgentMachineKind } from "@repo/features/agent-wire";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Sandbox, SandboxUnavailable } from "@repo/sandbox";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import {
  AgentMachine,
  type AgentMachineService,
  LaunchRefused,
  type MachineLifecycle,
} from "./agent-machine.js";
import { type DeviceMachineService, deviceMachine } from "./device-machine.js";
import { type SandboxMachineOptions, sandboxLifecycle, sandboxMachine } from "./sandbox-machine.js";

/** Why a workspace's agent is refused, in the words a line and a turn's record keep. */
const WORKSPACE_MACHINES_PENDING = "workspace machines aren't available yet";

/** A launch or a write to a workspace's agent, refused by name. */
function workspaceRefusal(): LaunchRefused {
  return new LaunchRefused({ reason: WORKSPACE_MACHINES_PENDING, workspaceMachinesPending: true });
}

/** A call on a workspace's agent that can only fail as a machine's, unavailable. */
function workspaceUnavailable(): SandboxUnavailable {
  return new SandboxUnavailable({ detail: WORKSPACE_MACHINES_PENDING });
}

/**
 * The machine a workspace's agent is answered by until one of ours runs it:
 * every call fails, as above, and credentials are handed to nothing, so no
 * placeholder is minted for a launch that never starts.
 */
const pendingWorkspaceMachine: AgentMachineService = {
  layout: () => Effect.fail(workspaceRefusal()),
  deliverCredentials: () => ({ env: {}, swaps: new Map() }),
  open: () => Effect.fail(workspaceRefusal()),
  findPlace: () => Effect.fail(workspaceUnavailable()),
  recordRunner: () => Effect.fail(workspaceUnavailable()),
  firewall: {
    write: () => Effect.fail(workspaceUnavailable()),
    keepLaunch: () => Effect.fail(workspaceUnavailable()),
  },
  resume: () => Effect.fail(workspaceUnavailable()),
  stop: () => Effect.fail(workspaceUnavailable()),
  discard: () => Effect.fail(workspaceUnavailable()),
  writeFiles: () => Effect.fail(workspaceRefusal()),
  checkOutMissing: () => Effect.fail(workspaceUnavailable()),
  launchRunner: () => Effect.fail(workspaceRefusal()),
  writeLine: () => Effect.fail(workspaceRefusal()),
  wrote: () => Effect.fail(workspaceUnavailable()),
  restoreCheckout: () => Effect.fail(workspaceRefusal()),
  diffCheckout: () => Effect.fail(workspaceRefusal()),
  runnerExit: () => Effect.fail(workspaceUnavailable()),
  kill: () => Effect.fail(workspaceUnavailable()),
  readFile: () => Effect.fail(workspaceUnavailable()),
  checkoutPath: () => Effect.fail(workspaceRefusal()),
  writeFile: () => Effect.fail(workspaceRefusal()),
  phoneVideo: () => Effect.fail(workspaceUnavailable()),
  phoneAudio: () => Effect.fail(workspaceUnavailable()),
};

/** The machine of the kind named: a cloud sandbox, a Mac, or a workspace's pending machine; a cloud sandbox where none is named. */
function machineOf<M>(machine: AgentMachineKind | undefined, cloud: M, mac: M, workspace: M): M {
  switch (machine) {
    case AGENT_MACHINE.DEVICE:
      return mac;
    case AGENT_MACHINE.WORKSPACE:
      return workspace;
    case AGENT_MACHINE.VERCEL:
    case undefined:
      return cloud;
  }
}

/** The lifecycle of whichever machine answers for the session, or for the place or runner named. */
function routedLifecycle(cloud: MachineLifecycle, mac: DeviceMachineService): MachineLifecycle {
  const of = (machine: AgentMachineKind): MachineLifecycle =>
    machineOf<MachineLifecycle>(machine, cloud, mac, pendingWorkspaceMachine);

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
    checkoutPath: (session) => bySession(session, (machine) => machine.checkoutPath(session)),
    writeFile: (session, file) => bySession(session, (machine) => machine.writeFile(session, file)),
    restoreCheckout: (session, snapshot) =>
      bySession(session, (machine) => machine.restoreCheckout(session, snapshot)),
    diffCheckout: (session, range) =>
      bySession(session, (machine) => machine.diffCheckout(session, range)),
    phoneVideo: (session, path) =>
      bySession(session, (machine) => machine.phoneVideo(session, path)),
    phoneAudio: (session, path) =>
      bySession(session, (machine) => machine.phoneAudio(session, path)),
  };
}

/** Both machines behind one, as above. */
function routedMachine(cloud: AgentMachineService, mac: DeviceMachineService): AgentMachineService {
  const of = (machine: AgentMachineKind | undefined): AgentMachineService =>
    machineOf<AgentMachineService>(machine, cloud, mac, pendingWorkspaceMachine);

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
