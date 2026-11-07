/**
 * vocabulary.ts -- what a caller of Vercel Sandbox speaks in: a sandbox's statuses, the calls we make and the failure they answer, and the shapes of a sandbox, its session, its commands, its files, and its network policy.
 *
 * Nothing here names who asks: a sandbox is named, tagged, and opened from
 * the image or snapshot its caller hands, and what a name or a tag means is
 * the caller's.
 */

import { Data, type Duration, type Effect, type Redacted } from "effect";

/** The statuses Vercel names a sandbox by that we read: up in `running`, which the list of running sandboxes filters on. */
export const SANDBOX_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  SNAPSHOTTING: "snapshotting",
} as const;

/** The statuses a sandbox is up in, or on its way up. */
export const UP_STATUSES: ReadonlySet<string> = new Set([
  SANDBOX_STATUS.PENDING,
  SANDBOX_STATUS.RUNNING,
]);

/** The policy with no credential on it: the open internet. */
export const OPEN_INTERNET_POLICY = { mode: "allow-all" } as const;

/** Vercel's answer for a sandbox, session, or snapshot already gone. */
export const NOT_FOUND_STATUS = 404;

/**
 * Vercel's error code for a create on an image its registry has not finished
 * preparing for Sandbox, which its docs say to retry once the preparation
 * finishes (https://vercel.com/docs/sandbox/concepts/images).
 */
export const IMAGE_NOT_READY = "image_not_ready";

/**
 * Vercel's answer for a resume or a create whose snapshot is gone: expired
 * past the expiration it was kept for, or deleted. Vercel's body
 * names it `snapshot_not_found`, as the SDK's own check reads it.
 */
const SNAPSHOT_GONE_STATUS = 410;

/**
 * The code Vercel's body names a snapshot gone by. Note that Vercel answers
 * 410 for a call to a stopped sandbox too (`sandbox_stopped`), which a resume
 * mends, and that a body that could not be read names no code, so only a 410
 * that names this code says the snapshot is gone.
 */
const SNAPSHOT_GONE_CODE = "snapshot_not_found";

/**
 * Vercel's answer for a call to a session that is stopping, or being
 * snapshotted, under it, and the codes its body names: what a resume of the
 * sandbox mends, as the SDK's own `withResume` reads it.
 */
const SESSION_ENDING = {
  STATUS: 422,
  CODES: new Set(["sandbox_stopping", "sandbox_snapshotting"]),
} as const;

/** What a read of a command's exit answers for a command, or its session, Vercel no longer knows. */
export const COMMAND_GONE = "gone";

/** A command's exit code, null while it runs, or gone (`COMMAND_GONE`). */
export type CommandExit = number | null | typeof COMMAND_GONE;

/** Which of the API's calls was made, as a failure names it. */
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
  LIST: "list",
  DELETE: "delete",
  STOP: "stop",
  SESSION: "session",
  EXTEND: "extend",
  NETWORK_POLICY: "network-policy",
  INTERACTIVE: "interactive",
  SNAPSHOT: "snapshot",
  PORTS: "ports",
} as const;

export type SandboxCall = (typeof SANDBOX_CALL)[keyof typeof SANDBOX_CALL];

/**
 * Vercel could not be asked, or did not confirm what was asked: the call
 * that failed, the status where Vercel answered one, its error code where it
 * named one, and what went wrong in a line, Vercel's own error code and
 * message or the cause's where it never answered. None of it is anything
 * we sent.
 */
export class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly call?: SandboxCall;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
}> {
  override get message(): string {
    const asked = this.call === undefined ? "Vercel Sandbox" : `Vercel Sandbox ${this.call}`;
    const answer =
      this.status === undefined ? `${asked} was unavailable` : `${asked} answered ${this.status}`;
    return this.detail === undefined ? answer : `${answer}: ${this.detail}`;
  }
}

/** Whether a call failed because the session it named was stopping, or being snapshotted, under it: one a resume of its sandbox mends. */
export function sessionEnding(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SESSION_ENDING.STATUS &&
    failure.code !== undefined &&
    SESSION_ENDING.CODES.has(failure.code)
  );
}

/** Whether a call failed because the snapshot its sandbox resumes or opens from is gone: one no retry mends, the sandbox's saved files lost with it. */
export function snapshotGone(failure: { readonly _tag: string }): boolean {
  return (
    failure instanceof SandboxUnavailable &&
    failure.status === SNAPSHOT_GONE_STATUS &&
    failure.code === SNAPSHOT_GONE_CODE
  );
}

