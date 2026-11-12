import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Exit, Path } from "effect";
import * as FileSystem from "effect/FileSystem";

/**
 * app-host-command.ts -- the `vespin-host` command once the app runs This Mac's host: the account install's link to it moved to the app's launcher, and the commands the app's own copy refuses.
 *
 * The account install links `~/.local/bin/vespin-host` to its own release
 * (`apps/web/install/install.sh`'s `LINK`). Once the app has registered
 * the host it carries, that link is moved to the launcher inside the app
 * (`Contents/MacOS/vespin-host`), so the command a member types runs the
 * host that runs. Only a link that stands nowhere, or one into the account
 * install's releases, is moved: a file, or a link to anything else, is the
 * member's own and stays. Nothing else is touched, the account install's
 * releases, its plist, its state, and its agents' folders among them.
 *
 * Run from inside the app, the host program answers `run` and `version`
 * alone (`appRefusesCommand`), since every other command would change the
 * host behind the app, which owns its registration and its record.
 */

/** Where the command stands under the home, and where the account install keeps the releases its link names (`vespin-host.sh`'s `ACCOUNT_RELEASES`). */
const COMMAND_LINK = [".local", "bin", "vespin-host"] as const;
const ACCOUNT_RELEASES = [".local", "share", "vespin-host"] as const;

/** The host program's folder inside an app bundle (`BUNDLED_HOST.libPath`'s parent), by the real path it runs from. */
const APP_HOST_FOLDER = /\.app\/Contents\/Resources\/host\/?$/u;

/** The commands the host program answers from inside the app: the one its LaunchAgent runs, and two that read and change nothing. */
const APP_COMMANDS: ReadonlySet<string | undefined> = new Set(["run", "version", "status"]);

/** What became of the command's link: moved to the launcher, already naming it, or left as the member's own. */
export const COMMAND_LINK_OUTCOME = {
  LINKED: "linked",
  ALREADY: "already",
  LEFT: "left",
} as const;

export type CommandLinkOutcome = (typeof COMMAND_LINK_OUTCOME)[keyof typeof COMMAND_LINK_OUTCOME];

/** The line a refused command prints. */
export const APP_RUNS_HOST_WORDS = `This Mac's host is run by the ${PRODUCT_NAME} app. Manage it in ${PRODUCT_NAME} › Settings › Machines.`;

/** Whether the host program, from the real path of its folder given, refuses the command given, since the app runs it: anything but `run` and `version` from inside an app bundle. */
export function appRefusesCommand(hostFolder: string, command: string | undefined): boolean {
  return APP_HOST_FOLDER.test(hostFolder) && !APP_COMMANDS.has(command);
}

/** Whether the target given, as the link reads it, stands in the account install's releases. */
function intoAccountReleases(path: Path.Path, home: string, link: string, target: string): boolean {
  const releases = path.join(home, ...ACCOUNT_RELEASES);
  const resolved = path.resolve(path.dirname(link), target);

  return resolved.startsWith(`${releases}${path.sep}`);
}

/**
 * `~/.local/bin/vespin-host` linked to the app's launcher given, where
 * nothing stands there or it links into the account install's releases; a
 * file or a link to anything else is left. Note that the new link is made
 * beside the old and renamed over it, so the command never stands missing.
 */
export const appHostCommandLinked = Effect.fnUntraced(function* (input: {
  /** The member's home. */
  readonly home: string;
  /** The launcher inside the app (`Contents/MacOS/vespin-host`), by its absolute path. */
  readonly launcher: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const link = path.join(input.home, ...COMMAND_LINK);
  const target = yield* Effect.exit(fileSystem.readLink(link));

  if (Exit.isSuccess(target)) {
    if (target.value === input.launcher) return COMMAND_LINK_OUTCOME.ALREADY;

    if (!intoAccountReleases(path, input.home, link, target.value)) {
      return COMMAND_LINK_OUTCOME.LEFT;
    }
  } else if (yield* fileSystem.exists(link)) {
    return COMMAND_LINK_OUTCOME.LEFT;
  }

  yield* fileSystem.makeDirectory(path.dirname(link), { recursive: true });
  const beside = `${link}.app-link`;
  yield* fileSystem.remove(beside, { force: true });
  yield* fileSystem.symlink(input.launcher, beside);
  yield* fileSystem.rename(beside, link);

  return COMMAND_LINK_OUTCOME.LINKED;
});
