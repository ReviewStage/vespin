/**
 * vercel-sdk.ts -- `Sandbox` as Vercel Sandbox answers it: every call made through `@vercel/sandbox` under the deployment's own OIDC token, and Vercel's answers read as the package's own words.
 *
 * Everything a caller asks of a sandbox — one deleted, stopped, resumed, or
 * got or created from an image or a snapshot, the drive it opens with
 * made, forked, mounted and deleted with it or by its name, a user made in
 * it and a command started as that user, a short command, a PTY, a network
 * policy, a snapshot, its tags and its public ports — is asked here, of the
 * SDK at the version the catalog pins, which loads in a function's bundle.
 * The SDK tries a 429, a 5xx, and a failure to connect again before it answers (a
 * 429 waits out Vercel's `Retry-After` up to 20 seconds), so nothing here
 * tries again.
 *
 * Every call goes under the token `SandboxToken` reads and the `fetch`
 * `SandboxFetch` names: a call on a sandbox by name, a list, and a create
 * through the SDK's statics, and the calls on what runs in a sandbox
 * through the session the documented way reaches it (`Sandbox.get` by the
 * sandbox's name, without resuming it, then `currentSession`), looked up at
 * each call. A run a caller names is one of Vercel's sessions, and a
 * sandbox no longer in it answers as Vercel answers a session it no longer
 * holds.
 *
 * A drive is a Vercel Drive (https://vercel.com/docs/sandbox/concepts/drives),
 * mounted read-write at the path the ask names in the drive's region: a
 * base drive got or created by its name for a fill, or a sandbox's own drive,
 * named after the sandbox (`ownDriveName`), forked from its origin as the
 * sandbox is created, mounted again by a later create under its name, and
 * deleted with the sandbox; a base drive is deleted by its name alone.
 *
 * A sandbox is found by a tag its caller gave it, whose value names few
 * sandboxes, so the first page is all of them. What is sent is a tag, a
 * name, and the argv of a command a caller wrote; what a failure carries is
 * the call that failed, and Vercel's status, error code and message, or the
 * cause's where Vercel never answered, every token-shaped run of it
 * redacted, and never what was sent. A deployment without an OIDC token
 * answers every call as unavailable.
 */

import { EXCESS_KEYS, unparsedWire, valueFromJsonText, valueKind } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  APIError,
  Drive,
  type NetworkPolicy as SdkNetworkPolicy,
  Sandbox as SdkSandbox,
  type Session,
  StreamError,
} from "@vercel/sandbox";
import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { SANDBOX_IDLE, Sandbox, type SandboxService } from "../sandbox.js";
import {
  COMMAND_GONE,
  type CommandAsk,
  type CommandExit,
  ImageNotReady,
  type ListedSandbox,
  type NetworkPolicy,
  OPEN_INTERNET,
  type OpenedSandbox,
  SANDBOX_CALL,
  SANDBOX_STATUS,
  type SandboxCall,
  type SandboxCreate,
  type SandboxDrive,
  SandboxEnding,
  type SandboxError,
  SandboxGone,
  SandboxNameTaken,
  type SandboxRoute,
  type SandboxStatus,
  type SandboxTarget,
  SandboxUnavailable,
  type SandboxUser,
  SnapshotGone,
  UP_STATUSES,
} from "../vocabulary.js";
import { openPtySocket } from "./pty.js";

/** Vercel's answer for a sandbox, session, command, or snapshot already gone. */
const NOT_FOUND_STATUS = 404;

/** Vercel's answer for a create whose name another sandbox already holds. */
const NAME_TAKEN_STATUS = 409;

/**
 * Vercel's answer for a call to a session that has stopped, and the code its
 * body names: the session ended, as one its sandbox no longer runs did. Note
 * that Vercel's list may still name the sandbox running in that session.
 */
const SESSION_STOPPED = { STATUS: 410, CODE: "sandbox_stopped" } as const;

/**
 * Vercel's answer for a resume or a create whose snapshot is gone, expired
 * past the expiration it was kept for or deleted: a 410 whose body names the
 * snapshot, as its code (`snapshot_not_found`, which the SDK's own check
 * reads) or its words (`bad_request: Snapshot expired or deleted.`, which
 * Vercel also answers). Note that Vercel answers 410 for a call to a stopped
 * sandbox too (`SESSION_STOPPED`), which a resume mends and whose body names
 * no snapshot.
 */
const SNAPSHOT_GONE = { STATUS: 410, BODY: /snapshot/iu } as const;

/**
 * Vercel's answer for a call to a session that is stopping, or being
 * snapshotted, under it, and the codes its body names: what a resume of the
 * sandbox mends, as the SDK's own `withResume` reads it.
 */
const SESSION_ENDING = {
  STATUS: 422,
  CODES: new Set(["sandbox_stopping", "sandbox_snapshotting"]),
} as const;

/**
 * Vercel's error code for a create on an image its registry has not finished
 * preparing for Sandbox, which its docs say to retry once the preparation
 * finishes (https://vercel.com/docs/sandbox/concepts/images).
 */
const IMAGE_NOT_READY_CODE = "image_not_ready";

/**
 * Vercel's error codes for a drive: one still mounted in a running sandbox,
 * which it refuses to delete, and one never written, which it refuses to
 * fork. Note that the first comes with the 409 a name taken comes with, so it
 * is told apart by its code.
 */
const DRIVE_CODE = {
  ATTACHED: "drive_attached",
  NOT_INITIALIZED: "drive_not_initialized",
} as const;

/**
 * What a sandbox's own drive is named after the sandbox's name: the name
 * and this, so a delete of the name finds its drive whether the sandbox
 * still stands or not, and no base drive a caller names, which never ends so,
 * is taken for one.
 */
const OWN_DRIVE_SUFFIX = "-drive";

/** The statuses past which Vercel's answer says it may take the call another time: busy, or at fault. */
const AGAIN_STATUS = { TOO_MANY_REQUESTS: 429, SERVER_ERROR: 500 } as const;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

