import { deviceAgentsFolder } from "@repo/features/device-agent-wire";
import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ownedAgents } from "../local-agent-state.js";
import { leaveHostDevice } from "./host-leave.js";

/**
 * host-uninstall.ts -- the host that ships inside the app removed from this Mac, as the app runs it once it has unregistered the host's agent: the box leaves its account, the folders of the agents it made go where asked, and its state goes.
 *
 * The app owns everything else of the bundled host, the bundle, the
 * agent's plist inside it, and its registration with launchd, so nothing
 * here touches them, and there are no releases to remove, since a bundled
 * host updates with the app. The account install's own uninstall
 * (`apps/host/scripts/vespin-host.sh`) takes the same steps in the same
 * order, beside removing its service and releases.
 *
 * The box leaves before its secret goes, so it leaves Settings › Machines
 * too; one the service did not answer is still removed from the Mac, and the
 * outcome says so, for the app to say to remove it there. Only the
 * agents' folders the host made are removed (`owned-agents` in its state),
 * never another install's, and `~/.vespin/clones`, which every install for
 * the account shares, stays. `~/.vespin/agents` and `~/.vespin` go only
 * once nothing else stands in them.
 */

export interface BundledHostUninstallInput {
  /** The host's state (`DARWIN_HOST.stateRoot`), holding its device record and which agents' folders it made. */
  readonly stateRoot: string;
  /** The home the host ran with, under which its agents' folders stand (`deviceAgentsFolder`). */
  readonly home: string;
  /** The host's version, which its call to leave carries. */
  readonly version: string;
  /** Whether the folders of the agents the host made go too, with any work in them that was not pushed. */
  readonly removeAgentFolders: boolean;
}

/** The folder given removed where it stands empty, and left as it is otherwise. */
const removedIfEmpty = (folder: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if ((yield* fileSystem.readDirectory(folder)).length > 0) return;
    yield* fileSystem.remove(folder);
  }).pipe(Effect.ignore);

/** The bundled host removed from its account and from this Mac, as the input asks; how its leave went (`HOST_LEAVE_OUTCOME`). */
export const uninstallBundledHost = Effect.fnUntraced(function* (input: BundledHostUninstallInput) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const left = yield* leaveHostDevice({ stateRoot: input.stateRoot, version: input.version });
  if (input.removeAgentFolders) {
    const agents = deviceAgentsFolder(input.home);
    for (const agentId of yield* ownedAgents(input.stateRoot)) {
      yield* fileSystem.remove(path.join(agents, agentId), { recursive: true, force: true });
    }
    yield* removedIfEmpty(agents);
    yield* removedIfEmpty(path.dirname(agents));
  }
  yield* fileSystem.remove(input.stateRoot, { recursive: true, force: true });
  return left;
});
