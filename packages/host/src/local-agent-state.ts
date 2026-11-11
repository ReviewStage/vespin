import { Clock, Effect, Option, Path, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { folderMoves } from "./folder-moves.js";

/**
 * local-agent-state.ts -- what a machine keeps of its local agents between runs: which agents' folders it made (`owned-agents` in its state), kept and read by the follower (`compose-local-agents.ts`), and the process group each running runner leads (`runner-groups`), which the next daemon's start ends where its runner outlived the daemon that started it (`daemon/host-runners-left.ts`).
 */

/**
 * The folder in the machine's state holding an empty file for each agent
 * whose folder this machine made, named for the agent, from its first
 * launch or files, until a discard removes its folder. The folder stands in
 * the user's own `~/.vespin/agents`, so `vespin-host uninstall` reads this to
 * remove its own and no other's (`apps/host/scripts/vespin-host.sh`), and the
 * follower to let go of its own turns alone as the gate opens (`ownedAgents`).
 */
const OWNED_FOLDER = "owned-agents";

/**
 * The folder in the machine's state holding a record for each runner the
 * follower runs, named for its agent, from its spawn until its process group
 * has been ended: the group it leads and when it started. A daemon killed
 * outright leaves its records standing, so the next one's start can end the
 * groups that outlived it (`daemon/host-runners-left.ts`).
 */
const RUNNER_GROUPS_FOLDER = "runner-groups";

/** A runner's record: the process group it leads, which is its own pid, and when it started, in milliseconds since the epoch. */
const runnerGroupSchema = Schema.Struct({
  group: Schema.Int.check(Schema.isGreaterThan(1)),
  startedAt: Schema.Number,
});

/** A runner's process group as its record keeps it. */
export type RunnerGroup = typeof runnerGroupSchema.Type;

const runnerGroupJson = Schema.fromJsonString(runnerGroupSchema);
const decodeRunnerGroup = Schema.decodeUnknownOption(runnerGroupJson);
const encodeRunnerGroup = Schema.encodeEffect(runnerGroupJson);

/** The agent given kept as one whose folder this machine made; a write that fails is let go, since the record only serves an uninstall. */
export const keepOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const owned = path.join(stateRoot, OWNED_FOLDER);
    yield* fileSystem.makeDirectory(owned, { recursive: true, mode: 0o700 });
    yield* fileSystem.writeFileString(path.join(owned, agentId), "");
  }).pipe(Effect.ignore);

/** A pulse each time the agents kept as ones whose folder this machine made may have moved, from the moment their folder stands. */
export const ownedAgentsMoves = (stateRoot: string) =>
  Stream.unwrap(Effect.map(Path.Path, (path) => folderMoves(path.join(stateRoot, OWNED_FOLDER))));

/** The agents kept as ones whose folder this machine made, by id; none where the record cannot be read. */
export const ownedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem.readDirectory(path.join(stateRoot, OWNED_FOLDER));
  }).pipe(Effect.orElseSucceed((): readonly string[] => []));

/** No agent kept as one whose folder this machine made, so an uninstall after it leaves every agent's folder as it stands. */
export const forgetOwnedAgents = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER), { recursive: true, force: true });
  });

/** The agent given no longer kept as one whose folder this machine made, once its folder is gone. */
export const forgetOwnedAgent = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, OWNED_FOLDER, agentId), { force: true });
  }).pipe(Effect.ignore);

/** The process group the agent's runner leads kept, with when it started; a write that fails is let go, since the record only serves the next daemon's start. */
export const keepRunnerGroup = (stateRoot: string, agentId: string, group: number) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const startedAt = yield* Clock.currentTimeMillis;
    const folder = path.join(stateRoot, RUNNER_GROUPS_FOLDER);
    yield* fileSystem.makeDirectory(folder, { recursive: true, mode: 0o700 });
    const text = yield* encodeRunnerGroup({ group, startedAt });
    // Note that the record is written beside its name and moved onto it, so a daemon killed mid-write never leaves a part of one.
    const written = path.join(folder, `.${agentId}.written`);
    yield* fileSystem.writeFileString(written, text);
    yield* fileSystem.rename(written, path.join(folder, agentId));
  }).pipe(Effect.ignore);

/** The agent's runner no longer kept, once its process group has been ended. */
export const forgetRunnerGroup = (stateRoot: string, agentId: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, RUNNER_GROUPS_FOLDER, agentId), {
      force: true,
    });
  }).pipe(Effect.ignore);

/** Every runner's process group kept, a record that cannot be read left out; none where the folder cannot be read. */
export const keptRunnerGroups = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(stateRoot, RUNNER_GROUPS_FOLDER);
    const agents = yield* fileSystem.readDirectory(folder);
    const kept: RunnerGroup[] = [];
    for (const agentId of agents) {
      const text = yield* Effect.option(fileSystem.readFileString(path.join(folder, agentId)));
      const read = Option.flatMap(text, decodeRunnerGroup);
      if (Option.isSome(read)) kept.push(read.value);
    }
    return kept;
  }).pipe(Effect.orElseSucceed((): readonly RunnerGroup[] => []));

/** No runner's process group kept, once every group the records named has been ended. */
export const forgetRunnerGroups = (stateRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.remove(path.join(stateRoot, RUNNER_GROUPS_FOLDER), {
      recursive: true,
      force: true,
    });
  }).pipe(Effect.ignore);