/** Vercel's statuses as the package names them; one named none of these (`failed`, `aborted`) reads as none. */
const STATUS_OF_VERCEL: ReadonlyMap<string, SandboxStatus> = new Map([
  ["pending", SANDBOX_STATUS.STARTING],
  ["running", SANDBOX_STATUS.RUNNING],
  ["stopping", SANDBOX_STATUS.STOPPING],
  ["snapshotting", SANDBOX_STATUS.STOPPING],
  ["stopped", SANDBOX_STATUS.STOPPED],
]);

/**
 * The snapshots Vercel keeps of a sandbox: the newest alone, which is all a
 * resume reads, so snapshot storage stays flat however many runs stop it.
 * An evicted one is deleted at once, and the kept one expires `EXPIRATION`
 * after it was last used unless the create names its own lapse, as Vercel's
 * persistent sandbox examples keep one
 * (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes), named here
 * because Vercel's own pages disagree on the default. The cost: a sandbox
 * resumed after 7 idle days finds no snapshot (`SnapshotGone`).
 */
const KEPT_SNAPSHOTS = { COUNT: 1, EXPIRATION: Duration.days(7), DELETE_EVICTED: true } as const;

/**
 * How a touch lengthens a running session (`touch`). Vercel's extension adds
 * to the session's timeout, so the touch reads where the session ends and
 * extends it by the difference to `SANDBOX_IDLE` from now: only where that
 * is more than `LEAST`, so touches close together cost one read and no
 * write, and never past `LONGEST_RUN` from the session's start, the longest
 * Vercel lets a session run on Pro and Enterprise, past which it refuses an
 * extension. Note that two touches at once may each extend, ending the
 * session up to twice `SANDBOX_IDLE` on, which is let be.
 */
const TOUCH = { LEAST: Duration.seconds(30), LONGEST_RUN: Duration.hours(24) } as const;

const SANDBOX_API = {
  /**
   * A tag's value names few sandboxes, so the first page is all of them.
   * Note that the page is the API's widest, because a list asked for more is
   * refused whole (`limit`'s maximum in Vercel's REST reference is 50).
   */
  PAGE: 50,
  /**
   * How long a read of a command's exit waits for it. Vercel records a
   * command's exit only once a read that waits for it (`wait=true`) has seen
   * it, and a plain read answers no exit forever, so the read waits, and one
   * that outlasts this finds the command still running.
   */
  EXIT_WAIT: Duration.seconds(2),
} as const;

/** The span each call is traced under, named for the call alone, never for what it was asked. */
const SANDBOX_CALL_SPAN = {
  [SANDBOX_CALL.CREATE]: "web/sandboxCreate",
  [SANDBOX_CALL.GET_OR_CREATE]: "web/sandboxGetOrCreate",
  [SANDBOX_CALL.FS_WRITE]: "web/sandboxWriteFiles",
  [SANDBOX_CALL.CMD]: "web/sandboxCommand",
  [SANDBOX_CALL.STDIN]: "web/sandboxWriteStdin",
  [SANDBOX_CALL.LOGS]: "web/sandboxCommandLogs",
  [SANDBOX_CALL.KILL]: "web/sandboxKill",
  [SANDBOX_CALL.TAGS]: "web/sandboxUpdateTags",
  [SANDBOX_CALL.GET]: "web/sandboxGet",
  [SANDBOX_CALL.DRIVE]: "web/sandboxDrive",
  [SANDBOX_CALL.LIST]: "web/sandboxList",
  [SANDBOX_CALL.DELETE]: "web/sandboxDelete",
  [SANDBOX_CALL.STOP]: "web/sandboxStop",
  [SANDBOX_CALL.RUN]: "web/sandboxSession",
  [SANDBOX_CALL.TOUCH]: "web/sandboxTouch",
  [SANDBOX_CALL.NETWORK_POLICY]: "web/sandboxNetworkPolicy",
  [SANDBOX_CALL.INTERACTIVE]: "web/sandboxInteractive",
  [SANDBOX_CALL.SNAPSHOT]: "web/sandboxSnapshot",
  [SANDBOX_CALL.PORTS]: "web/sandboxUpdatePorts",
} as const satisfies Record<SandboxCall, string>;

/**
 * Vercel could not be asked, or did not confirm what was asked, as this
 * adapter reads it before the package's own words: the call that failed,
 * the status where Vercel answered one, its error code where it named one,
 * and what went wrong in a line.
 */
class Refused extends Data.TaggedError("Refused")<{
  readonly call: SandboxCall;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
}> {}

/** What a refusal's line says: Vercel's status where it answered one, and its words or the cause's. */
function refusalDetail(refusal: Refused): string | undefined {
  if (refusal.status === undefined) return refusal.detail;
  const answered = `Vercel answered ${refusal.status}`;

  return refusal.detail === undefined ? answered : `${answered}: ${refusal.detail}`;
}

/** A refusal in the package's words: what was named gone, its name taken, its snapshot gone, its run ending, its image not ready, or the call unavailable. */
function neutralOf(refusal: Refused): SandboxError {
  const { call, status, code } = refusal;

  if (status === NOT_FOUND_STATUS || code === DRIVE_CODE.NOT_INITIALIZED) {
    return new SandboxGone({ call });
  }

  if (status === NAME_TAKEN_STATUS && code !== DRIVE_CODE.ATTACHED) {
    return new SandboxNameTaken({ call });
  }

  if (status === SNAPSHOT_GONE.STATUS && SNAPSHOT_GONE.BODY.test(refusal.detail ?? "")) {
    return new SnapshotGone({ call });
  }

  if (status === SESSION_ENDING.STATUS && code !== undefined && SESSION_ENDING.CODES.has(code)) {
    return new SandboxEnding({ call });
  }

  if (code === IMAGE_NOT_READY_CODE) return new ImageNotReady({ call });

  const retryable =
    status !== undefined &&
    (status === AGAIN_STATUS.TOO_MANY_REQUESTS || status >= AGAIN_STATUS.SERVER_ERROR);

  const detail = refusalDetail(refusal);

  return new SandboxUnavailable({
    call,
    ...(retryable ? { retryable } : undefined),
    ...(detail === undefined ? undefined : { detail }),
  });
}

