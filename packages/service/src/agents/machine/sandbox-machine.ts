/**
 * sandbox-machine.ts -- the agent machine over `Sandbox`: a sandbox booted from the agents' image, the runner started in it as a user of the agent's own, and our doors read through it.
 *
 * `open` opens the session's sandbox through `Sandbox`'s `getOrCreate` under a
 * name of the session's own (`../agent-sandbox-open.ts`), as a persistent
 * sandbox is opened: the one standing under it is resumed, and
 * one is created where none stands, or where the one standing can never
 * resume, its snapshot gone. A sandbox the call creates is created from the
 * first of these that stands, and set up in its `onCreate`: from the image
 * with a fork of the drive the sandbox of the agent it was continued
 * or forked from owns, where its Start handed one, its checkout as that
 * agent left it at its last stop; from the agents' image (`../coder-host/agent-image.ts`), which
 * carries the runner and every tool the harnesses run, with a fork of its
 * workspace's drive (`../workspace-drive.ts`), every repository the
 * workspace connects in a folder of its own, the picked repository's folder
 * moved to where the checkout stands, a link left in its place, and fetched
 * up to the agent's branch (`claimAgentCheckout`); or from the image with an
 * empty drive of its own (`AGENT_OWN_DRIVE`), the repository cloned whole
 * onto it (`../coder-host/checkout.ts`), the agent's
 * write token written at the firewall ahead of either, in the run's first
 * write, to stand on past it. A snapshot or a drive found gone at the create
 * is passed by for the next. Nothing is installed on either: the agent
 * installs where it needs to. A sandbox's own drive is `@repo/sandbox`'s to fork and
 * to delete with it; nothing here names one. The `agent` user is made in a
 * sandbox created from the image. Every write the checkout makes is the group's
 * (`../repository-shell.ts`'s `GROUP_WRITES`), so the `agent` user writes
 * it too, and whatever another user installed in it is handed to
 * that user at its launch (`launchRunner`'s readying). A create on an image not yet ready (`ImageNotReady`) is asked again
 * once the registry has had time to prepare the image. The
 * commit identity is left to the launch (`finishCheckout`), which sets it,
 * and the write token again, beside its own steps. Nothing is deleted where the setup or the
 * caller's use fails: the sandbox stands under the session's name, where the
 * next message finds it.
 *
 * `launchRunner` readies the sandbox as root, sharing each checkout with the
 * `agent` user, and then starts the deploy's runner, its whole unit written
 * over the one the sandbox's disk holds, as that user (`Sandbox`'s `start`
 * with a `user`), as a detached command whose stdin stays
 * open. The harness's credential and the placeholder the firewall swaps for
 * the runner's bearer (`../coder-host/runner-sessions.ts`) are in that
 * command's environment, which may stand on the command's own line, so
 * any process in the sandbox may read them there while the runner runs; in
 * a sandbox each is a placeholder the firewall swaps, worth nothing outside
 * it. Neither is ever in its config line, a file, or a tag. Its config line
 * is written to its stdin, which carries nothing more: the runner reads every
 * later line from the service (`../coder-host/runner-sessions.ts`), so this machine
 * writes no line to it.
 *
 * The doors read the sandbox named after the agent's session
 * (`../agent-sandbox-open.ts`'s `agentSandboxOf`), and only the run it is
 * up in: nothing is
 * resumed, since the agent calling the tool runs in that sandbox, so a
 * sandbox not up has nothing to read from. A file is read by a command the
 * sandbox's default user runs. A repository's command is
 * run in the sandbox's run and waited on, its environment named by `env`
 * on the command line rather than by the API, as our other commands are
 * run (`@repo/sandbox`).
 *
 * A place is found again by its session's name, and its runner by the record
 * a launch writes in our store under the agent's runner lease
 * (`@repo/database/models/agent-runner-record`): the command, the sandbox
 * run it runs in, and the launch's first event number and fingerprint.
 * Note that none of it rides in a tag, because a sandbox's tags are labels,
 * each write replacing a sandbox's whole set, so the tags name only the
 * session and its agent, as the sandbox is created. The
 * firewall is the sandbox run's network policy, composed whole at each
 * write from its sources and the swaps its launch keeps
 * (`../sandbox-firewall.ts`), and a stop is the run's, which a snapshot
 * of another agent's sandbox carries none of. A resume of a
 * sandbox under its session's name is the same `getOrCreate`, asking for the
 * agent's own drive (`AGENT_OWN_DRIVE`): one stopped on a drive of its own is
 * never resumed from its snapshot but made anew from the current image with
 * that drive mounted, its checkout, its turns' restore points, and whatever
 * the agent never pushed all on it; one from before drives resumes from its
 * snapshot as it did, and is made anew from the image on an empty drive of
 * its own where that snapshot expired, its checkout cloned again before the
 * relaunch. Either way made anew, it says so, since the installed skills
 * and whatever else stood on the old disk went with it; the harness's own
 * session is kept in our store, not on the disk, and is resumed from there
 * (`../coder-host/runner-sessions.ts`). A legacy
 * sandbox, opened before `getOrCreate` under a UUID, is used where it runs,
 * and otherwise moved to its session's name from its last snapshot
 * (`reopenedOf`), never resumed in place.
 */

