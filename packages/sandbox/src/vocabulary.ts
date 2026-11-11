/**
 * vocabulary.ts -- what a caller of a sandbox speaks in, whichever provider runs it: a sandbox's statuses, the calls made and the failures they answer, and the shapes of a sandbox, its run, its commands, its files, and its network policy.
 *
 * Nothing here names who asks or who answers: a sandbox is named, tagged,
 * and opened from the image or snapshot its caller hands, with the drive it
 * asks for, what a name or a tag means is the caller's, and how a provider
 * spells any of it is its adapter's (`vercel/`).
 */

import { Data, type Redacted } from "effect";

/** Where a sandbox stands: on its way up, up, on its way down, or down with its disk kept for a resume. */
export const SANDBOX_STATUS = {
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
} as const;

export type SandboxStatus = (typeof SANDBOX_STATUS)[keyof typeof SANDBOX_STATUS];

/** The statuses a sandbox is up in, or on its way up. */
export const UP_STATUSES: ReadonlySet<SandboxStatus | undefined> = new Set([
  SANDBOX_STATUS.STARTING,
  SANDBOX_STATUS.RUNNING,
]);

/** What a read of a command's exit answers for a command, or its run, the provider no longer knows. */
export const COMMAND_GONE = "gone";

/** A command's exit code, null while it runs, or gone (`COMMAND_GONE`). */
export type CommandExit = number | null | typeof COMMAND_GONE;

/** Which of the calls was made, as a failure names it. */
export const SANDBOX_CALL = {
  CREATE: "create",
  GET_OR_CREATE: "get-or-create",
  FS_WRITE: "fs/write",
  CMD: "cmd",
  STDIN: "stdin",
  LOGS: "logs",
  KILL: "kill",
  TAGS: "tags",
  GET: "get",
  DRIVE: "drive",
  LIST: "list",
  DELETE: "delete",
  STOP: "stop",
  RUN: "run",
  TOUCH: "touch",
  NETWORK_POLICY: "network-policy",
  INTERACTIVE: "interactive",
  SNAPSHOT: "snapshot",
  PORTS: "ports",
} as const;

export type SandboxCall = (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL];

/** What a failure names of the call: the sandbox's call it was, where it was one. */
function asked(call: SandboxCall | undefined): string {
  return call === undefined ? "the sandbox" : `the sandbox's ${call}`;
}

/**
 * The provider could not be asked, or did not confirm what was asked: the
 * call that failed, whether it said it was busy or at fault, so the same
 * call may be taken again later, and what went wrong in a line. None of it
 * is anything we sent.
 */
export class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly call?: SandboxCall;
  readonly retryable?: boolean;
  readonly detail?: string;
}> {
  override get message(): string {
    const answer = `${asked(this.call)} was unavailable`;
    return this.detail === undefined ? answer : `${answer}: ${this.detail}`;
  }
}

/** What the call named is gone: the sandbox, or the run of it the call was fenced to, or a command in it. */
export class SandboxGone extends Data.TaggedError("SandboxGone")<{
  readonly call?: SandboxCall;
}> {
  override get message(): string {
    return `${asked(this.call)} found what it named gone`;
  }
}

/**
 * The snapshot a sandbox resumes or opens from is gone: expired past the
 * expiry it was kept for, or deleted. No retry mends it, the sandbox's saved
 * files lost with it.
 */
export class SnapshotGone extends Data.TaggedError("SnapshotGone")<{
  readonly call?: SandboxCall;
}> {
  override get message(): string {
    return `${asked(this.call)} found the snapshot it opens from gone`;
  }
}

/** The run the call was made on is stopping, or being snapshotted, under it: what a resume of its sandbox mends. */
export class SandboxEnding extends Data.TaggedError("SandboxEnding")<{
  readonly call?: SandboxCall;
}> {
  override get message(): string {
    return `${asked(this.call)} met the sandbox stopping`;
  }
}