/**
 * The `fetch` the SDK sends on: the platform's own, and a suite's fake of
 * Vercel where a test provides one. Note that the default looks
 * `globalThis.fetch` up at each request rather than once, because a
 * reference keeps the default it first computed for the process's life.
 */
export const SandboxFetch = Context.Reference<typeof globalThis.fetch>(
  "@repo/sandbox/SandboxFetch",
  { defaultValue: () => (input, init) => globalThis.fetch(input, init) },
);

/** How the deployment's own OIDC token is read: the function's in production, a fixed one in a test. */
type OidcTokenRead = () => Promise<string>;

/** How the deployment's own OIDC token is read: the function's in production, a fixed one under a suite's fake of Vercel. */
export const SandboxToken = Context.Reference<OidcTokenRead>("@repo/sandbox/SandboxToken", {
  defaultValue: () => () => getVercelOidcToken(),
});

/** The OIDC token's claims the API is asked under: the project and team it names. */
const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

/** Vercel's answer to a call it refused: its error's code and message. */
const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

/** Where a sandbox's own PTY server is served: Vercel's sandbox domain, as it addresses a sandbox's routes, on a secure socket. */
const SANDBOX_SHELL_ADDRESS = {
  HOST_SUFFIX: ".vercel.run",
  PROTOCOLS: new Set(["wss:", "https:"]),
} as const;

/** Whether a minted PTY address is one of Vercel's sandboxes, by its protocol and host alone, so the shell's token is never sent anywhere else. */
function isSandboxShellAddress(address: string): boolean {
  const url = Result.try(() => new URL(address));

  if (Result.isFailure(url)) return false;
  const { protocol, hostname, username, password } = url.success;

  return (
    SANDBOX_SHELL_ADDRESS.PROTOCOLS.has(protocol) &&
    hostname.endsWith(SANDBOX_SHELL_ADDRESS.HOST_SUFFIX) &&
    username === "" &&
    password === ""
  );
}

const readClaims = readEither(OidcClaimsSchema, { excess: EXCESS_KEYS.DROP });
const readErrorAnswer = readEither(ErrorAnswerSchema, { excess: EXCESS_KEYS.DROP });

/** The most characters a failure's detail keeps, so one log line stays one line's worth. */
const DETAIL_CHARS = 300;

/** What a 2xx answer the SDK could not read is detailed as. */
const UNREADABLE_DETAIL = "an answer that could not be read";

/**
 * A run of characters shaped like a credential: twenty or more of a token's
 * alphabet unbroken, which a bearer, a provider key, a JWT, and an env value
 * we sent all are, and Vercel's prose, codes, and a URL's slashed path
 * segments mostly are not.
 */
const TOKEN_SHAPED = /[A-Za-z0-9._~+-]{20,}=*/gu;

/** An error code as Vercel writes one: lowercase words joined by underscores. */
const ERROR_CODE = /^[a-z]+(?:_[a-z]+){0,7}$/u;

/** What a token-shaped run of a detail reads as. */
const REDACTED_DETAIL = "[redacted]";

/**
 * The text cut to `DETAIL_CHARS` and to one line, every token-shaped run
 * redacted first. Note that a detail is redacted by shape rather than by the
 * values sent, because Vercel, the SDK, or a cause may echo any of them
 * back, and a detail reaches the logs.
 */
function capped(text: string): string {
  return clipped(text.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim());
}

/** How much of a dead command's stderr a log keeps: its end, where the reason it died is written. */
const STDERR_TAIL_CHARS = 600;

/** A stderr's tail as a log keeps it: every value named in `secrets`, whatever its shape, then every token-shaped run redacted, then its last `STDERR_TAIL_CHARS` on one line. */
function stderrTail(stderr: string, secrets: readonly string[]): string {
  const named = secrets
    .filter((secret) => secret.length > 0)
    .reduce((said, secret) => said.split(secret).join(REDACTED_DETAIL), stderr);

  const said = named.replace(TOKEN_SHAPED, REDACTED_DETAIL).replace(/\s+/gu, " ").trim();

  return said.length > STDERR_TAIL_CHARS ? `…${said.slice(-STDERR_TAIL_CHARS)}` : said;
}

/** A line cut to `DETAIL_CHARS`. */
function clipped(line: string): string {
  return line.length > DETAIL_CHARS ? `${line.slice(0, DETAIL_CHARS - 1)}…` : line;
}

/** How many causes deep a failure's detail reads, as a transport error wraps fetch's, which wraps the socket's. */
const CAUSE_DEPTH = 3;

/** A cause as a failure's detail: its name and message, and those of the causes under it, never anything else it holds. */
function causeDetail(cause: unknown): string {
  const said: string[] = [];
  let at: unknown = cause;

  while (at instanceof Error && said.length < CAUSE_DEPTH) {
    said.push(`${at.name}: ${at.message}`);
    at = at.cause;
  }

  return capped(said.length === 0 ? valueKind(cause) : said.join(" <- "));
}

/** Vercel's error code and message from a refusal's text, where it wrote them. */
function errorDetail(text: string): string | undefined {
  const read = readErrorAnswer(unparsedWire(valueFromJsonText(text)));

  if (Result.isFailure(read)) return undefined;
  const { code, message } = read.success.error;
  // Note that a code shaped as Vercel's are is kept whole, because one such as
  // `unsupported_media_type` is token-shaped by length and names the refusal.
  const named = code !== undefined && ERROR_CODE.test(code) ? code : undefined;

  const said = [named === undefined ? code : undefined, message].filter(
    (each): each is string => each !== undefined && each.trim() !== "",
  );

  const rest = said.length === 0 ? undefined : capped(said.join(": "));

  if (named === undefined) return rest;

  return rest === undefined ? named : clipped(`${named}: ${rest}`);
}

/** Vercel's error code in an answer's body, where it names one shaped as Vercel's are. */
function errorCode(text: string): string | undefined {
  const read = readErrorAnswer(unparsedWire(valueFromJsonText(text)));

  if (Result.isFailure(read)) return undefined;
  const { code } = read.success.error;

  return code !== undefined && ERROR_CODE.test(code) ? code : undefined;
}