import {
  AGENT_USER,
  CODEX_PIN,
  RUNNER_DIRECTORY,
  RUNNER_UNIT,
  SANDBOX_TOOLS_DIRECTORY,
  SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME,
  SHARED_FILES_DIRECTORY,
} from "@repo/agent-runner/pins";
import { LAUNCH_PATH, type LaunchPath } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentRunnerRecord,
  forgetAgentRunnerRecord,
  readAgentRunnerRecord,
  writeAgentRunnerRecord,
} from "@repo/database/models/agent-runner-record";
import { type Agent, hasRepository, type WithRepository } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { sandboxVcpus } from "@repo/features/sandbox-size";
import {
  CLOUD_SETUP_SCRIPT,
  type CloudSetupScript,
} from "@repo/features/workspace-sandbox-setup-wire";
import {
  type ListedSandbox,
  type OpenedSandbox,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxDrive,
  type SandboxRunning,
  type SandboxService,
  SandboxUnavailable,
  UP_STATUSES,
} from "@repo/sandbox";
import {
  Brand,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  Redacted,
  Result,
  Tracer,
} from "effect";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AGENT_OWN_DRIVE,
  type AgentSnapshotSource,
  agentSandboxName,
  agentSandboxOf,
  agentSandboxTags,
  agentTag,
  legacySandboxOf,
  openAgentSandbox,
  reopenedOf,
  SANDBOX_ENV,
} from "../agent-sandbox-open.js";
import { AgentImage } from "../coder-host/agent-image.js";
import { CODER } from "../coder-host/bounds.js";
import {
  type AgentRepositoryRead,
  agentCheckoutPlan,
  agentRepositoryRead,
  CheckoutRefused,
  claimAgentCheckout,
  cloneAgentRepository,
  finishCheckoutWith,
  openWorkingFolder,
  repositoryCredentialOf,
  writeAgentCredential,
} from "../coder-host/checkout.js";
import { diffCheckout, restoreCheckout } from "../coder-host/checkout-restore.js";
import { NATIVE_SKILLS_PATH } from "../coder-host/native-skills.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import {
  GROUP_WRITES,
  REPOSITORY_REFUSAL,
  type RepositoryFirewall,
  type RepositorySandbox,
  runInSandbox,
} from "../repository-shell.js";
import {
  type FirewallEntry,
  type FirewallSession,
  type FirewallSources,
  type LaunchSwapKind,
  newPlaceholder,
  placeholderSwap,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import { SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";
import {
  recordedSandboxBooted,
  recordedSandboxBootFailed,
  recordedSandboxBooting,
  recordedSandboxDiscarded,
  recordedSandboxOpen,
} from "../sandbox-use.js";
import { scriptRanIn } from "../script-runs.js";
import {
  DRIVE_BROKEN,
  DRIVE_STATE,
  readOf,
  reportedBroken,
  WORKSPACE_DRIVE,
  workspaceDriveName,
  workspaceFolderOf,
} from "../workspace-drive.js";
import {
  AgentMachine,
  type AgentMachineService,
  ATTACHMENT_FILE_MODE,
  type DeliveredCredentials,
  type FoundPlace,
  type MachineKept,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  type MachineRunning,
  type RecordedRunner,
  RUNNER_RECORD,
  type RunnerCredential,
  type RunnerHandle,
  type RunnerMark,
  type RunnerRecord,
  type SandboxSetup,
} from "./agent-machine.js";
import { phoneVideoAsk, phoneVideoOf } from "./phone-video.js";

/** Our state folder on the agent's own drive, beside the checkout, which a sandbox made again mounts as it stood. */
const DRIVE_STATE_FOLDER = `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${SANDBOX_STATE_FOLDER}`;

/**
 * Where a message's files that the harness takes no block of are written
 * in its sandbox, one folder per message line: outside the checkout, so no
 * commit picks them up, on the agent's own drive, so a file from an earlier
 * message is still there after a resume, and readable by `agent`, since the
 * API writes them as its default user with the mode the caller names.
 */
const ATTACHMENT_DIRECTORY = `${DRIVE_STATE_FOLDER}/attachments`;

/** Where the files an agent saves in the shared folder (`SHARED_FILES_DIRECTORY`) stand: on its own drive, the shared folder a link to it. */
const DRIVE_SHARED_FILES = `${DRIVE_STATE_FOLDER}/shared`;

/**
 * The shared folder linked to its folder on the agent's own drive on each
 * launch, root's, so a file saved in one session can still be posted after
 * a resume, which makes the sandbox again with nothing of its old disk. The
 * state folder is made the workspace's owner's where it is missing, as the
 * checkout's record would make it, and a shared folder the old disk still
 * holds as a folder, as one resumed from a snapshot from before the link,
 * is moved onto the drive first.
 */
const LINK_SHARED_FILES = [
  `if [ ! -d ${DRIVE_STATE_FOLDER} ]; then install -d -o "$(stat -c %u ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE})" -g "$(stat -c %g ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE})" -m 0775 ${DRIVE_STATE_FOLDER}; fi`,
  `install -d -o ${AGENT_USER} -g ${AGENT_USER} -m 0755 ${DRIVE_SHARED_FILES}`,
  `if [ ! -L ${SHARED_FILES_DIRECTORY} ]; then if [ -d ${SHARED_FILES_DIRECTORY} ]; then cp -a ${SHARED_FILES_DIRECTORY}/. ${DRIVE_SHARED_FILES}/ && rm -rf ${SHARED_FILES_DIRECTORY}; fi; ln -s ${DRIVE_SHARED_FILES} ${SHARED_FILES_DIRECTORY}; fi`,
];

/** Where a sandbox keeps an agent's things: the same for every agent, since each has a sandbox of its own. */
const SANDBOX_LAYOUT: MachineLayout = {
  checkoutPath: CODER.CHECKOUT_PATH,
  installedSkills: NATIVE_SKILLS_PATH.INSTALLED,
  skillsUpload: NATIVE_SKILLS_PATH.UPLOAD,
  attachments: ATTACHMENT_DIRECTORY,
  sharedFiles: SHARED_FILES_DIRECTORY,
  claudeExecutable: undefined,
  codexExecutable: CODEX_PIN.LINK,
  codexHome: CODEX_PIN.HOME,
  linesRead: true,
  transcriptsKept: true,
  diskSessions: false,
  permissionModes: true,
};

/** The runner's bundle as the image carries it (`apps/web/agent-image/Dockerfile`), which each launch overwrites with the deploy's unit. */
const RUNNER_SCRIPT = `${RUNNER_DIRECTORY}/${RUNNER_UNIT.BUNDLE}`;

/** Where a launch uploads the deploy's runner unit as the sandbox's default user, which its readying copies over `RUNNER_DIRECTORY`. */
const RUNNER_UPLOAD = "/tmp/agent-runner";

/** The uploaded unit's mode; the copy its readying makes is root's and read-only. */
const RUNNER_UPLOAD_MODE = 0o644;

/** Each file of the runner's unit where a launch uploads it. */
const RUNNER_UPLOADS = Object.values(RUNNER_UNIT).map((name) => `${RUNNER_UPLOAD}/${name}`);

/**
 * The link a sandbox made before the product's rename is given on each
 * launch, root's, from our tools' directory to the one its image put them
 * in, so the runner and the Claude Code binary are found where the
 * pins name them. Note that it can go only once no sandbox made before the
 * rename is listed (named `luke-agent-` and a UUID), because a sandbox in
 * steady use resumes from its own snapshot for as long as it lives.
 */
const LINK_TOOLS_DIRECTORY = `if [ -d ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ] && [ ! -e ${SANDBOX_TOOLS_DIRECTORY} ] && [ ! -L ${SANDBOX_TOOLS_DIRECTORY} ]; then ln -s ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ${SANDBOX_TOOLS_DIRECTORY}; fi`;

/**
 * The `agent` user put in the `docker` group on each launch, root's, so the
 * harness and every command it runs reach the daemon the image's `docker`
 * starts (`apps/web/agent-image/Dockerfile`). Note that it is asked only
 * where the group stands, because a sandbox resumed from a snapshot of an
 * image before Docker has none, and only where the user is not already in
 * it, since the runner started after it takes the user's groups as it starts.
 */
const JOIN_DOCKER_GROUP = `if getent group docker > /dev/null && ! id -nG ${AGENT_USER} | grep -qw docker; then usermod -aG docker ${AGENT_USER}; fi`;

/** Where pnpm keeps its store for a checkout on the workspace's drive, where an install that ran as the default user put it: the drive's root, the first folder up from the checkout it may write on that drive. */
const DRIVE_PNPM_STORE = `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/.pnpm-store`;

/**
 * The workspace's drive's root opened to the store's group on each launch,
 * root's, where pnpm's store stands at it, so `agent`, in the default user's
 * group, may write there, and its pnpm picks that store as that install's did.
 * Note that this is because pnpm keeps its store at the topmost folder of
 * the checkout's drive its user may write, and a fork of a drive mounts
 * with a root only root writes, so `agent`'s pnpm chose a store under the
 * checkout and, finding the one its `node_modules` names elsewhere, asked to
 * purge it.
 */
const OPEN_DRIVE_STORE = `if [ -d ${DRIVE_PNPM_STORE} ]; then chgrp --reference=${DRIVE_PNPM_STORE} ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}; chmod g+w ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}; fi`;

/**
 * The dependencies another user installed in the agent's checkout handed to
 * `agent` on each launch, root's: a setup script's, or an install made
 * before drives held none, both the default user's. Note
 * that this is because an install chmods what it installed on every run
 * (pnpm a package's bins, a `prepare` script the hooks it copies), which
 * only a file's owner may, so `agent`'s own install failed on them. The
 * checkout's files but its `.git` and pnpm's store on the drive, whose files
 * `node_modules` links, are made `agent`'s, their group and its writes left
 * as they stand, so the default user still writes them. It is asked only
 * where the checkout's `node_modules` is not `agent`'s, so a launch after
 * the one that handed it walks nothing.
 */
const HAND_INSTALL_TO_AGENT = `if [ -d ${CODER.CHECKOUT_PATH}/node_modules ] && [ "$(stat -c %U ${CODER.CHECKOUT_PATH}/node_modules)" != ${AGENT_USER} ]; then find ${CODER.CHECKOUT_PATH} -mindepth 1 -maxdepth 1 ! -name .git -exec chown -R ${AGENT_USER} {} +; if [ -d ${DRIVE_PNPM_STORE} ]; then chown -R ${AGENT_USER} ${DRIVE_PNPM_STORE}; fi; fi`;

/**
 * The agent's checkout marked safe for git in the sandbox and its repository
 * shared with `agent`'s group, as the launch marks it. Note that nothing of the checkout's
 * files is changed, because every write the checkout makes is already the
 * group's (`../repository-shell.ts`'s `GROUP_WRITES`); the repository's
 * sharing is set here for a checkout cloned before its clone set it.
 */
function sharedCheckout(path: string): readonly string[] {
  return [
    `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${path} || git config --system --add safe.directory ${path}`,
    `if [ -d ${path}/.git ] && ! git -C ${path} config --get core.sharedRepository | grep -Fxq group; then git -C ${path} config core.sharedRepository group; fi`,
  ];
}

/** What a place holds where it holds the agent's own checkout: its repository's git folder. */
const CHECKOUT_GIT_PATH = `${CODER.CHECKOUT_PATH}/.git`;

/** Where a finished checkout's commit identity stands (`finishCheckoutWith`): its repository's own config, read as a file so no ownership check stands in the way. */
const CHECKOUT_CONFIG_PATH = `${CHECKOUT_GIT_PATH}/config`;

/** Why a checkout cloned before a relaunch was not finished: the store did not answer for its commit identity. */
const RESTORE_PLAN_UNREAD = "the restored checkout's commit identity could not be read";

/**
 * The mark a launch's readying leaves on the sandbox's own disk, which a
 * sandbox made again starts without: one that stands up without it was made
 * by a caller that launches nothing (the Terminal, the agent's browser, a
 * preview's wake), so the next launch sets it up as one it made itself.
 */
const READIED_MARK = "/var/lib/vespin/readied";

/**
 * The launch's readying, run by bash as root through `sudo`, waited on before the runner starts:
 * `agent` put in the `docker` group, the deploy's runner unit the launch
 * uploaded copied whole over the one the sandbox's disk holds, root's and
 * read-only as the image makes it, so a sandbox created from a snapshot
 * or resumed on an older runner runs the deploy's bundle beside the files it
 * loads, all from one build, and the upload removed (copied rather than
 * moved, so an upload a readying cut short leaves stays the default user's,
 * which the next launch overwrites); the member's installed skills, where
 * the sandbox's opening uploaded them,
 * moved where only root writes and every user reads (`native-skills.ts`),
 * the agent's checkout marked safe for git and shared with `agent`'s group,
 * the drive's pnpm store opened to `agent` (`OPEN_DRIVE_STORE`) and what
 * another user installed in its checkout handed to it where it is not
 * `agent`'s already (`HAND_INSTALL_TO_AGENT`), so its own install runs there,
 * and the folder an agent saves what the service reads back in made
 * `agent`'s on its own drive and readable by the default user the service
 * reads as, the shared folder a link to it (`LINK_SHARED_FILES`), and the
 * disk marked readied (`READIED_MARK`). Note that the checkout's git config is written
 * only where it does not already say so, because a `config.lock` an agent's
 * git left behind when its runner was killed would otherwise fail every
 * relaunch after it.
 */
function readyScript(): string {
  return [
    "set -euo pipefail",
    LINK_TOOLS_DIRECTORY,
    JOIN_DOCKER_GROUP,
    `install -o root -g root -m 0444 -t ${RUNNER_DIRECTORY} ${RUNNER_UPLOADS.join(" ")}`,
    `rm -rf ${RUNNER_UPLOAD}`,
    `if [ -d ${NATIVE_SKILLS_PATH.UPLOAD} ]; then rm -rf ${NATIVE_SKILLS_PATH.INSTALLED} && mkdir -p $(dirname ${NATIVE_SKILLS_PATH.INSTALLED}) && mv ${NATIVE_SKILLS_PATH.UPLOAD} ${NATIVE_SKILLS_PATH.INSTALLED} && chown -R root:root ${NATIVE_SKILLS_PATH.INSTALLED} && chmod -R u=rwX,go=rX ${NATIVE_SKILLS_PATH.INSTALLED}; fi`,
    ...sharedCheckout(CODER.CHECKOUT_PATH),
    OPEN_DRIVE_STORE,
    HAND_INSTALL_TO_AGENT,
    ...LINK_SHARED_FILES,
    `install -d -m 0755 $(dirname ${READIED_MARK}) && : > ${READIED_MARK}`,
  ].join("\n");
}

/** The word the setup run marks each `<script> <exit>` line of its stderr with, so nothing else it printed there reads as one. */
const SETUP_EXIT_MARK = "vespin-setup-exit";

/** Where a created sandbox's setup writes the workspace's cloud setup scripts, as its default user, for the setup run to read. */
const SETUP_FILE = {
  INSTALL: "/tmp/vespin-setup/install.sh",
  REPOSITORY: "/tmp/vespin-setup/setup.sh",
} as const;

/** The mark the repository's setup script leaves on the agent's own drive once it succeeded, so it runs once for the checkout there, a resume and a fork of the drive carrying it. */
const SETUP_RAN_MARK = `${DRIVE_STATE_FOLDER}/setup-ran`;

/**
 * The workspace's cloud setup scripts run in a sandbox just created, after
 * its checkout, by bash as its default user, as a detached command nothing
 * waits on, once per sandbox: its setup
 * script once a workspace is created and checked out: the install script as
 * root from the workspace folder, on every boot, since what it installs
 * stands outside the drive, then, where it succeeded and the drive holds no
 * mark of an earlier run (`SETUP_RAN_MARK`), the repository's setup script
 * from the checkout, its writes the group's as the clone's are
 * (`GROUP_WRITES`), each failing on its first failed command, the mark left
 * once it succeeded. What they print,
 * and how they exited (`--- exit N`, once they finish), goes to `SETUP_LOG`,
 * which every user reads, the agent among them; the run's own stderr says
 * only which ran and how each exited, a `<script> <exit>` line apiece
 * after `SETUP_EXIT_MARK` (`setupExits`), which is all the service keeps of it.
 */
const SETUP_RUN_SCRIPT = [
  GROUP_WRITES,
  `: > ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG}`,
  "status=0",
  `if [ -f ${SETUP_FILE.INSTALL} ]; then echo "--- install script" >> ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG}; (cd ${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE} && sudo -n bash -e -o pipefail ${SETUP_FILE.INSTALL}) >> ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG} 2>&1 || status=$?; echo "${SETUP_EXIT_MARK} ${CLOUD_SETUP_SCRIPT.INSTALL} $status" >&2; fi`,
  `if [ "$status" -eq 0 ] && [ -f ${SETUP_FILE.REPOSITORY} ] && [ ! -e ${SETUP_RAN_MARK} ]; then echo "--- setup script" >> ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG}; bash -e -o pipefail ${SETUP_FILE.REPOSITORY} >> ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG} 2>&1 || status=$?; echo "${SETUP_EXIT_MARK} ${CLOUD_SETUP_SCRIPT.SETUP} $status" >&2; if [ "$status" -eq 0 ]; then mkdir -p ${DRIVE_STATE_FOLDER} && : > ${SETUP_RAN_MARK}; fi; fi`,
  `echo "--- exit $status" >> ${REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG}`,
  'exit "$status"',
].join("\n");

/**
 * How long past the answer a detached setup run is waited on for how its
 * scripts exited, well inside the platform's default five-minute function
 * lifetime, since the open itself spends some of it first.
 */
const SETUP_RECORD_WAIT = Duration.minutes(3);

/** What the setup run's stderr says how one of its scripts exited by, after its mark; read wherever it stands, since the stderr's tail comes back on one line. */
const SETUP_EXIT_LINE = new RegExp(
  `${SETUP_EXIT_MARK} (${CLOUD_SETUP_SCRIPT.INSTALL}|${CLOUD_SETUP_SCRIPT.SETUP}) (\\d+)\\b`,
  "gu",
);

/** Which of the setup run's scripts ran and how each exited, as its stderr says; a line it does not say so in is passed by. */
function setupExits(
  stderr: string,
): readonly { readonly script: CloudSetupScript; readonly exitCode: number }[] {
  return [...stderr.matchAll(SETUP_EXIT_LINE)].flatMap(([, script, exit]) =>
    script === CLOUD_SETUP_SCRIPT.INSTALL || script === CLOUD_SETUP_SCRIPT.SETUP
      ? [{ script, exitCode: Number(exit) }]
      : [],
  );
}

/** Why the sandbox could not be readied for the agent's runner. */
const NOT_READIED = "the sandbox could not be readied for the agent's runner";

/** How the read exits where the path is no regular file the sandbox's user may read. */
const READ_EXIT = { NO_FILE: 3 } as const;

/**
 * The read, run by bash: the file named as `$1`, at most `$2` bytes of it,
 * printed in base64 on one line, since a command's output reaches the service as
 * text. A path that is no regular file the sandbox's user may read exits
 * apart, before anything is printed.
 */
const READ_SCRIPT = [
  "set -o pipefail",
  `[ -f "$1" ] && [ -r "$1" ] || exit ${READ_EXIT.NO_FILE}`,
  `head -c "$2" -- "$1" | base64 | tr -d '\\n'`,
].join("\n");

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`repository-shell.ts`). */
export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** What the machine is made with: the edge's runner the checkout runs through. */
export interface SandboxMachineOptions {
  readonly run: SandboxRunner;
}

const runningOfSession = Brand.nominal<MachineRunning>();
const nameOfSandbox = Brand.nominal<MachineName>();

/** The place a sandbox's run stands for, under our session given. */
function sandboxPlace(session: string, name: string, sandboxSessionId: string): MachinePlace {
  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    name: nameOfSandbox(name),
    running: runningOfSession(sandboxSessionId),
  };
}

