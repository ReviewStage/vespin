/**
 * namespaced.ts -- `Sandbox` seen through a namespace: every sandbox name, drive name, and tag value its caller names is the namespace's own, so a deployment whose store names another deployment's sandboxes never finds, opens, or changes one of them.
 *
 * A Preview runs on a copy of production's database, which names
 * production's sandboxes by the very names production opens them under, and
 * Vercel keeps both deployments' sandboxes in one project. So a Preview
 * that warms, opens, touches, or writes the firewall of an agent's sandbox
 * reaches the sandbox production's runner is at work in. Through a
 * namespace, the name a caller hands in is prefixed on its way to the
 * provider and the prefix taken off what comes back, so the caller speaks
 * the names it always did. Tag values are prefixed alike, so a list by tag
 * finds only the namespace's sandboxes, and production's lists by tag, made
 * with no namespace, never find a Preview's. A snapshot is named by its id,
 * which no namespace changes: a Preview may create a sandbox of its own
 * from one, which leaves the snapshot as it was.
 */

import { Effect, Predicate } from "effect";
import type { SandboxService } from "./sandbox.js";
import type {
  CreatedSandbox,
  DriveOrigin,
  ListedSandbox,
  SandboxCreate,
  SandboxDrive,
  SandboxSession,
  SandboxTarget,
} from "./vocabulary.js";

/** The names, tags, and drives a namespace turns its caller's words into, and back. */
function namespaceOf(namespace: string) {
  const inner = (name: string) => `${namespace}${name}`;
  const outer = (name: string) => name.slice(namespace.length);
  const holds = (name: string) => name.startsWith(namespace);

  const tags = (each: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(each).map(([key, value]) => [key, inner(value)]));

  const untagged = (each: Readonly<Record<string, string>> | undefined) =>
    each === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(each).map(([key, value]) => [key, holds(value) ? outer(value) : value]),
        );

  const target = (each: SandboxTarget): SandboxTarget =>
    Predicate.isString(each) ? inner(each) : { ...each, name: inner(each.name) };

  const origin = (each: DriveOrigin): DriveOrigin =>
    "base" in each ? { base: inner(each.base) } : { ownedBy: inner(each.ownedBy) };

  const drive = (each: SandboxDrive): SandboxDrive => {
    if ("fill" in each) return { ...each, fill: inner(each.fill) };

    return "fork" in each ? { ...each, fork: origin(each.fork) } : each;
  };

  const ask = (each: SandboxCreate): SandboxCreate => ({
    ...each,
    name: inner(each.name),
    tags: tags(each.tags),
    ...(each.drive === undefined ? undefined : { drive: drive(each.drive) }),
  });

  const listed = <S extends ListedSandbox>(each: S): S => ({
    ...each,
    name: outer(each.name),
    tags: untagged(each.tags),
  });

  const session = (each: SandboxSession): SandboxSession => ({
    ...each,
    sandboxName:
      each.sandboxName !== undefined && holds(each.sandboxName)
        ? outer(each.sandboxName)
        : each.sandboxName,
  });

  return { inner, holds, tags, target, ask, listed, session };
}

/**
 * The sandboxes given, as a deployment under the namespace sees them: every
 * call made under the namespace's own names (`namespaceOf`), and a list by
 * tag answering only the namespace's sandboxes.
 */
export function namespacedSandbox(sandbox: SandboxService, namespace: string): SandboxService {
  const named = namespaceOf(namespace);

  return {
    listTagged: (tag, value) =>
      Effect.map(sandbox.listTagged(tag, named.inner(value)), (listed) =>
        listed.filter((each) => named.holds(each.name)).map(named.listed),
      ),
    sessionsOf: (name) =>
      Effect.map(sandbox.sessionsOf(named.inner(name)), (sessions) => sessions.map(named.session)),
    get: (name) =>
      Effect.map(sandbox.get(named.inner(name)), (found) =>
        found === undefined ? undefined : named.listed(found),
      ),
    driveStands: (name) => sandbox.driveStands(named.inner(name)),
    ownDriveStands: (sandboxName) => sandbox.ownDriveStands(named.inner(sandboxName)),
    resume: (name) => Effect.map(sandbox.resume(named.inner(name)), named.listed),
    create: (ask) => Effect.map(sandbox.create(named.ask(ask)), named.listed),
    getOrCreate: (ask, onCreate) =>
      Effect.map(
        sandbox.getOrCreate(
          named.ask(ask),
          onCreate === undefined
            ? undefined
            : (created: CreatedSandbox) => onCreate(named.listed(created)),
        ),
        named.listed,
      ),
    delete: (name) => sandbox.delete(named.inner(name)),
    deleteDrive: (name) => sandbox.deleteDrive(named.inner(name)),
    stop: (target) => sandbox.stop(named.target(target)),
    updateTags: (name, tags) => sandbox.updateTags(named.inner(name), named.tags(tags)),
    updatePorts: (name, ports) => sandbox.updatePorts(named.inner(name), ports),
    run: (target, ask) => sandbox.run(named.target(target), ask),
    start: (target, ask) => sandbox.start(named.target(target), ask),
    writeStdin: (target, commandId, text) =>
      sandbox.writeStdin(named.target(target), commandId, text),
    commandExit: (target, commandId, within) =>
      sandbox.commandExit(named.target(target), commandId, within),
    commandStderrTail: (target, commandId, secrets) =>
      sandbox.commandStderrTail(named.target(target), commandId, secrets),
    kill: (target, commandId) => sandbox.kill(named.target(target), commandId),
    writeFiles: (target, files) => sandbox.writeFiles(named.target(target), files),
    openInteractive: (target) => sandbox.openInteractive(named.target(target)),
    connectPty: (shell) => sandbox.connectPty(shell),
    updateNetworkPolicy: (target, policy) =>
      sandbox.updateNetworkPolicy(named.target(target), policy),
    snapshot: (target, expiresAfter) => sandbox.snapshot(named.target(target), expiresAfter),
    touch: (name) => sandbox.touch(named.inner(name)),
  };
}