/** Whether the SDK's failure is Vercel's answer that the snapshot it opens from is gone (`SNAPSHOT_GONE`). */
function snapshotGoneFailure(failure: unknown): boolean {
  return (
    failure instanceof APIError &&
    failure.response.status === SNAPSHOT_GONE.STATUS &&
    SNAPSHOT_GONE.BODY.test(failure.text ?? "")
  );
}

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

/** An answer as the failure it is: the call, its status and code, and Vercel's own words, or that a 2xx could not be read. */
function refused(
  call: SandboxCall,
  answered: { readonly status: number; readonly text: string },
): Refused {
  const detail =
    errorDetail(answered.text) ?? (succeeded(answered.status) ? UNREADABLE_DETAIL : undefined);

  const code = errorCode(answered.text);

  return new Refused({
    call,
    status: answered.status,
    ...(code === undefined ? undefined : { code }),
    ...(detail === undefined ? undefined : { detail }),
  });
}

/**
 * What `@vercel/sandbox` threw as the failure it is: an `APIError` read as
 * Vercel's answer is, by its status and its body's text, never the SDK's own
 * message, which may quote the answer; a stream's error by its code and
 * message; and anything else as the cause. Note that the SDK has already
 * tried a 429, a 5xx, and a failure to connect again by then.
 */
function sdkFailure(call: SandboxCall, cause: unknown): Refused {
  if (cause instanceof APIError) {
    return refused(call, { status: cause.response.status, text: cause.text ?? "" });
  }

  if (cause instanceof StreamError) {
    return new Refused({
      call,
      ...(ERROR_CODE.test(cause.code) ? { code: cause.code } : undefined),
      detail: capped(cause.message),
    });
  }

  return new Refused({ call, detail: causeDetail(cause) });
}

