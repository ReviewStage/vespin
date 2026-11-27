/**
 * cli-release.ts -- the `vespin` command's release the install script's `cli` mode serves: its version and each tarball's SHA-256, where CI publishes them, and the commands a person installs it with.
 *
 * CI builds the command's bundle once and publishes it to npm as `vespin`,
 * and packs it with the Node it runs on into one tarball per target the host
 * is released for, published to a GitHub release of its own, tagged
 * `cli-v<version>` (`.github/workflows/release-cli.yml`,
 * `apps/cli/scripts/package.ts`), never marked the repository's latest, since
 * the desktop's download link and its updater read that one. The web app
 * writes the release named here into the install script it serves
 * (`packages/service/src/agents/host-install-script-app.ts`), whose `cli`
 * mode checks the tarball it downloads against the digest it carries before
 * anything of it is installed, and `vespin update` runs that same script. A
 * release moves `CLI_RELEASE` whole, its digests read off the release CI
 * published, as `HOST_RELEASE` moves (`./host-release.ts`).
 */

import { HOST_TARGET, type HostTarget } from "./host-release.js";

/** The repository whose releases carry the command's tarballs. */
const RELEASE_REPOSITORY = "ReviewStage/vespin";

/** The npm package the command is published as, unscoped, so `npx vespin` and `npm i -g vespin` reach it. */
const CLI_PACKAGE = "vespin";

/** The install script's mode that installs the command rather than the host, as the script reads its first argument (`apps/web/install/install.sh`). */
export const CLI_INSTALL_MODE = "cli";

/** Where the install script's `cli` mode links the command, as a person's shell expands it. */
export const CLI_LINK_FOLDER = "~/.local/bin";

/** The commands a person is shown to install the command with npm and sign it in, as the command's README spells them. */
export const CLI_COMMAND = {
  NPM_INSTALL: `npm i -g ${CLI_PACKAGE}`,
  LOGIN: `${CLI_PACKAGE} login`,
} as const;

/** A published release of the command: its version, and each of the host's targets' tarball by its SHA-256 in hex. */
export interface CliRelease {
  readonly VERSION: string;
  readonly SHA256: { readonly [target in HostTarget]: string };
}

/**
 * The release the install script installs; none until the first is
 * published, and the script served meanwhile says there is none yet.
 */
export const CLI_RELEASE: CliRelease | undefined = {
  VERSION: "0.5.0",
  SHA256: {
    [HOST_TARGET.LINUX_X64]: "18be4cff4c8d66d24481616450c130a1b3de256813c298ade5c8b15edb46e83a",
    [HOST_TARGET.LINUX_ARM64]: "140059ac944a2b15fbc332ffde3a7a73c2478ebceff36dd150a33aeda7a9865a",
    [HOST_TARGET.DARWIN_ARM64]: "30630021dd35ea790e051ddb721023c8a77043878f15b6ad2c68961269bb0f6f",
  },
};

/** The release's tag, apart from the desktop's `v<version>` and the host's `host-v<version>`. */
function cliReleaseTag(version: string): string {
  return `cli-v${version}`;
}

/** One target's tarball, by its file name, whose one top folder is `vespin`. */
export function cliTarballName(version: string, target: HostTarget): string {
  return `vespin-${version}-${target}.tar.gz`;
}

/** Where the release keeps one target's tarball. */
export function cliTarballUrl(version: string, target: HostTarget): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${cliReleaseTag(version)}/${cliTarballName(version, target)}`;
}