/**
 * What a created sandbox was created from, which says how its checkout is
 * made: a fork of the drive of the agent it was started from, a fork of its
 * workspace's drive, or the image alone. A sandbox reopened from its own
 * snapshot (`reopenedOf`) counts as the first, its checkout on that snapshot.
 */
const CREATED_FROM = { SOURCE: "source", WORKSPACE: "workspace", IMAGE: "image" } as const;

type CreatedFrom = (typeof CREATED_FROM)[keyof typeof CREATED_FROM];

/** The launch's path for a sandbox created from each. */
const LAUNCH_PATH_OF = {
  [CREATED_FROM.SOURCE]: LAUNCH_PATH.SOURCE_SNAPSHOT,
  [CREATED_FROM.WORKSPACE]: LAUNCH_PATH.WORKSPACE_DRIVE,
  [CREATED_FROM.IMAGE]: LAUNCH_PATH.IMAGE,
} as const satisfies Record<CreatedFrom, LaunchPath>;

/** One way the agent's sandbox may be created: what from, the snapshot where it is one, and the drive it forks where it forks one. */
interface CreateAttempt {
  readonly from: CreatedFrom;
  readonly snapshot: AgentSnapshotSource | undefined;
  readonly drive: SandboxDrive | undefined;
}

/** The image with the agent's own drive, which every open falls back to and every resume takes: the drive it stood on mounted again, else one made empty. */
const FROM_IMAGE: CreateAttempt = {
  from: CREATED_FROM.IMAGE,
  snapshot: undefined,
  drive: AGENT_OWN_DRIVE,
};