/** One SDK call as an effect under the call's span, its failure read as the call's; interrupting it aborts the SDK's request. */
function sdkCall<A>(
  call: SandboxCall,
  run: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, Refused> {
  return Effect.tryPromise({ try: run, catch: (cause) => sdkFailure(call, cause) }).pipe(
    Effect.withSpan(SANDBOX_CALL_SPAN[call]),
  );
}

/** Whether a refusal is Vercel's answer that what was named is already gone. */
function isGone(refusal: Refused): boolean {
  return refusal.status === NOT_FOUND_STATUS;
}

/** Whether a call on a session failed because the session ended: gone, or stopped under it, which leaves nothing of it running. */
function sessionGone(refusal: Refused): boolean {
  return (
    isGone(refusal) ||
    (refusal.status === SESSION_STOPPED.STATUS && refusal.code === SESSION_STOPPED.CODE)
  );
}

/** The SDK's own name for a network policy, from the package's: the open internet by name, else every host open and each named host's rules as the SDK's matchers and transforms. */
function sdkPolicyOf(policy: NetworkPolicy): SdkNetworkPolicy {
  const hosts = Object.entries(policy.hosts);

  if (hosts.length === 0) return "allow-all";

  return {
    allow: Object.fromEntries([
      // Note that the wildcard leaves every other host open, as the open internet is.
      ["*", []],
      ...hosts.map(([host, rules]) => [
        host,
        rules.map((rule) => {
          const headers = Object.entries(rule.headers ?? {}).map(([key, value]) => ({
            key: { exact: key },
            value: { exact: value },
          }));

          const matched = rule.path !== undefined || headers.length > 0;

          return {
            ...(matched
              ? {
                  match: {
                    ...(rule.path === undefined ? undefined : { path: rule.path }),
                    ...(headers.length === 0 ? undefined : { headers }),
                  },
                }
              : undefined),
            transform: [{ headers: { ...rule.set } }],
          };
        }),
      ]),
    ]),
  };
}

/** The user made in the sandbox as the SDK makes one, its home's folders made and the home closed (`SandboxUser`), under the create's span. */
async function madeUser(
  sandbox: SdkSandbox,
  made: SandboxUser,
  signal: AbortSignal,
): Promise<void> {
  const user = await sandbox.createUser(made.name, { signal });
  const { group } = await sandbox.getDefaultUser({ signal });
  await sandbox.addUserToGroup(made.name, group, { signal });

  for (const folder of made.homeFolders) {
    await user.mkDir(folder, { signal });
  }

  const closed = await user.runCommand("chmod", ["700", user.homeDir], { signal });

  if (closed.exitCode !== 0) throw new Error(`${user.homeDir} could not be closed`);
}

/** A sandbox's own drive's name (`OWN_DRIVE_SUFFIX`). */
function ownDriveName(sandboxName: string): string {
  return `${sandboxName}${OWN_DRIVE_SUFFIX}`;
}

/** The credentials and the `fetch` every SDK call is made under. */
interface Under {
  readonly token: string;
  readonly projectId: string;
  readonly teamId: string;
  readonly fetch: typeof globalThis.fetch;
}

/** What a create mounts: the drive, the path it is mounted at, and whether this call forked it. */
interface MountedDrive {
  readonly drive: Drive;
  readonly at: string;
  readonly forked: boolean;
}

/** Nothing where the SDK's failure was Vercel's not-found, else the failure thrown on. */
function absentIfNotFound(failure: unknown): undefined {
  if (failure instanceof APIError && failure.response.status === NOT_FOUND_STATUS) return undefined;
  throw failure;
}

/**
 * The drive a create opens with, ready to mount: for a fill, the base drive
 * got or created by its name; for its own, the sandbox's own where it
 * stands, as Vercel mounts the same drive in a later run to pick up where
 * the last left off, and none where it forked none; for a fork, the
 * sandbox's own where it stands, as after a create whose snapshot lapsed,
 * else forked from its origin, which Vercel answers as not found where it is
 * missing.
 */
async function driveFor(
  name: string,
  asked: SandboxDrive,
  under: Under,
  signal: AbortSignal,
): Promise<MountedDrive | undefined> {
  if ("fill" in asked) {
    const drive = await Drive.getOrCreate({ ...under, name: asked.fill, signal });

    return { drive, at: asked.at, forked: false };
  }

  const own = ownDriveName(name);
  const standing = await Drive.get({ ...under, name: own, signal }).catch(absentIfNotFound);

  if (standing !== undefined) return { drive: standing, at: asked.at, forked: false };

  if ("own" in asked) return undefined;

  const origin = await Drive.get({
    ...under,
    name: "base" in asked.fork ? asked.fork.base : ownDriveName(asked.fork.ownedBy),
    signal,
  });

  return { drive: await origin.fork({ name: own, signal }), at: asked.at, forked: true };
}

/**
 * The sandbox `open` answers, opened with the drive its ask names made
 * ready first (`driveFor`); `open` calls `stands` once the sandbox stands.
 * Note that a drive this call forked for a sandbox that never stood is
 * deleted again, because the caller may open the name next from another
 * origin, which a fork left behind would stand in for.
 */
async function openedWithDrive(
  ask: SandboxCreate,
  under: Under,
  signal: AbortSignal,
  open: (mounted: MountedDrive | undefined, stands: () => void) => Promise<SdkSandbox>,
): Promise<SdkSandbox> {
  const mounted =
    ask.drive === undefined ? undefined : await driveFor(ask.name, ask.drive, under, signal);

  let stood = false;

  try {
    return await open(mounted, () => {
      stood = true;
    });
  } catch (failure) {
    if (mounted?.forked === true && !stood) {
      await mounted.drive.delete({ signal }).catch(() => undefined);
    }

    throw failure;
  }
}

/** Whether a resume's failure says no sandbox stands to resume: none under the name, or one whose snapshot is gone, which a create replaces. */
function noneToResume(failure: unknown): boolean {
  if (!(failure instanceof APIError)) return false;

  return failure.response.status === NOT_FOUND_STATUS || snapshotGoneFailure(failure);
}

/**
 * Whether a sandbox stood under the name to be deleted, as one whose
 * snapshot is gone is, so a create may take its name: what the SDK's own
 * `getOrCreate` does only for the code it reads (`SNAPSHOT_GONE`). Note
 * that the sandbox's own drive is left standing, for the create to mount
 * again.
 */
async function clearedStale(name: string, under: Under, signal: AbortSignal): Promise<boolean> {
  const stale = await SdkSandbox.get({ ...under, name, resume: false, signal }).catch(
    absentIfNotFound,
  );

  if (stale === undefined) return false;
  await stale.delete({ signal }).catch(absentIfNotFound);

  return true;
}

/**
 * A create as `@vercel/sandbox` takes it: persistent, each run `SANDBOX_IDLE`
 * long, from the image or the snapshot the ask names, with the drive mounted
 * read-write at its path in the drive's own region where it opens with one,
 * as Vercel's drives must be, keeping its newest snapshot alone
 * (`KEPT_SNAPSHOTS`), on the open internet.
 */
function createParams(ask: SandboxCreate, mounted: MountedDrive | undefined) {
  return {
    ...("image" in ask.from
      ? { image: ask.from.image }
      : { source: { type: "snapshot" as const, snapshotId: ask.from.snapshotId } }),
    ...(mounted === undefined
      ? undefined
      : { mounts: { [mounted.at]: mounted.drive }, region: mounted.drive.region }),
    name: ask.name,
    persistent: true,
    tags: { ...ask.tags },
    timeout: Duration.toMillis(SANDBOX_IDLE),
    ...(ask.vcpus === undefined ? undefined : { resources: { vcpus: ask.vcpus } }),
    keepLastSnapshots: {
      count: KEPT_SNAPSHOTS.COUNT,
      expiration: Duration.toMillis(ask.snapshotLapse ?? KEPT_SNAPSHOTS.EXPIRATION),
      deleteEvicted: KEPT_SNAPSHOTS.DELETE_EVICTED,
    },
    env: { ...ask.env },
    networkPolicy: sdkPolicyOf(OPEN_INTERNET),
  };
}

/** A sandbox as the SDK's list names it. */
type ListedMetadata = Awaited<ReturnType<typeof SdkSandbox.list>>["sandboxes"][number];

/**
 * The sandbox opened with each run `SANDBOX_IDLE` long: one created with
 * another timeout, which Vercel reapplies at every resume, has it replaced,
 * so its next run opens with this one. Note that the run already up keeps
 * the end it opened with, since Vercel only lengthens a running session.
 */
async function idleTimed(sandbox: SdkSandbox, signal: AbortSignal): Promise<SdkSandbox> {
  const idle = Duration.toMillis(SANDBOX_IDLE);

  if (sandbox.timeout === undefined || sandbox.timeout === idle) return sandbox;
  await sandbox.update({ timeout: idle }, { signal });

  return sandbox;
}

/**
 * Closes every public port of a sandbox a resume woke, handed to the SDK as
 * its `onResume`. Note that Vercel keeps a sandbox's ports in its config and
 * serves them again at every resume, so without this a port opened in one
 * run would stay public in every later one.
 */
function portsClosedOnResume(signal: AbortSignal) {
  return async (resumed: SdkSandbox) => {
    if (resumed.routes.length > 0) await resumed.update({ ports: [] }, { signal });
  };
}

/**
 * How much to lengthen a running session so it ends `SANDBOX_IDLE` from now
 * (`TOUCH`); nothing where that is `TOUCH.LEAST` or less.
 */
function touchExtension(session: Session, now: number): number | undefined {
  const startedAt = (session.startedAt ?? session.createdAt).getTime();
  const endsAt = startedAt + session.timeout;

  const wanted = Math.min(
    now + Duration.toMillis(SANDBOX_IDLE),
    startedAt + Duration.toMillis(TOUCH.LONGEST_RUN),
  );

  const extension = wanted - endsAt;

  return extension > Duration.toMillis(TOUCH.LEAST) ? extension : undefined;
}

/** A listed sandbox as the package reads it. */
function listedOf(listed: ListedMetadata): ListedSandbox {
  return {
    name: listed.name,
    status: STATUS_OF_VERCEL.get(listed.status),
    running: listed.currentSessionId,
    tags: listed.tags,
    snapshotId: listed.currentSnapshotId,
    createdAt: listed.createdAt,
    timeout: listed.timeout,
    vcpus: listed.vcpus,
    expiresAt: listed.expiresAt,
  };
}

/** The public routes the sandbox's session serves, each at the address the SDK names for its port. */
function routesOf(sandbox: SdkSandbox): readonly SandboxRoute[] {
  return sandbox.routes.map(({ port }) => ({ port, url: sandbox.domain(port) }));
}

/** A sandbox the SDK answered whole, as the package reads it: the session it holds is the run it is up in now, whatever the sandbox's own record lags. */
function openedOf(sandbox: SdkSandbox): OpenedSandbox {
  const session = sandbox.currentSession();

  return {
    name: sandbox.name,
    status: STATUS_OF_VERCEL.get(session.status),
    running: session.sessionId,
    tags: sandbox.tags,
    snapshotId: sandbox.currentSnapshotId,
    createdAt: sandbox.createdAt.getTime(),
    timeout: sandbox.timeout,
    vcpus: sandbox.vcpus,
    expiresAt: sandbox.expiresAt?.getTime(),
    routes: routesOf(sandbox),
  };
}

/** What a call on a session its sandbox no longer runs answers: Vercel's not-found, as it answers a session it no longer holds. */
function sessionEnded(call: SandboxCall): Refused {
  return new Refused({ call, status: NOT_FOUND_STATUS, detail: "the session ended" });
}

/** The project and team a token names, read from its payload; Vercel verifies the token itself. */
function claimsOf(
  token: string,
): { readonly projectId: string; readonly teamId: string } | undefined {
  const payload = token.split(".")[1];

  if (payload === undefined) return undefined;
  const decoded = Result.try(() => JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));

  if (Result.isFailure(decoded)) return undefined;
  const claims = readClaims(unparsedWire(decoded.success));

  return Result.isSuccess(claims)
    ? { projectId: claims.success.project_id, teamId: claims.success.owner_id }
    : undefined;
}