/** A sandbox as a list or a lookup names it: its name, where it stands, the session it runs while up, and its tags. */
export interface ListedSandbox {
  readonly name: string;
  readonly status?: string | undefined;
  readonly currentSessionId?: string | undefined;
  readonly tags?: Readonly<Record<string, string>> | undefined;
  /** The snapshot a persistent sandbox resumes from, which its last stop or snapshot made. */
  readonly currentSnapshotId?: string | undefined;
  /** When the sandbox was created, in epoch milliseconds. */
  readonly createdAt?: number | undefined;
  /** The timeout each session of the sandbox opens with, which Vercel reapplies at every resume. */
  readonly timeout?: number | undefined;
  /** How many vCPUs each session of the sandbox runs on, as its create asked. */
  readonly vcpus?: number | undefined;
  /** When its running session ends, in epoch milliseconds, which an extension moves on. */
  readonly expiresAt?: number | undefined;
  /** How many of its snapshots Vercel keeps and for how long; none where none was set, which keeps every one. */
  readonly keepLastSnapshots?: SnapshotRetention | undefined;
  /** The public routes its session serves; a list names none, only a lookup by name. */
  readonly routes?: readonly SandboxRoute[] | undefined;
}

/** A port of the sandbox served at a public address, which anyone holding it may open. */
export interface SandboxRoute {
  readonly port: number;
  readonly url: string;
}

/** A sandbox a create or a resume answered: Vercel opens it ready, so it always names the session it runs. */
export interface OpenedSandbox extends ListedSandbox {
  readonly currentSessionId: string;
}

/**
 * A sandbox's snapshot retention as Vercel's "Update a sandbox" takes it
 * (https://vercel.com/docs/rest-api/sandboxes/update-a-sandbox): the newest
 * `count` kept, each for `expiration` milliseconds, and the rest deleted
 * at once where `deleteEvicted`, which Vercel defaults to true.
 */
interface SnapshotRetention {
  readonly count: number;
  readonly expiration?: number | undefined;
  readonly deleteEvicted?: boolean | undefined;
}

/** A command the sandbox ran to its end: its exit code and what it printed on stdout and stderr. */
export interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Where a sandbox session's PTY is reached: a WebSocket address and the
 * token it is opened with, minted for one connection. Both stay on the
 * service; nothing of either reaches a device.
 */
export interface InteractiveShell {
  readonly url: string;
  readonly token: Redacted.Redacted;
}

/** A request header a rule matches: its name, and its value exactly (`@vercel/sandbox`'s `NetworkPolicyKeyValueMatcher`). */
interface HeaderMatch {
  readonly key: { readonly exact: string };
  readonly value: { readonly exact: string };
}

/**
 * One rule on a host: the headers the firewall sets on the way out, on every
 * request, or on those that match every condition its `match` names: the
 * path, and each header named at its value.
 */
export interface NetworkRule {
  readonly match?: {
    readonly path?: { readonly startsWith: string } | { readonly exact: string };
    readonly headers?: readonly HeaderMatch[];
  };
  readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
}

/**
 * A sandbox session's network policy: the open internet with nothing set,
 * or every host open and, on the hosts named, the rules that set headers on
 * the way out.
 */
export type NetworkPolicy =
  | { readonly mode: "allow-all" }
  | { readonly allow: Readonly<Record<string, readonly NetworkRule[]>> };