/** Whether a create failed because the snapshot or the drive it named is gone, expired, deleted, or never filled, so the next way is tried. */
function snapshotUnusable(failure: { readonly _tag: string }): boolean {
  return Predicate.isTagged(failure, "SnapshotGone") || Predicate.isTagged(failure, "SandboxGone");
}

/** What an agent with a repository is checked out from as its sandbox is created: the agent, and the reads the open made of its repositories, its own on its write token. */
interface AgentCheckoutReads {
  readonly agent: WithRepository<Agent>;
  readonly read: AgentRepositoryRead;
  /** The workspace's cloud setup scripts as the launch reads them beside the open, which the sandbox runs after its checkout. */
  readonly setup: Effect.Effect<SandboxSetup | undefined>;
}

/** The run a place stands for as its firewall names it, with the account whose agent it is. */
export function firewallSessionOf(place: SandboxRunning, userId: string): FirewallSession {
  return { userId, name: place.name, sandboxSessionId: place.running };
}

/**
 * A launch's credentials as a sandbox's runner takes them: each a
 * placeholder minted for the launch in its variable, and a swap its
 * firewall keeps for the launch, which sets the value in the placeholder's
 * place on requests to its target that present it, so no value enters the
 * sandbox. Note that the swap matches the placeholder and not the target
 * alone, because every process in the sandbox reaches out through that
 * firewall, a Terminal's shell and a page in the agent's browser among them,
 * and only one that reads the placeholder, the runner's own user, may act
 * as the agent. A renewed credential is held the same way, and the sweep
 * renews its swap.
 */
function heldAtFirewall(credentials: readonly RunnerCredential[]): DeliveredCredentials {
  const env: Record<string, string> = {};
  const swaps = new Map<LaunchSwapKind, FirewallEntry>();

  for (const credential of credentials) {
    const placeholder = Redacted.value(newPlaceholder());
    env[credential.variable] = placeholder;
    swaps.set(
      credential.slot,
      placeholderSwap({
        ...credential.target,
        header: credential.header,
        placeholder: Redacted.make(`${credential.scheme}${placeholder}`),
        value: Redacted.make(`${credential.scheme}${Redacted.value(credential.value)}`),
      }),
    );
  }

  return { env, swaps };
}

/** The launch a record tells of: its first event number and fingerprint, of a launch that reads its lines, as every sandbox's does. */
function markOf(record: AgentRunnerRecord): RunnerMark {
  return {
    firstSequence: record.firstSequence,
    ...(record.fingerprint !== null && { fingerprint: record.fingerprint }),
    ...(record.permissionMode !== null && { permissionMode: record.permissionMode }),
    linesRead: true,
  };
}

/** The record a place keeps for the runner record given, under the sandbox named; none for one that tells of no launch. */
function storedRecord(
  name: string,
  agentId: string,
  record: RunnerRecord,
): AgentRunnerRecord | undefined {
  if (record.kind === RUNNER_RECORD.NONE) return undefined;
  const mark = record.kind === RUNNER_RECORD.LAUNCHED ? record.mark : record.runner.mark;
  const runner = record.kind === RUNNER_RECORD.RUNNING ? record.runner.handle : undefined;

  return {
    agentId,
    sandboxName: name,
    firstSequence: mark.firstSequence,
    fingerprint: mark.fingerprint ?? null,
    permissionMode: mark.permissionMode ?? null,
    sandboxSessionId: runner?.running ?? null,
    commandId: runner?.command ?? null,
  };
}

/** The place's record of its runner written in our store under the account given, or deleted where it tells of no launch. */
function recordedIn(
  place: {
    readonly session: string;
    readonly name: string;
    readonly userId: string;
    readonly agentId: string;
  },
  record: RunnerRecord,
) {
  const stored = storedRecord(place.name, place.agentId, record);

  return stored === undefined
    ? forgetAgentRunnerRecord(place.userId, place.session, place.name)
    : writeAgentRunnerRecord(place.userId, place.session, stored);
}

/** The runner a record names, where the sandbox is up in the session that runner was started in, whether or not it has exited since. */
function runnerInSession(
  session: string,
  sandbox: ListedSandbox,
  record: AgentRunnerRecord,
): RecordedRunner | undefined {
  const { sandboxSessionId, commandId } = record;

  if (
    sandboxSessionId === null ||
    commandId === null ||
    sandbox.status !== SANDBOX_STATUS.RUNNING ||
    sandbox.running !== sandboxSessionId
  ) {
    return undefined;
  }

  return {
    handle: { ...sandboxPlace(session, sandbox.name, sandboxSessionId), command: commandId },
    mark: markOf(record),
  };
}

/** What a place this machine found keeps for its own later calls: the account its record is kept under, and the sandbox as it was read. */
interface KeptPlace {
  readonly userId: string;
  readonly sandbox: ListedSandbox;
}

/** A listed sandbox as the place a later call finds, under the account's session given, with the session's record where it was written for this sandbox. */
function foundOf(
  userId: string,
  session: string,
  sandbox: ListedSandbox,
  record: Option.Option<AgentRunnerRecord>,
): FoundPlace {
  const own = Option.getOrUndefined(
    Option.filter(record, (each) => each.sandboxName === sandbox.name),
  );

  const running =
    sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.running !== undefined
      ? sandboxPlace(session, sandbox.name, sandbox.running)
      : undefined;

  const kept: KeptPlace = { userId, sandbox };

  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    agentId: agentTag(sandbox.tags),
    name: nameOfSandbox(sandbox.name),
    running,
    runner: own === undefined ? undefined : runnerInSession(session, sandbox, own),
    launch: own === undefined ? undefined : markOf(own),
    // SAFETY: what is kept is this machine's own to read back in `discard` and `resume`; no caller reads it.
    kept: kept as KeptPlace & MachineKept,
  };
}