/** The argv of a command as the SDK's `runCommand` takes it. */
function commandParams(ask: CommandAsk) {
  return {
    cmd: ask.command,
    args: [...ask.args],
    ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
  };
}

/** `Sandbox` over the SDK, under the token `SandboxToken` reads afresh for each call and the `fetch` `SandboxFetch` names, its PTY reached over the HTTP client given. */
function vercelSandbox(
  readToken: OidcTokenRead,
  fetch: typeof globalThis.fetch,
  client: HttpClient.HttpClient,
): SandboxService {
  /**
   * The token's credentials for the call given, which a failure to read
   * them names. Note that every call reads them, a session's too, because
   * a deployment without a token must answer unavailable rather than fall
   * into the SDK's own sign-in for a developer's terminal.
   */
  const credentials = (call: SandboxCall) =>
    Effect.gen(function* () {
      const token = yield* Effect.tryPromise({
        try: readToken,
        catch: (cause) => new Refused({ call, detail: causeDetail(cause) }),
      });

      const claims = claimsOf(token);

      if (claims === undefined) {
        return yield* new Refused({ call, detail: "a token naming no project" });
      }

      return { token, ...claims, fetch };
    });

  /** A call of the SDK's statics, under the credentials and the fetch they are made with. */
  const asked = <A>(
    call: SandboxCall,
    run: (signal: AbortSignal, under: Effect.Success<ReturnType<typeof credentials>>) => Promise<A>,
  ) => Effect.flatMap(credentials(call), (under) => sdkCall(call, (signal) => run(signal, under)));

  /** The named sandbox as it stands, without resuming it. */
  const found = (call: SandboxCall, name: string) =>
    asked(call, (signal, under) => SdkSandbox.get({ ...under, name, resume: false, signal }));

  /**
   * The target's session, looked up by the sandbox's name without resuming
   * it: the one it runs now, or for a run named, that one alone, a sandbox
   * gone or in another answering as Vercel answers a session it no longer
   * holds.
   */
  const sessionOf = (call: SandboxCall, target: SandboxTarget) =>
    Effect.flatMap(
      found(call, Predicate.isString(target) ? target : target.name).pipe(
        Effect.catchIf(isGone, () => Effect.fail(sessionEnded(call))),
      ),
      (sandbox) => {
        const current = sandbox.currentSession();

        return Predicate.isString(target) || current.sessionId === target.running
          ? Effect.succeed({ sandbox, session: current })
          : Effect.fail(sessionEnded(call));
      },
    );

  /** A call on the target's session. */
  const on = <A>(
    call: SandboxCall,
    target: SandboxTarget,
    run: (session: Session, signal: AbortSignal, sandbox: SdkSandbox) => Promise<A>,
  ) =>
    Effect.flatMap(sessionOf(call, target), ({ sandbox, session }) =>
      sdkCall(call, (signal) => run(session, signal, sandbox)),
    );

  /** A call on a command the target's session ran. */
  const onCommand = <A>(
    call: SandboxCall,
    target: SandboxTarget,
    commandId: string,
    run: (command: Awaited<ReturnType<Session["getCommand"]>>, signal: AbortSignal) => Promise<A>,
  ) =>
    on(call, target, async (session, signal) =>
      run(await session.getCommand(commandId, { signal }), signal),
    );

  /** The effect with its refusal in the package's words. */
  const said = <A>(effect: Effect.Effect<A, Refused>): Effect.Effect<A, SandboxError> =>
    Effect.mapError(effect, neutralOf);

  const listTagged = (tag: string, value: string) =>
    Effect.map(
      asked(SANDBOX_CALL.LIST, (signal, under) =>
        SdkSandbox.list({
          ...under,
          limit: SANDBOX_API.PAGE,
          // SAFETY: one tag, as the SDK's filter takes it, which its type holds only for a literal name.
          tags: { [tag]: value } as Record<"tag", string>,
          signal,
        }),
      ),
      (page) =>
        page.sandboxes
          .map(listedOf)
          .toSorted((first, second) => (second.createdAt ?? 0) - (first.createdAt ?? 0)),
    );

  return {
    listTagged: (tag, value) => said(listTagged(tag, value)),
    get: (name) =>
      said(
        found(SANDBOX_CALL.GET, name).pipe(
          Effect.map((sandbox): ListedSandbox | undefined => openedOf(sandbox)),
          Effect.catchIf(isGone, () => Effect.succeed(undefined)),
        ),
      ),
    driveStands: (name) =>
      said(
        asked(SANDBOX_CALL.DRIVE, (signal, under) => Drive.get({ ...under, name, signal })).pipe(
          Effect.as(true),
          Effect.catchIf(isGone, () => Effect.succeed(false)),
        ),
      ),
    resume: (name) =>
      said(
        Effect.map(
          asked(SANDBOX_CALL.GET, async (signal, under) =>
            idleTimed(
              await SdkSandbox.get({
                ...under,
                name,
                resume: true,
                signal,
                onResume: portsClosedOnResume(signal),
              }),
              signal,
            ),
          ),
          openedOf,
        ).pipe(Effect.withSpan("web/sandboxResume")),
      ),
    create: (ask) =>
      said(
        Effect.map(
          asked(SANDBOX_CALL.CREATE, (signal, under) =>
            openedWithDrive(ask, under, signal, async (mounted) => {
              const created = await SdkSandbox.create({
                ...under,
                ...createParams(ask, mounted),
                signal,
              });

              if (ask.user !== undefined) await madeUser(created, ask.user, signal);

              return created;
            }),
          ),
          openedOf,
        ),
      ),
    getOrCreate: (ask, onCreate) =>
      said(
        Effect.map(
          asked(SANDBOX_CALL.GET_OR_CREATE, async (signal, under) => {
            // Note that a sandbox standing under the name resumes with the drive it was created with,
            // so the drive an ask names is made ready only where none stands to resume.
            if (ask.drive !== undefined) {
              const standing = await SdkSandbox.get({
                ...under,
                name: ask.name,
                resume: true,
                signal,
                onResume: portsClosedOnResume(signal),
              }).catch((failure: unknown) => {
                if (noneToResume(failure)) return undefined;
                throw failure;
              });

              if (standing !== undefined) return await idleTimed(standing, signal);
            }

            return await openedWithDrive(ask, under, signal, async (mounted, stands) => {
              /** A sandbox this call created, set up as the ask says before it is handed back. */
              const setUp = async (created: SdkSandbox) => {
                stands();

                if (ask.user !== undefined) await madeUser(created, ask.user, signal);
                await onCreate?.(openedOf(created));
              };

              const gotOrCreated = () =>
                SdkSandbox.getOrCreate({
                  ...under,
                  ...createParams(ask, mounted),
                  resume: true,
                  signal,
                  onCreate: setUp,
                  onResume: portsClosedOnResume(signal),
                });

              try {
                const opened = await gotOrCreated().catch(async (failure: unknown) => {
                  // A sandbox standing with its snapshot gone is replaced by a fresh one under its name.
                  if (!snapshotGoneFailure(failure)) throw failure;

                  if (!(await clearedStale(ask.name, under, signal))) throw failure;

                  return await gotOrCreated();
                });

                stands();

                return await idleTimed(opened, signal);
              } catch (failure) {
                // Note that the name is taken where the SDK tried again a create whose first answer was lost, so the sandbox holding it is the one this call created, which `onCreate` never saw; a drive still attached comes with the same status, and is the create's own refusal.
                if (
                  !(failure instanceof APIError) ||
                  failure.response.status !== NAME_TAKEN_STATUS ||
                  errorCode(failure.text ?? "") === DRIVE_CODE.ATTACHED
                ) {
                  throw failure;
                }

                const joined = await SdkSandbox.get({
                  ...under,
                  name: ask.name,
                  resume: true,
                  signal,
                });

                await setUp(joined);

                return await idleTimed(joined, signal);
              }
            });
          }),
          openedOf,
        ),
      ),
    delete: (name) =>
      said(
        asked(SANDBOX_CALL.DELETE, async (signal, under) => {
          // Note that the lookup asks no resume, because a sandbox on its way out is never woken to be deleted.
          const [sandbox, own] = await Promise.all([
            SdkSandbox.get({ ...under, name, resume: false, signal }).catch(absentIfNotFound),
            Drive.get({ ...under, name: ownDriveName(name), signal }).catch(absentIfNotFound),
          ]);

          if (own !== undefined) {
            // Vercel refuses to delete a drive mounted in a running sandbox, and a stop lets go of it at once.
            const session = sandbox?.currentSession();

            if (session !== undefined && UP_STATUSES.has(STATUS_OF_VERCEL.get(session.status))) {
              await session.stop({ signal });
            }

            await own.delete({ signal });
          }

          await sandbox?.delete({ deleteOrphanSnapshots: true, signal });
        }).pipe(Effect.catchIf(isGone, () => Effect.void)),
      ),
    deleteDrive: (name) =>
      said(
        // Note that Vercel refuses a drive still mounted in a running sandbox (`DRIVE_CODE.ATTACHED`), which reads as unavailable.
        asked(SANDBOX_CALL.DRIVE, async (signal, under) => {
          const drive = await Drive.get({ ...under, name, signal }).catch(absentIfNotFound);
          await drive?.delete({ signal });
        }).pipe(Effect.catchIf(isGone, () => Effect.void)),
      ),
    stop: (target) =>
      said(
        on(SANDBOX_CALL.STOP, target, (session, signal) => session.stop({ signal })).pipe(
          Effect.asVoid,
          Effect.catchIf(isGone, () => Effect.void),
        ),
      ),
    updateTags: (name, tags) =>
      said(
        asked(SANDBOX_CALL.TAGS, async (signal, under) => {
          const sandbox = await SdkSandbox.get({ ...under, name, resume: false, signal });
          await sandbox.update({ tags: { ...tags } }, { signal });
        }),
      ),
    updatePorts: (name, ports) =>
      said(
        asked(SANDBOX_CALL.PORTS, async (signal, under) => {
          const sandbox = await SdkSandbox.get({ ...under, name, resume: false, signal });
          await sandbox.update({ ports: [...ports] }, { signal });

          return routesOf(sandbox);
        }),
      ),
    run: (target, ask) =>
      said(
        on(SANDBOX_CALL.CMD, target, async (session, signal) => {
          const finished = await session.runCommand({
            ...commandParams(ask),
            ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
            signal,
          });

          return {
            exitCode: finished.exitCode,
            stdout: await finished.stdout(),
            stderr: await finished.stderr(),
          };
        }),
      ),
    start: (target, ask) =>
      said(
        on(SANDBOX_CALL.CMD, target, async (session, signal, sandbox) => {
          // Note that a user's command is started as the SDK starts one (`asUser(...).runCommand`), which writes its `env` on `sudo`'s command line.
          const command =
            "user" in ask
              ? await sandbox.asUser(ask.user).runCommand({
                  ...commandParams(ask),
                  ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
                  detached: true,
                  stdin: true,
                  signal,
                })
              : await session.runCommand({
                  ...commandParams(ask),
                  env: { ...ask.env },
                  sudo: ask.sudo,
                  detached: true,
                  stdin: true,
                  signal,
                });

          return command.cmdId;
        }),
      ),
    writeStdin: (target, commandId, text) =>
      // Note that the SDK asks where the stdin stands first and writes from there, so a write it tries again is never taken twice.
      said(
        onCommand(SANDBOX_CALL.STDIN, target, commandId, (command, signal) =>
          command.writeStdin(text, { abortSignal: signal }),
        ),
      ),
    commandExit: (target, commandId, within = SANDBOX_API.EXIT_WAIT) =>
      said(
        onCommand(SANDBOX_CALL.CMD, target, commandId, async (command, signal) => {
          // Note that the read waits for the exit, because Vercel records an exit only once such a read has seen it.
          const finished = await command.wait({ signal });

          return finished.exitCode;
        }).pipe(
          Effect.timeoutOption(within),
          Effect.map((exit): CommandExit => (Option.isNone(exit) ? null : exit.value)),
          Effect.catchIf(sessionGone, () => Effect.succeed<CommandExit>(COMMAND_GONE)),
          // Note that a wait Vercel ended before the command did answers it with no exit, which the SDK cannot read as a finished command.
          Effect.catchIf(
            (refusal) => refusal.status !== undefined && succeeded(refusal.status),
            () => Effect.succeed<CommandExit>(null),
          ),
        ),
      ),
    commandStderrTail: (target, commandId, secrets = []) =>
      said(
        onCommand(SANDBOX_CALL.LOGS, target, commandId, (command, signal) =>
          command.stderr({ signal }),
        ).pipe(
          Effect.timeoutOption(SANDBOX_API.EXIT_WAIT),
          Effect.flatMap((stderr) =>
            Option.isNone(stderr)
              ? Effect.fail(new Refused({ call: SANDBOX_CALL.LOGS, detail: "no answer in time" }))
              : Effect.succeed(stderr.value === "" ? undefined : stderrTail(stderr.value, secrets)),
          ),
        ),
      ),
    kill: (target, commandId) =>
      said(
        onCommand(SANDBOX_CALL.KILL, target, commandId, (command, signal) =>
          command.kill("SIGTERM", { abortSignal: signal }),
        ).pipe(Effect.catchIf(sessionGone, () => Effect.void)),
      ),
    writeFiles: (target, files) =>
      said(
        on(SANDBOX_CALL.FS_WRITE, target, (session, signal) =>
          session.writeFiles(
            files.map((file) => ({ path: file.path, content: file.contents, mode: file.mode })),
            { signal },
          ),
        ),
      ),
    openInteractive: (target) =>
      said(
        Effect.gen(function* () {
          // Note that the session's own call is made, never the sandbox's, because the sandbox's resumes a stopped sandbox to open it.
          const minted = yield* on(SANDBOX_CALL.INTERACTIVE, target, (session, signal) =>
            session.openInteractive({ signal }),
          );

          if (!isSandboxShellAddress(minted.url)) {
            yield* Effect.logWarning("a minted PTY address was not on Vercel's sandbox domain");

            return yield* new Refused({ call: SANDBOX_CALL.INTERACTIVE });
          }

          return { url: minted.url, token: Redacted.make(minted.token) };
        }),
      ),
    connectPty: (shell) => openPtySocket(shell, client),
    updateNetworkPolicy: (target, policy) =>
      said(
        on(SANDBOX_CALL.NETWORK_POLICY, target, (session, signal) =>
          session.update({ networkPolicy: sdkPolicyOf(policy) }, { signal }),
        ),
      ),
    snapshot: (target, expiresAfter) =>
      said(
        on(SANDBOX_CALL.SNAPSHOT, target, async (session, signal) => {
          // Vercel's create-a-snapshot takes 0 for a snapshot that never expires.
          const expiration = Duration.isFinite(expiresAfter) ? Duration.toMillis(expiresAfter) : 0;

          return (await session.snapshot({ expiration, signal })).snapshotId;
        }),
      ),
    touch: (name) =>
      said(
        Effect.gen(function* () {
          const sandbox = yield* found(SANDBOX_CALL.TOUCH, name).pipe(
            Effect.map(Option.some),
            Effect.catchIf(isGone, () => Effect.succeed(Option.none<SdkSandbox>())),
          );

          if (Option.isNone(sandbox)) return;
          const session = sandbox.value.currentSession();

          if (STATUS_OF_VERCEL.get(session.status) !== SANDBOX_STATUS.RUNNING) return;
          const extension = touchExtension(session, yield* Clock.currentTimeMillis);

          if (extension === undefined) return;
          yield* sdkCall(SANDBOX_CALL.TOUCH, (signal) =>
            session.extendTimeout(extension, { signal }),
          ).pipe(Effect.catchIf(sessionGone, () => Effect.void));
        }),
      ),
  };
}

/** `Sandbox` as the deployment runs it: Vercel Sandbox under the function's own OIDC token, its PTY reached over the runtime's HTTP client. */
export const vercelSandboxLayer: Layer.Layer<Sandbox, never, HttpClient.HttpClient> = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    return vercelSandbox(yield* SandboxToken, yield* SandboxFetch, yield* HttpClient.HttpClient);
  }),
);