/** The image a create names is not yet ready to open sandboxes from, which asking again once it is mends. */
export class ImageNotReady extends Data.TaggedError("ImageNotReady")<{
  readonly call?: SandboxCall;
}> {
  override get message(): string {
    return `${asked(this.call)} met an image not yet ready`;
  }
}

/** A create's name is held by another sandbox already, which is what makes a name a lock. */
export class SandboxNameTaken extends Data.TaggedError("SandboxNameTaken")<{
  readonly call?: SandboxCall;
}> {
  override get message(): string {
    return `${asked(this.call)} found the name taken`;
  }
}

/** Every failure a call of a sandbox answers. */
export type SandboxError =
  | SandboxUnavailable
  | SandboxGone
  | SnapshotGone
  | SandboxEnding
  | ImageNotReady
  | SandboxNameTaken;

const SANDBOX_ERROR_TAGS: ReadonlySet<string> = new Set([
  "SandboxUnavailable",
  "SandboxGone",
  "SnapshotGone",
  "SandboxEnding",
  "ImageNotReady",
  "SandboxNameTaken",
]);

/** Whether a failure is one a call of a sandbox answered. */
export function isSandboxError(failure: { readonly _tag: string }): failure is SandboxError {
  return SANDBOX_ERROR_TAGS.has(failure._tag);
}

/** A port of the sandbox served at a public address, which anyone holding it may open. */
export interface SandboxRoute {
  readonly port: number;
  readonly url: string;
}

/** A sandbox as a list or a lookup names it: its name, where it stands, the run it is up in, and its tags. */
export interface ListedSandbox {
  readonly name: string;
  /** Where it stands; none where the provider names a state that is none of these, such as a failed sandbox. */
  readonly status?: SandboxStatus | undefined;
  /** The run it is up in, or last ran, opaque to every caller but the provider. */
  readonly running?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
  /** The snapshot it resumes from, which its last stop or snapshot made. */
  readonly snapshotId?: string | undefined;
  /** When the sandbox was created, in epoch milliseconds. */
  readonly createdAt?: number | undefined;
  /** The timeout each run of the sandbox opens with, reapplied at every resume. */
  readonly timeout?: number | undefined;
  /** How many vCPUs each run of the sandbox runs on, as its create asked. */
  readonly vcpus?: number | undefined;
  /** When its running run ends, in epoch milliseconds, which an extension moves on. */
  readonly expiresAt?: number | undefined;
  /** The public routes it serves; a list names none, only a lookup by name. */
  readonly routes?: readonly SandboxRoute[] | undefined;
}

/** A sandbox a create or a resume answered: it opens ready, so it always names the run it is up in. */
export interface OpenedSandbox extends ListedSandbox {
  readonly running: string;
}

/** One run of a sandbox, as a caller fences a call to it: the sandbox's name, and the run it means. */
export interface SandboxRunning {
  readonly name: string;
  readonly running: string;
}

/**
 * What a call on a sandbox is made on: its name, for whatever run it is up
 * in now, or one run of it, for a call that must reach that run alone, which
 * a sandbox up in another answers as gone (`SandboxGone`). Neither resumes it.
 */
export type SandboxTarget = string | SandboxRunning;

/** A command the sandbox ran to its end: its exit code and what it printed on stdout and stderr. */
export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Where a sandbox's PTY is reached: a WebSocket address and the token it is
 * opened with, minted for one connection. Both stay on the service; nothing
 * of either reaches a device.
 */
export interface InteractiveShell {
  readonly url: string;
  readonly token: Redacted.Redacted;
}

/**
 * One rule on a host: the headers the firewall sets on the way out, on every
 * request to it, or on those that match every condition the rule names: the
 * path, and each header named at its value.
 */
export interface HeaderRule {
  readonly path?: { readonly startsWith: string } | { readonly exact: string };
  readonly headers?: Readonly<Record<string, string>>;
  readonly set: Readonly<Record<string, string>>;
}