/** What a found place keeps, which `foundOf` kept. */
function keptOf(found: FoundPlace): KeptPlace {
  // SAFETY: a place this machine found keeps what `foundOf` kept.
  return found.kept as MachineKept & KeptPlace;
}

/**
 * A launch whose stdin was refused, said in the log by how its command
 * ended: its exit code where the sandbox has one, and the tail of its stderr,
 * every token-shaped run redacted (`commandStderrTail`), since a runner that
 * dies before it reads its config says why there alone. Every value the
 * launch handed it in its environment is redacted too, whatever its shape,
 * so neither its credential nor its bearer can reach the log.
 */
const diedAtStart = (
  api: SandboxService,
  place: SandboxRunning,
  commandId: string,
  secrets: readonly string[],
) =>
  Effect.gen(function* () {
    const exit = yield* api
      .commandExit(place, commandId)
      .pipe(Effect.orElseSucceed(() => undefined));

    const stderr = yield* api
      .commandStderrTail(place, commandId, secrets)
      .pipe(Effect.orElseSucceed(() => undefined));

    yield* Effect.logWarning(
      `A runner's launch took no stdin: exit ${exit === null || exit === undefined ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`,
    );
  });

/**
 * The effect handed to the edge's runner under the span given, so what it
 * runs stays in the caller's trace. Note that the runner runs it as a root
 * of its own, with none of the caller's context, so without the span every
 * span it opens would start a trace of its own.
 */
function runUnder<A, E>(
  run: SandboxRunner,
  parent: Option.Option<Tracer.AnySpan>,
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return run(
    Option.match(parent, {
      onNone: () => effect,
      onSome: (span) => Effect.withParentSpan(effect, span),
    }),
  );
}

/** The services a context holds without the span it was read under, so an effect handed them goes on under its own caller's span. */
function servicesOf(context: Context.Context<DatabaseServices>): Context.Context<DatabaseServices> {
  return Context.omit(Tracer.ParentSpan)(context);
}

/** The sandbox run's firewall as the checkout reaches it, bound to the run and its account and to what stands beside the checkout's own, over the store the machine was made on; `carries` names the repository whose credential stands there already. */
export function repositoryFirewallOver(
  api: SandboxService,
  context: Context.Context<DatabaseServices>,
  session: FirewallSession,
  beside: FirewallSources,
  carries?: string,
): RepositoryFirewall {
  const firewall = sandboxFirewall(api);

  return {
    write: (sources) =>
      Effect.provideContext(
        firewall.write(session, { ...beside, ...sources }),
        servicesOf(context),
      ),
    ...(carries === undefined ? undefined : { carries }),
  };
}

/** The sandbox run as the checkout reaches it, each command fenced to it, through the edge's runner, its firewall the account's given. */
export function repositorySandboxOver(
  api: SandboxService,
  place: SandboxRunning,
  run: SandboxRunner,
  firewall: RepositoryFirewall,
): RepositorySandbox {
  return {
    run: (ask, parent) =>
      runUnder(
        run,
        Option.fromNullishOr(parent),
        Effect.map(
          api.run(place, {
            command: "bash",
            args: ["-c", ask.command],
            ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
            ...(ask.env === undefined ? undefined : { env: ask.env }),
          }),
          (ran) => ({ exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }),
        ),
      ),
    firewall,
  };
}

/** The read as one command: bash, the path and bound as its positional arguments. */
function readFileCommand(path: string, maxBytes: number) {
  return {
    command: "bash",
    args: ["-c", READ_SCRIPT, "read-file", path, String(maxBytes)],
  };
}

/**
 * What the machine does to a place it already opened, over the API given:
 * everything but opening one and launching a runner in it, so a caller with
 * no edge's runner to hand the checkout, as a launch's end, still reaches it.
 */
export function sandboxLifecycle(api: SandboxService): MachineLifecycle {
  const firewall = sandboxFirewall(api);

  /** The run of the session's sandbox; unavailable where it is not up. */
  const runningSession = (sessionId: string) =>
    Effect.gen(function* () {
      const up = yield* agentSandboxOf(api, sessionId);

      if (up === undefined || !UP_STATUSES.has(up.status) || up.running === undefined) {
        return yield* new SandboxUnavailable({});
      }

      return { name: up.name, running: up.running } satisfies SandboxRunning;
    });

  return {
    findPlace: (userId, session) =>
      Effect.map(
        Effect.all([agentSandboxOf(api, session), readAgentRunnerRecord(userId, session)], {
          concurrency: "unbounded",
        }),
        ([sandbox, record]) =>
          Option.map(Option.fromNullishOr(sandbox), (found) =>
            foundOf(userId, session, found, record),
          ),
      ),

    recordRunner: recordedIn,

    firewall: {
      write: (place, userId, sources) => firewall.write(firewallSessionOf(place, userId), sources),
      keepLaunch: (place, userId, launch) =>
        firewall.keepLaunch(firewallSessionOf(place, userId), launch),
    },

    stop: (place) => api.stop(place),

    // MIGRATION: a legacy sandbox the session moved off is deleted first, so a discard that fails
    // between the two never leaves its old disk to be moved again.
    discard: (found) =>
      Effect.gen(function* () {
        const legacy = yield* legacySandboxOf(api, found.session);

        if (legacy !== undefined && legacy.name !== found.name) yield* api.delete(legacy.name);
        yield* api.delete(found.name);
        yield* recordedSandboxDiscarded(found.name);
        yield* forgetAgentRunnerRecord(keptOf(found).userId, found.session, found.name);
      }),

    writeFiles: (place, files) => api.writeFiles(place, files),

    // Note that a sandbox's runner reads every line past its config from us, so a line written
    // here is a caller's mistake, refused loudly rather than written where nothing reads it.
    writeLine: () => Effect.die(new Error("a sandbox's runner reads its lines from the service")),

    wrote: () => Effect.succeed(false),

    runnerExit: (handle, within) => api.commandExit(handle, handle.command, within),

    kill: (handle) => api.kill(handle, handle.command),

    readFile: (session, path, bound) =>
      Effect.flatMap(runningSession(session), (running) =>
        Effect.map(api.run(running, readFileCommand(path, bound + 1)), (ran) =>
          ran.exitCode === 0 ? new Uint8Array(Buffer.from(ran.stdout, "base64")) : undefined,
        ),
      ),

    // Note that the API writes as the sandbox's default user, so the file's mode is what lets `agent` read it.
    writeFile: (session, file) =>
      Effect.gen(function* () {
        const running = yield* runningSession(session);
        const path = `${ATTACHMENT_DIRECTORY}/${file.name}`;
        yield* api.writeFiles(running, [
          { path, contents: file.contents, mode: ATTACHMENT_FILE_MODE },
        ]);

        return path;
      }),

    restoreCheckout: (session, snapshot) => restoreCheckout(api, { sessionId: session, snapshot }),

    diffCheckout: (session, range) => diffCheckout(api, { sessionId: session, range }),

    phoneVideo: (session, path) =>
      Effect.flatMap(runningSession(session), (running) =>
        Effect.map(api.run(running, phoneVideoAsk(path)), phoneVideoOf),
      ),
  };
}