/** The argv of a command we wrote, where it runs, and the variables it is handed beside the sandbox's own. */
export interface CommandAsk {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A detached command: started as root where `sudo` asks it, which the
 * sandbox's API does by running the `sudo` binary as the default user, so
 * it needs that user's sudoers entry, which the image keeps; its stdin held
 * open for `writeStdin`. Its `env` is handed to it by the API alone, so a
 * secret in it reaches no argv and no file. Vercel documents that its `sudo`
 * keeps that environment (setting `HOME` to root's), as the image's own
 * sudoers must.
 */
interface DetachedCommandAsk extends CommandAsk {
  readonly sudo: boolean;
}

/** What a sandbox is opened from: an image in the project's registry, or a snapshot. */
type SandboxSource = { readonly image: string } | { readonly snapshotId: string };

/**
 * A sandbox opened from an image or a snapshot: its name, what it is opened
 * from, its tags, how long it may run and how large, and how many of its
 * snapshots Vercel keeps.
 */
export interface SandboxCreate {
  readonly name: string;
  readonly from: SandboxSource;
  readonly tags: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** How many vCPUs it runs on; where unsaid, Vercel's default. */
  readonly vcpus?: number;
  readonly keepLastSnapshots: {
    readonly count: number;
    /** How long a kept snapshot lasts; where unsaid, the sandbox's own default. */
    readonly expiration?: number;
    readonly deleteEvicted: boolean;
  };
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A user made in a sandbox as the SDK makes one (`createUser`), in the
 * group of the sandbox's default user, who writes what the API writes, the
 * checkout among it, so the two share it; the folders given, by their
 * absolute paths in its home, made its own; and that home then closed to
 * every other user, as Vercel's multi-agent docs suggest for files only that
 * user should read (https://vercel.com/docs/sandbox/concepts/multi-agent).
 */
export interface SandboxUser {
  readonly name: string;
  readonly homeFolders: readonly string[];
}

/** A sandbox got or created: as a create opens it, with the user it names, where it names one, made in it where the call creates it. */
interface SandboxGetOrCreate extends SandboxCreate {
  readonly user?: SandboxUser;
}

/** A file written into a sandbox: its absolute path, its bytes, and its mode. */
export interface SandboxFile {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly mode: number;
}

/** The order a list runs in by when each sandbox was created. */
export const LIST_ORDER = { OLDEST_FIRST: "asc", NEWEST_FIRST: "desc" } as const;

export type ListOrder = (typeof LIST_ORDER)[keyof typeof LIST_ORDER];

/** A page of sandboxes: the sandboxes, and the cursor of the next page where there is one. */
interface SandboxPage {
  readonly sandboxes: readonly ListedSandbox[];
  readonly next: string | undefined;
}

/** A sandbox's session as a caller names it: the sandbox's name, and the id of the session it means. */
export interface SessionRef {
  readonly name: string;
  readonly sessionId: string;
}

/** The calls on one sandbox session, made through the one handle an operation holds (`VercelSandboxApi`'s `session`). */
export interface SandboxSessionApi {
  /** Runs a command in the session and waits for its end. */
  readonly run: (ask: CommandAsk) => Effect.Effect<CommandRun, SandboxUnavailable>;
  /** Mints a connection to the running session's PTY; a session not running is unavailable, and nothing is resumed. */
  readonly openInteractive: () => Effect.Effect<InteractiveShell, SandboxUnavailable>;
  /** Stops the session, keeping its filesystem; one already gone counts as stopped. */
  readonly stop: () => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Lengthens the running session's timeout by the duration given, which
   * Vercel takes from a second up and refuses past the account's maximum
   * lifetime.
   */
  readonly extendTimeout: (durationMs: number) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Snapshots the running session, which stops it, answering the snapshot's
   * id. The snapshot expires `expiresAfter` its last use, or never where that
   * is infinite. Note that an expiration asked here wins over the sandbox's
   * own `keepLastSnapshots`, so a snapshot that must lapse on its own says
   * when. A session that is no longer running is refused, so of two
   * snapshots asked at once only the first is taken.
   */
  readonly snapshot: (expiresAfter: Duration.Duration) => Effect.Effect<string, SandboxUnavailable>;
  /** Writes the files into the running sandbox session, as the sandbox's default user. */
  readonly writeFiles: (files: readonly SandboxFile[]) => Effect.Effect<void, SandboxUnavailable>;
  /** Sets the running session's network policy whole, so its writer composes it from what stands. */
  readonly updateNetworkPolicy: (policy: NetworkPolicy) => Effect.Effect<void, SandboxUnavailable>;
  /** Starts a detached command with its stdin held open; answers the command's id. */
  readonly start: (ask: DetachedCommandAsk) => Effect.Effect<string, SandboxUnavailable>;
  /** Appends the text to a detached command's stdin, after whatever it already took. */
  readonly writeStdin: (commandId: string, text: string) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * A command's exit code, null while it runs, or gone where Vercel no longer
   * knows the command or its session. The read waits for the exit for at most
   * `within` (`EXIT_WAIT` unless the caller names longer), so a caller that
   * waits on a command's end names how long rather than reading it again.
   */
  readonly commandExit: (
    commandId: string,
    within?: Duration.Duration,
  ) => Effect.Effect<CommandExit, SandboxUnavailable>;
  /**
   * What a command that exited printed on stderr, the tail kept, every value
   * named in `secrets` and every token-shaped run redacted, for a log; none
   * where it printed nothing there, and unavailable where Vercel refused or
   * did not answer within `EXIT_WAIT`.
   */
  readonly commandStderrTail: (
    commandId: string,
    secrets?: readonly string[],
  ) => Effect.Effect<string | undefined, SandboxUnavailable>;
  /** Ends a command with SIGTERM; one already gone counts as ended. */
  readonly kill: (commandId: string) => Effect.Effect<void, SandboxUnavailable>;
}

export interface VercelSandboxApi {
  /**
   * Every sandbox carrying the tag with the value given, the newest first.
   * Note that the order is made here rather than left to every reader's
   * first pick, because an expired sandbox whose delete Vercel did not
   * confirm stands beside the replacement that took its place under the same
   * tag, and the replacement is the one its readers must find first.
   */
  readonly listTagged: (
    tag: string,
    value: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
  /** One page of the sandboxes carrying the tag with the value given, every state among them. */
  readonly listCarrying: (
    tag: string,
    value: string,
  ) => Effect.Effect<readonly ListedSandbox[], SandboxUnavailable>;
  /**
   * One page of the project's running sandboxes, every kind, by when they
   * were created in the order given, from the cursor a page before answered;
   * with the cursor of the next page where there is one.
   */
  readonly listRunning: (
    cursor: string | undefined,
    order: ListOrder,
  ) => Effect.Effect<SandboxPage, SandboxUnavailable>;
  /** The named sandbox, resumed from its snapshot first where it was stopped. */
  readonly resume: (name: string) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  /** Deletes the named sandbox with the snapshots no other sandbox uses; one already gone counts as deleted. */
  readonly deleteSandbox: (name: string) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * The sandbox session named, as one operation holds it for its calls and
   * polls: the sandbox looked up once by its name, without resuming it. A
   * session that is no longer the sandbox's, or a sandbox gone, answers each
   * call as Vercel answers a session it no longer holds.
   */
  readonly session: (ref: SessionRef) => Effect.Effect<SandboxSessionApi, SandboxUnavailable>;
  /**
   * Opens a persistent sandbox from the image or snapshot named, on the open
   * internet; answers it with the session it runs.
   * A name another sandbox holds is refused with Vercel's 409, which is what
   * makes a name a lock.
   */
  readonly create: (ask: SandboxCreate) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  /**
   * The sandbox under the name as `Sandbox.getOrCreate` opens it
   * (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes): the one
   * standing, resumed where it was stopped; else one created as `create`
   * opens it; and where the one standing can never resume, its snapshot
   * gone, that one deleted and another created under the same name. A
   * sandbox it created has the user the ask names, where it names one, made
   * in it in its `onCreate`, and is then handed to the caller's `onCreate`
   * where it gives one, before the call answers; a failure of either fails
   * the call.
   */
  readonly getOrCreate: (
    ask: SandboxGetOrCreate,
    onCreate?: (created: OpenedSandbox) => Promise<void>,
  ) => Effect.Effect<OpenedSandbox, SandboxUnavailable>;
  /**
   * Starts a detached command as the user in the named sandbox, its stdin
   * held open for `writeStdin`, as the SDK does (`asUser(...).runCommand`),
   * and answers the command's id. Note that the SDK writes the command's
   * `env` on `sudo`'s command line, so every process in the sandbox may read
   * it there for as long as the command runs.
   */
  readonly startAsUser: (
    name: string,
    username: string,
    ask: CommandAsk,
  ) => Effect.Effect<string, SandboxUnavailable>;
  /** The sandbox of that name, as it stands, without resuming it; none where there is no such sandbox. */
  readonly getNamed: (name: string) => Effect.Effect<ListedSandbox | undefined, SandboxUnavailable>;
  /** Replaces the named sandbox's tags whole. */
  readonly updateTags: (
    name: string,
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Serves exactly the ports given on public routes, closing every other,
   * and replaces the named sandbox's tags whole, without resuming it;
   * answers the routes it serves after
   * (https://vercel.com/docs/rest-api/sandboxes/update-a-sandbox).
   */
  readonly updatePorts: (
    name: string,
    ports: readonly number[],
    tags: Readonly<Record<string, string>>,
  ) => Effect.Effect<readonly SandboxRoute[], SandboxUnavailable>;
}