/**
 * A sandbox's network policy: every host open, and on the hosts named, the
 * rules that set headers on the way out. No host named is the open internet
 * with nothing set (`OPEN_INTERNET`).
 */
export interface NetworkPolicy {
  readonly hosts: Readonly<Record<string, readonly HeaderRule[]>>;
}

/** The policy with no credential on it: the open internet. */
export const OPEN_INTERNET: NetworkPolicy = { hosts: {} };

/** The argv of a command we wrote, where it runs, and the variables it is handed beside the sandbox's own. */
export interface CommandAsk {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A detached command, its stdin held open for `writeStdin`: started as root
 * where `sudo` asks it, or as the user named, a user made in the sandbox
 * (`SandboxUser`). Its `env` is handed to a root command by the provider
 * alone, so a secret in it reaches no argv and no file; a user's command may
 * carry it on its command line, where every process in the sandbox may read
 * it for as long as the command runs.
 */
export type DetachedCommandAsk = CommandAsk &
  ({ readonly sudo: boolean } | { readonly user: string });

/** What a sandbox is opened from: an image in the project's registry, or a snapshot. */
export type SandboxSource = { readonly image: string } | { readonly snapshotId: string };

/** What a sandbox's own drive is forked from: a base drive, by its name, or the drive another sandbox owns, by that sandbox's name. */
export type DriveOrigin = { readonly base: string } | { readonly ownedBy: string };

/**
 * A drive a sandbox opens with, mounted writable at the absolute path
 * `at`, its files kept apart from the sandbox's own disk and its snapshots:
 * a base drive, by its name, made empty where none stands, mounted to be
 * filled (`fill`), which one sandbox fills at a time and many fork; or a
 * drive of the sandbox's own forked from a base drive or from another
 * sandbox's own (`fork`), copying its files as they stand; or the drive an
 * earlier create under the sandbox's name forked (`own`), mounted again as it
 * stands, as after its kept snapshot lapsed, and none where it forked none.
 * A sandbox owns the drive it forked, which its delete deletes with it, so
 * neither goes without the other; it never owns a base drive, which no
 * sandbox's delete touches. A fork whose origin is missing, or was never
 * filled, answers as gone (`SandboxGone`).
 */
export type SandboxDrive =
  | { readonly fill: string; readonly at: string }
  | { readonly fork: DriveOrigin; readonly at: string }
  | { readonly own: true; readonly at: string };

/**
 * A user made in a sandbox, in the group of the sandbox's default user, who
 * writes what a file write writes, the checkout among it, so the two share
 * it; the folders given, by their absolute paths in its home, made its own;
 * and that home then closed to every other user.
 */
export interface SandboxUser {
  readonly name: string;
  readonly homeFolders: readonly string[];
}

/**
 * A sandbox opened from an image or a snapshot: its name, what it is opened
 * from, the drive it opens with where it asks one, its tags, how large a run
 * is, how long its kept snapshot lasts after its last use, and its
 * variables. Each run lasts `SANDBOX_IDLE` past its last touch, which no
 * caller chooses. It keeps its newest snapshot alone, which is all a resume
 * reads; a drive it opened with is mounted again at every resume.
 */
export interface SandboxCreate {
  readonly name: string;
  readonly from: SandboxSource;
  readonly drive?: SandboxDrive;
  readonly tags: Readonly<Record<string, string>>;
  /** How many vCPUs it runs on; where unsaid, the provider's default. */
  readonly vcpus?: number;
  /** How long its kept snapshot lasts after its last use; where unsaid, the package's default. */
  readonly snapshotLapse?: import("effect").Duration.Duration;
  readonly env: Readonly<Record<string, string>>;
  /** The user made in it as it is created, where it names one. */
  readonly user?: SandboxUser;
}

/** A sandbox got or created: as a create opens it, with the user it names, where it names one, made in it where the call creates it. */
export type SandboxGetOrCreate = SandboxCreate;

/** A file written into a sandbox: its absolute path, its bytes, and its mode. */
export interface SandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly mode: number;
}