/** The machine over the API given, its checkout run through the edge's runner. */
export function sandboxMachine(api: SandboxService, run: SandboxRunner): AgentMachineService {
  /** The sandbox run as the checkout reaches it, its firewall the account's given, with what stands beside the checkout's own and the repository whose credential stands there already, its launch read from the store given. */
  const checkoutOver = (
    context: Context.Context<DatabaseServices>,
    sandbox: SandboxRunning,
    userId: string,
    beside: FirewallSources = {},
    carries?: string,
  ) =>
    repositorySandboxOver(
      api,
      sandbox,
      run,
      repositoryFirewallOver(api, context, firewallSessionOf(sandbox, userId), beside, carries),
    );

  /** The same, its launch read from the caller's store. */
  const checkoutIn = (sandbox: SandboxRunning, userId: string) =>
    Effect.map(Effect.context<DatabaseServices>(), (context) =>
      checkoutOver(context, sandbox, userId),
    );

  /** The sandbox as it runs: its name, and the run it is up in. */
  const runningOf = (opened: OpenedSandbox) => ({
    name: opened.name,
    running: opened.running,
  });

  /**
   * The agent's checkout in the sandbox just created, as it was created:
   * on a fork of the source agent's drive it stands as that agent left it,
   * and is cloned only where that fork holds none; on a fork of the workspace's
   * drive the repository's folder there is claimed and brought up to the
   * agent's branch, or cloned where the fork holds none (`claimAgentCheckout`);
   * from the image the repository is cloned whole onto its own drive.
   */
  const checkedOutAs = (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
    from: CreatedFrom,
  ) =>
    Effect.gen(function* () {
      if (from === CREATED_FROM.IMAGE) return yield* cloneAgentRepository(agent, sandbox, read);

      if (from === CREATED_FROM.WORKSPACE) {
        return yield* claimAgentCheckout(agent, sandbox, read, workspaceFolderOf(read.fullName));
      }

      const holds = yield* runInSandbox(
        sandbox,
        { command: `test -d ${CHECKOUT_GIT_PATH}` },
        REPOSITORY_REFUSAL.CHECKOUT_FAILED,
      ).pipe(
        Effect.mapError(
          (failure) => new CheckoutRefused({ reason: failure.reason, detail: failure.detail }),
        ),
        Effect.withSpan("web/checkoutHeld"),
      );

      if (holds.exitCode !== 0) yield* cloneAgentRepository(agent, sandbox, read);
    });

  /**
   * How the detached setup run's scripts exited, recorded as their last runs
   * past the answer (`afterResponse`): the run is waited on for at most
   * `SETUP_RECORD_WAIT`, inside the function's own lifetime, and its stderr
   * read for the `<script> <exit>` lines it wrote. A run still going at the
   * bound, or gone, records nothing, and nothing fails: the record is a
   * courtesy no launch waits on. Nothing where no answer stands to wait past.
   */
  const recordedSetup = (
    context: Context.Context<DatabaseServices>,
    later: Option.Option<AfterResponse["Service"]>,
    agent: Agent,
    opened: SandboxRunning,
    commandId: string,
    ranAt: Date,
    setup: SandboxSetup,
  ) =>
    Effect.gen(function* () {
      if (Option.isNone(later)) return;
      yield* afterResponse(
        "A cloud setup's run record",
        Effect.gen(function* () {
          const exit = yield* api.commandExit(opened, commandId, SETUP_RECORD_WAIT);

          if (!Predicate.isNumber(exit)) {
            return yield* Effect.logDebug("A cloud setup outlived its record's wait");
          }

          const stderr = yield* api.commandStderrTail(
            opened,
            commandId,
            Object.values(setup.environment),
          );

          yield* Effect.forEach(setupExits(stderr ?? ""), ({ script, exitCode }) =>
            scriptRanIn(agent, script, exitCode, ranAt).pipe(Effect.provide(context)),
          );
        }).pipe(
          Effect.catch((failure) =>
            Effect.logDebug(`A cloud setup's run was not read: ${failure._tag}`),
          ),
        ),
      ).pipe(Effect.provideService(AfterResponse, later.value));
    });

  /**
   * The workspace's cloud setup scripts run in the sandbox just created
   * (`SETUP_RUN_SCRIPT`), each written to its file first so no script is
   * spliced into shell text, the setup script with the workspace's variables;
   * nothing where none is saved. They are started detached, as the runner
   * is, and never waited on, so the runner launches at once and the first
   * turn opens beside them, however long they take; the agent reads how they
   * went in their log. How each script exited is recorded as its last run,
   * for Settings › Cloud setup (`../script-runs.ts`), by a wait past the
   * answer (`recordedSetup`) that a run outliving it leaves unrecorded. A
   * setup that could not be started is logged and leaves the launch to go on.
   */
  const setUp = (
    context: Context.Context<DatabaseServices>,
    later: Option.Option<AfterResponse["Service"]>,
    agent: Agent,
    opened: SandboxRunning,
    setup: SandboxSetup | undefined,
  ) =>
    Effect.gen(function* () {
      if (setup === undefined) return;
      const ranAt = yield* DateTime.nowAsDate;
      const encoder = new TextEncoder();

      const files = [
        { path: SETUP_FILE.INSTALL, script: setup.install },
        { path: SETUP_FILE.REPOSITORY, script: setup.repository },
      ].flatMap(({ path, script }) =>
        script === undefined ? [] : [{ path, contents: encoder.encode(script), mode: 0o644 }],
      );

      yield* api.writeFiles(opened, files);

      // Note that the scripts run as the sandbox's default user, as the clone's commands do.
      const commandId = yield* api.start(opened, {
        command: "bash",
        args: ["-c", SETUP_RUN_SCRIPT],
        cwd: CODER.CHECKOUT_PATH,
        env: setup.environment,
        sudo: false,
      });

      yield* recordedSetup(context, later, agent, opened, commandId, ranAt, setup);
    }).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(`A sandbox's cloud setup did not start: ${failure._tag}`),
      ),
      Effect.withSpan("web/sandboxSetup"),
    );

  /** The workspace's cloud setup scripts run in a sandbox made again outside an open's `onCreate` (`setUp`), over the caller's store; nothing where none was handed. */
  const setUpAgain = (
    agent: Agent,
    opened: SandboxRunning,
    setup: Effect.Effect<SandboxSetup | undefined> | undefined,
  ) =>
    Effect.gen(function* () {
      if (setup === undefined) return;
      const context = yield* Effect.context<DatabaseServices>();
      const later = yield* Effect.serviceOption(AfterResponse);
      yield* setUp(context, later, agent, opened, yield* setup);
    });

  /**
   * A sandbox `getOrCreate` created set up for a launch, in its `onCreate`
   * beside the `agent` user it makes (`../agent-sandbox-open.ts`): the
   * agent's repository checked out as it was created (`checkedOutAs`), on
   * the read the caller made of it, which confirmed its workspace still
   * reaches it before any sandbox opens on its code. The agent's write
   * token, the one its start minted and its read was made on, is the run's
   * first write, and stands on past the checkout, which reaches GitHub
   * through it with no write of its own.
   */
  const checkedOutIn = (
    context: Context.Context<DatabaseServices>,
    later: Option.Option<AfterResponse["Service"]>,
    checkout: AgentCheckoutReads,
    from: CreatedFrom,
    opened: SandboxRunning,
  ) =>
    Effect.gen(function* () {
      const userId = checkout.agent.userId;
      const github = repositoryCredentialOf(checkout.read);
      const sandbox = checkoutOver(context, opened, userId, { github }, github.fullName);
      yield* writeAgentCredential(sandbox, github);
      yield* checkedOutAs(checkout.agent, sandbox, checkout.read, from);
      yield* setUp(context, later, checkout.agent, opened, yield* checkout.setup);
    });

  /**
   * The session's sandbox opened through `getOrCreate`
   * (`../agent-sandbox-open.ts`) at the size the agent's repository asks
   * for, created as the attempt says where none stands, with whether it was
   * created, its checkout made in its `onCreate` where the agent has a
   * repository and the sandbox was created (`checkedOutIn`), and the open
   * recorded as its use (`../sandbox-use.ts`), on a fresh disk where it was
   * created on any drive but its own as it stood.
   * A setup that fails fails the open, and what it made is
   * left as it stands. Note that the setup's own failure is the open's,
   * because `onCreate`'s rejection is handed on as the call's, which
   * would read as the sandbox's rather than in the checkout's words.
   */
  const gotOn = (
    agent: Agent,
    sessionId: string,
    attempt: CreateAttempt,
    checkout: AgentCheckoutReads | undefined,
  ) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<DatabaseServices>();
      const parent = yield* Effect.serviceOption(Tracer.ParentSpan);
      // Note that the create's own setup runs on the edge's runner, so what waits past the answer is handed to it from here.
      const later = yield* Effect.serviceOption(AfterResponse);
      let refused: CheckoutRefused | undefined;

      const { sandbox, created, driveKept } = yield* openAgentSandbox(
        {
          sessionId,
          tags: agentSandboxTags(sessionId, agent.id),
          vcpus: sandboxVcpus(agent.repository),
          ...(attempt.snapshot === undefined ? undefined : { snapshot: attempt.snapshot }),
          ...(attempt.drive === undefined ? undefined : { drive: attempt.drive }),
        },
        checkout === undefined
          ? undefined
          : (opened) =>
              runUnder(
                run,
                parent,
                checkedOutIn(context, later, checkout, attempt.from, runningOf(opened)).pipe(
                  Effect.tapError((failure) =>
                    Effect.sync(() => {
                      refused = failure;
                    }),
                  ),
                ),
              ),
      ).pipe(
        Effect.provideService(Sandbox, api),
        Effect.mapError((failure) => refused ?? failure),
      );

      yield* recordedSandboxOpen(agent.id, agentSandboxName(sessionId), created && !driveKept);

      return { ...runningOf(sandbox), created, driveKept, from: attempt.from };
    });

  /**
   * The agent's sandbox opened from the first attempt whose snapshot and
   * drive stand (`gotOn`), each one found gone at the create logged and
   * passed by, as the open ended.
   */
  const openedFromFirst = (
    agent: Agent,
    sessionId: string,
    attempts: readonly CreateAttempt[],
    checkout: AgentCheckoutReads | undefined,
  ) =>
    Effect.gen(function* () {
      for (const attempt of attempts) {
        const opened = yield* Effect.result(gotOn(agent, sessionId, attempt, checkout));

        // Note that a sandbox standing under the name failed after its create, in its setup, so the
        // next attempt would resume it with nothing checked out; only a create refused is passed by,
        // and never the image's, whose own drive is made where none stands.
        const gone =
          Result.isFailure(opened) &&
          attempt.from !== CREATED_FROM.IMAGE &&
          snapshotUnusable(opened.failure) &&
          (yield* api.get(agentSandboxName(sessionId)).pipe(
            Effect.map((standing) => standing === undefined),
            Effect.orElseSucceed(() => false),
          ));

        if (!gone) return opened;
        yield* Effect.logWarning(
          `An agent's sandbox was not created from its ${attempt.from}${attempt.drive === undefined ? "" : " with a forked drive"}, which was gone`,
        );

        // A workspace's drive gone is broken until someone fills it, since nothing refills it on a timer.
        if (attempt.from === CREATED_FROM.WORKSPACE && checkout !== undefined) {
          yield* reportedBroken(checkout.read.workspaceId, DRIVE_BROKEN.GONE);
        }
      }

      // The image is always the last attempt, and is never passed by.
      return yield* Effect.die(new Error("an agent's sandbox was opened from nothing"));
    });

  /**
   * The agent's sandbox opened through `getOrCreate` (`gotOn`), its
   * repository checked out where it has one and the sandbox was created:
   * from the image with a fork of the drive its source's sandbox owns where
   * a Start handed one (`../coder-host/takeover.ts`), else from the image
   * with a fork of its workspace's drive where no fill holds it, else from
   * the image with an empty drive of its own, each drive found gone at the
   * create passed by for the next. The repository is read on the write token
   * its start minted (`read`). Nothing fills the workspace's drive here:
   * its fills keep it (`../workspace-drive.ts`), and a start that finds none
   * clones.
   */
  const openedCheckout = (
    target: ConversationTarget,
    agent: Agent,
    sessionId: string,
    repositoryRead: Effect.Effect<AgentRepositoryRead | undefined, CheckoutRefused>,
    setup: Effect.Effect<SandboxSetup | undefined>,
  ) =>
    Effect.gen(function* () {
      const read = yield* repositoryRead;
      const source = agent.startedFrom?.sandbox;

      const checkout =
        hasRepository(agent) && read !== undefined ? { agent, read, setup } : undefined;

      // A drive the sandboxes could not be asked about, or one a fill holds, is passed by.
      const drive =
        checkout === undefined ? undefined : workspaceDriveName(checkout.read.workspaceId);

      const driveRead =
        drive === undefined
          ? Option.none()
          : yield* Effect.option(Effect.map(api.get(drive), readOf));

      const driveReady = Option.exists(driveRead, (each) => each.state === DRIVE_STATE.READY);

      // A fill's sandbox left past its grace means a fill failed or was cut off, which nothing retries.
      if (
        checkout !== undefined &&
        Option.exists(driveRead, (each) => each.state === DRIVE_STATE.WANTED)
      ) {
        yield* reportedBroken(checkout.read.workspaceId, DRIVE_BROKEN.UNFINISHED);
      }

      const attempts: readonly CreateAttempt[] = [
        ...(source === undefined
          ? []
          : [
              {
                from: CREATED_FROM.SOURCE,
                snapshot: undefined,
                drive: { fork: { ownedBy: source }, at: WORKSPACE_DRIVE.MOUNT },
              },
            ]),
        ...(drive === undefined || !driveReady
          ? []
          : [
              {
                from: CREATED_FROM.WORKSPACE,
                snapshot: undefined,
                drive: { fork: { base: drive }, at: WORKSPACE_DRIVE.MOUNT },
              },
            ]),
        FROM_IMAGE,
      ];

      const opened = yield* openedFromFirst(agent, sessionId, attempts, checkout);

      if (Result.isFailure(opened)) return yield* Effect.fail(opened.failure);

      return opened.success;
    });

  /**
   * The agent's own checkout made whole in a place about to be relaunched:
   * cloned where the place holds none, and finished as an opening finishes
   * it (`finishCheckoutWith`) where it holds no commit identity, as after a
   * restore whose finish failed; nothing where it holds a finished one. Note
   * that a place can stand without one, because a launch whose checkout
   * failed leaves its sandbox for the next message, which resumes it and
   * checks nothing out, and a sandbox made anew in place of one whose
   * snapshot lapsed holds none, so its runner would start in a folder that is
   * not there. Answers whether it cloned.
   */
  const ownCheckoutRestored = (
    place: SandboxRunning,
    target: ConversationTarget,
    agent: WithRepository<Agent>,
  ) =>
    Effect.gen(function* () {
      const finished = yield* api.run(place, {
        command: "git",
        args: ["config", "--file", CHECKOUT_CONFIG_PATH, "--get", "user.email"],
      });

      if (finished.exitCode === 0) return false;
      const holds = yield* api.run(place, { command: "test", args: ["-d", CHECKOUT_GIT_PATH] });
      const read = yield* agentRepositoryRead(target, agent);
      const sandbox = yield* checkoutIn(place, agent.userId);

      // The commit identity is read on the one token minted while the clone runs on it.
      const [, plan] = yield* Effect.all(
        [
          holds.exitCode === 0 ? Effect.void : cloneAgentRepository(agent, sandbox, read),
          agentCheckoutPlan(target, agent, repositoryCredentialOf(read)).pipe(
            Effect.mapError((failure) =>
              failure instanceof CheckoutRefused
                ? failure
                : new CheckoutRefused({ reason: RESTORE_PLAN_UNREAD }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      yield* finishCheckoutWith(sandbox, plan);
      yield* Effect.logWarning(
        holds.exitCode === 0
          ? "A relaunch found its agent's checkout unfinished and finished it"
          : "A relaunch found no checkout of its agent's repository and cloned it",
      );

      return holds.exitCode !== 0;
    });

  return {
    ...sandboxLifecycle(api),

    layout: () => Effect.succeed(SANDBOX_LAYOUT),

    deliverCredentials: (_agent, credentials) => heldAtFirewall(credentials),

    // The agent's write token is minted as the open begins, once for the whole start
    // (`ask.repositoryToken`), and the checkout waits on it alone; the commit identity the
    // checkout's finish sets (`agentCheckoutPlan`) is read on it beside the sandbox's opening and
    // the caller's own reads, and kept as it ended, so a read that failed fails the launch only
    // once the sandbox stands, and never cuts its opening short. Note that a use that fails leaves
    // the sandbox standing under the session's name, where the next message finds it.
    // The sandbox is recorded booting before it opens, and its boot ended where the open or its use failed.
    open: (ask, use) =>
      Effect.gen(function* () {
        yield* recordedSandboxBooting(ask.agent.id, agentSandboxName(ask.session));
        const agent = ask.agent;

        const identifying = yield* Effect.forkChild(
          Effect.exit(
            hasRepository(agent)
              ? Effect.flatMap(ask.repositoryToken, (read) =>
                  read === undefined
                    ? Effect.die(new Error("an agent with a repository read none"))
                    : agentCheckoutPlan(ask.target, agent, repositoryCredentialOf(read)),
                )
              : Effect.succeed(undefined),
          ),
        );

        const [{ name, running, created, from }, [plan, beside]] = yield* Effect.all(
          [
            openedCheckout(
              ask.target,
              agent,
              ask.session,
              ask.repositoryToken,
              ask.setup ?? Effect.succeed(undefined),
            ),
            Effect.all([Fiber.join(identifying), ask.beside], { concurrency: "unbounded" }),
          ],
          { concurrency: "unbounded" },
        );

        const repositorySandbox = yield* checkoutIn({ name, running }, ask.agent.userId);

        const finishCheckout = Effect.flatMap(plan, (read) =>
          read === undefined
            ? openWorkingFolder(repositorySandbox)
            : finishCheckoutWith(repositorySandbox, read),
        );

        return yield* use(
          {
            place: sandboxPlace(ask.session, name, running),
            name: nameOfSandbox(name),
            checkoutPath: SANDBOX_LAYOUT.checkoutPath,
            finishCheckout,
            path: created ? LAUNCH_PATH_OF[from] : LAUNCH_PATH.RESUMED,
          },
          beside,
        );
      }).pipe(Effect.tapError(() => recordedSandboxBootFailed(agentSandboxName(ask.session)))),

    // The session's sandbox is run again through `getOrCreate` (`gotOn`) from the image with its own
    // drive (`FROM_IMAGE`): one up is used as it runs; one stopped on a drive of its own is made
    // again from the current image with that drive mounted, its checkout and unpushed work on it;
    // one from before drives resumes from its snapshot, or where that is gone is made again on an
    // empty drive of its own. A sandbox made again is set up with nothing to check out, since the
    // relaunch clones the checkout it finds missing (`ownCheckoutRestored`) and sets it up then; one
    // made again on the checkout its drive kept is set up here (`setUpAgain`).
    // MIGRATION: a legacy sandbox (`agentSandboxOf`) is used where it runs, and otherwise made anew
    // under the session's name from its last snapshot (`reopenedOf`), its disk kept, or from the
    // image where that snapshot is gone, so it is never resumed in place; it is read again on each
    // try, so one that was still stopping is seen stopped.
    resume: (found, agent, setup) =>
      Effect.gen(function* () {
        const legacy = found.name !== agentSandboxName(found.session);

        if (legacy && found.running !== undefined) return { place: found.running, created: false };
        // Note that the boot is recorded under the session's own name, which a legacy sandbox is reopened under and the task list reads.
        yield* recordedSandboxBooting(agent.id, agentSandboxName(found.session));

        const standing = legacy
          ? ((yield* api.get(found.name)) ?? keptOf(found).sandbox)
          : keptOf(found).sandbox;

        const { snapshot } = yield* reopenedOf(found.session, standing);

        const attempts: readonly CreateAttempt[] =
          snapshot === undefined
            ? [FROM_IMAGE]
            : [{ from: CREATED_FROM.SOURCE, snapshot, drive: undefined }, FROM_IMAGE];

        const opened = yield* openedFromFirst(agent, found.session, attempts, undefined);

        if (Result.isFailure(opened)) return yield* opened.failure;
        const { name, running, created, driveKept, from } = opened.success;

        // A sandbox up that no launch readied was made again by a caller that launches nothing, so it
        // is set up as one made here, its installed skills written again (`READIED_MARK`).
        const remade =
          !created &&
          (yield* api.run({ name, running }, { command: "test", args: ["-e", READIED_MARK] }))
            .exitCode !== 0;

        // A sandbox made again on the checkout its drive kept is set up now; one on an empty drive, once its checkout is cloned (`checkOutMissing`).
        if ((created && driveKept) || remade) yield* setUpAgain(agent, { name, running }, setup);

        return {
          place: sandboxPlace(found.session, name, running),
          created: (created && from === CREATED_FROM.IMAGE) || remade,
        };
      }).pipe(Effect.tapError(() => recordedSandboxBootFailed(agentSandboxName(found.session)))),

    // The runner's unit is uploaded beside the caller's steps, and the sandbox is readied as root
    // once the steps its start waits on are done (`started`), since the readying shares the
    // checkout they finish and installs the skills they upload; the runner is then started as
    // `agent`, beside the caller's other steps (`ready`), which only its config line waits on, as a
    // runner reads nothing before that line. Note that the steps are let finish while the runner
    // starts, so one that failed ends a runner that started rather than leaving it to wait out
    // its config. The runner is recorded in our store before it reads anything, so a later call
    // finds it. A runner started but never configured is ended, and the caller undoes what it
    // recorded of it, so the next message relaunches whole rather than writing to a runner that
    // waits for its config.
    // Before a relaunch, the agent's own checkout is cloned where the place holds none (`ownCheckoutRestored`), and the
    // workspace's cloud setup run after that clone, as a create runs it after its own.
    checkOutMissing: (place, target, agent, setup) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;

        if (yield* ownCheckoutRestored(place, target, agent)) {
          yield* setUpAgain(agent, place, setup);
        }
      }),

    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const uploaded = Effect.gen(function* () {
          const runner = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.runner);
          yield* api.writeFiles(
            place,
            runner.map((file) => ({
              path: `${RUNNER_UPLOAD}/${file.name}`,
              contents: file.contents,
              mode: RUNNER_UPLOAD_MODE,
            })),
          );
        }).pipe(Effect.withSpan("web/uploadRunner"));

        const started = Effect.gen(function* () {
          yield* Effect.all([launch.started ?? Effect.void, uploaded], {
            concurrency: "unbounded",
            discard: true,
          });

          const readied = yield* api
            .run(place, {
              command: "sudo",
              args: ["-n", "bash", "-c", readyScript()],
            })
            .pipe(Effect.withSpan("web/readyRunnerSandbox"));

          if (readied.exitCode !== 0) return yield* new SandboxUnavailable({ detail: NOT_READIED });

          // Note that the runner starts on the sandbox by its name, as the user, as it always has.
          return yield* api
            .start(launch.name, {
              user: AGENT_USER,
              command: "node",
              args: [RUNNER_SCRIPT],
              cwd: CODER.CHECKOUT_PATH,
              env: {
                ...SANDBOX_ENV,
                HOME: `/home/${AGENT_USER}`,
                USER: AGENT_USER,
                LOGNAME: AGENT_USER,
                ...launch.env,
              },
            })
            .pipe(Effect.withSpan("web/startRunner"));
        });

        const [readyExit, commandId] = yield* Effect.all([Effect.exit(launch.ready), started], {
          concurrency: "unbounded",
        });

        if (Exit.isFailure(readyExit)) {
          yield* Effect.ignore(api.kill(place, commandId));

          return yield* Effect.failCause(readyExit.cause);
        }

        const ready = readyExit.value;
        const handle: RunnerHandle = { ...place, command: commandId };
        yield* Effect.gen(function* () {
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          yield* recordedIn(
            {
              session: place.session,
              name: launch.name,
              userId: launch.userId,
              agentId: launch.agentId,
            },
            { kind: RUNNER_RECORD.RUNNING, runner: { handle, mark } },
          );
          yield* api
            .writeStdin(place, commandId, lines)
            .pipe(
              Effect.tapError(() => diedAtStart(api, place, commandId, Object.values(launch.env))),
            );
          yield* recordedSandboxBooted(launch.name);
        }).pipe(
          Effect.withSpan("web/handRunnerFirstLines"),
          Effect.tapError(() =>
            Effect.ignore(Effect.andThen(api.kill(place, commandId), launch.abandon(ready))),
          ),
        );

        return { handle, ready };
      }).pipe(Effect.tapError(() => recordedSandboxBootFailed(launch.name))),
  };
}

/** The machine over the runtime's `Sandbox`, its checkout run through the edge's runner. */
export function sandboxMachineLayer(
  options: SandboxMachineOptions,
): Layer.Layer<AgentMachine, never, Sandbox> {
  return Layer.effect(
    AgentMachine,
    Effect.map(Sandbox, (api) => sandboxMachine(api, options.run)),
  );
}
