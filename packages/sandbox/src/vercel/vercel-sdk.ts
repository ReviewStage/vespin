/**
 * vercel-sdk.ts -- every call we make of Vercel Sandbox, through `@vercel/sandbox`, under the deployment's own OIDC token.
 *
 * Everything a caller asks of a sandbox — one deleted, stopped, resumed, or
 * got or created from an image or a snapshot, a user made in it and a
 * command started as that user, a short command, a PTY, a network policy, a
 * snapshot, its tags and its public ports — it asks here, of the SDK at the
 * version the catalog pins, which loads in a function's bundle. The SDK
 * tries a 429, a 5xx, and a failure to connect again before it answers (a
 * 429 waits out Vercel's `Retry-After` up to 20 seconds), so nothing here
 * tries again.
 *
 * Every call goes under the token we read and the `fetch` `SandboxFetch`
 * names: a call on a sandbox by name, a list, and a create through the
 * SDK's statics, and the calls on a running session, and
 * on a command in it, through the session the documented way reaches it
 * (`Sandbox.get` by the sandbox's name, without resuming it, then
 * `currentSession`), looked up once and held for one operation's calls and
 * polls (`session`).
 *
 * A sandbox is found by a tag its caller gave it, whose value names few
 * sandboxes, so the first page is all of them. What is sent is a tag, a
 * name, and the argv of a command a caller wrote; what a failure carries is
 * the call that failed, its status, and Vercel's own error code and message,
 * or the cause's where Vercel never answered, every token-shaped run of it
 * redacted, and never what was sent. A deployment without an OIDC token
 * answers every call as unavailable.
 */

import { EXCESS_KEYS, unparsedWire, valueFromJsonText } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import {
  APIError,
  type Command,
  Sandbox,
  type NetworkPolicy as SdkNetworkPolicy,
  type Session,
  StreamError,
} from "@vercel/sandbox";
import { Context, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import type { OidcTokenRead } from "./oidc.js";
import {
  COMMAND_GONE,
  type CommandExit,
  type ListedSandbox,
  type NetworkPolicy,
  NOT_FOUND_STATUS,
  OPEN_INTERNET_POLICY,
  type OpenedSandbox,
  SANDBOX_CALL,
  SANDBOX_STATUS,
  type SandboxCall,
  type SandboxCreate,
  type SandboxRoute,
  type SandboxSessionApi,
  SandboxUnavailable,
  type SandboxUser,
  type SessionRef,
  type VercelSandboxApi,
} from "./vocabulary.js";

/** Vercel's answer for a create whose name another sandbox already holds. */
const NAME_TAKEN_STATUS = 409;

/**
 * Vercel's answer for a call to a session that has stopped, and the code its
 * body names: the session ended, as one its sandbox no longer runs did. Note
 * that Vercel's list may still name the sandbox running in that session.
 */
const SESSION_STOPPED = { STATUS: 410, CODE: "sandbox_stopped" } as const;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

const SANDBOX_API = {
  /**
   * A session has one sandbox, so the first page is all of them. Note that
   * the page is the API's widest, because a list asked for more is refused
   * whole (`limit`'s maximum in Vercel's REST reference is 50).
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
  [SANDBOX_CALL.LIST]: "web/sandboxList",
  [SANDBOX_CALL.DELETE]: "web/sandboxDelete",
  [SANDBOX_CALL.STOP]: "web/sandboxStop",
  [SANDBOX_CALL.SESSION]: "web/sandboxSession",
  [SANDBOX_CALL.EXTEND]: "web/sandboxExtend",
  [SANDBOX_CALL.NETWORK_POLICY]: "web/sandboxNetworkPolicy",
  [SANDBOX_CALL.INTERACTIVE]: "web/sandboxInteractive",
  [SANDBOX_CALL.SNAPSHOT]: "web/sandboxSnapshot",
  [SANDBOX_CALL.PORTS]: "web/sandboxUpdatePorts",
} as const satisfies Record<SandboxCall, string>;

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
  return capped(said.length === 0 ? typeof cause : said.join(" <- "));
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

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

/** An answer as the failure it is: the call, its status and code, and Vercel's own words, or that a 2xx could not be read. */
function refused(
  call: SandboxCall,
  answered: { readonly status: number; readonly text: string },
): SandboxUnavailable {
  const detail =
    errorDetail(answered.text) ?? (succeeded(answered.status) ? UNREADABLE_DETAIL : undefined);
  const code = errorCode(answered.text);
  return new SandboxUnavailable({
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
function sdkFailure(call: SandboxCall, cause: unknown): SandboxUnavailable {
  if (cause instanceof APIError) {
    return refused(call, { status: cause.response.status, text: cause.text ?? "" });
  }
  if (cause instanceof StreamError) {
    return new SandboxUnavailable({
      call,
      ...(ERROR_CODE.test(cause.code) ? { code: cause.code } : undefined),
      detail: capped(cause.message),
    });
  }
  return new SandboxUnavailable({ call, detail: causeDetail(cause) });
}

/** One SDK call as an effect under the call's span, its failure read as the call's; interrupting it aborts the SDK's request. */
function sdkCall<A>(
  call: SandboxCall,
  run: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, SandboxUnavailable> {
  return Effect.tryPromise({ try: run, catch: (cause) => sdkFailure(call, cause) }).pipe(
    Effect.withSpan(SANDBOX_CALL_SPAN[call]),
  );
}

/** Whether a failure is Vercel's answer that what was named is already gone. */
function isGone(failure: SandboxUnavailable): boolean {
  return failure.status === NOT_FOUND_STATUS;
}

/** Whether a call on a session failed because the session ended: gone, or stopped under it, which leaves nothing of it running. */
function sessionGone(failure: SandboxUnavailable): boolean {
  return (
    isGone(failure) ||
    (failure.status === SESSION_STOPPED.STATUS && failure.code === SESSION_STOPPED.CODE)
  );
}

/** The SDK's own name for its network policy, from ours: the open internet by name, and every rule copied, since the SDK takes them as mutable arrays. */
function sdkPolicyOf(policy: NetworkPolicy): SdkNetworkPolicy {
  if ("mode" in policy) return policy.mode;
  return {
    allow: Object.fromEntries(
      Object.entries(policy.allow).map(([host, rules]) => [
        host,
        rules.map((rule) => ({
          ...(rule.match === undefined
            ? undefined
            : {
                match: {
                  ...(rule.match.path === undefined ? undefined : { path: rule.match.path }),
                  ...(rule.match.headers === undefined
                    ? undefined
                    : { headers: [...rule.match.headers] }),
                },
              }),
          transform: rule.transform.map((each) => ({ headers: { ...each.headers } })),
        })),
      ]),
    ),
  };
}

/** The user made in the sandbox as the SDK makes one, its home's folders made and the home closed (`SandboxUser`), under the create's span. */
async function madeUser(sandbox: Sandbox, made: SandboxUser, signal: AbortSignal): Promise<void> {
  const user = await sandbox.createUser(made.name, { signal });
  const { group } = await sandbox.getDefaultUser({ signal });
  await sandbox.addUserToGroup(made.name, group, { signal });
  for (const folder of made.homeFolders) {
    await user.mkDir(folder, { signal });
  }
  const closed = await user.runCommand("chmod", ["700", user.homeDir], { signal });
  if (closed.exitCode !== 0) throw new Error(`${user.homeDir} could not be closed`);
}

/** A create as `@vercel/sandbox` takes it: persistent, from the image or the snapshot the ask names, on the open internet. */
function createParams(ask: SandboxCreate) {
  return {
    ...("image" in ask.from
      ? { image: ask.from.image }
      : { source: { type: "snapshot" as const, snapshotId: ask.from.snapshotId } }),
    name: ask.name,
    persistent: true,
    tags: { ...ask.tags },
    timeout: ask.timeoutMs,
    ...(ask.vcpus === undefined ? undefined : { resources: { vcpus: ask.vcpus } }),
    keepLastSnapshots: { ...ask.keepLastSnapshots },
    env: { ...ask.env },
    networkPolicy: sdkPolicyOf(OPEN_INTERNET_POLICY),
  };
}

/** A sandbox as the SDK's list names it. */
type ListedMetadata = Awaited<ReturnType<typeof Sandbox.list>>["sandboxes"][number];

/** A listed sandbox as we read it. */
function listedOf(listed: ListedMetadata): ListedSandbox {
  return {
    name: listed.name,
    status: listed.status,
    currentSessionId: listed.currentSessionId,
    tags: listed.tags,
    currentSnapshotId: listed.currentSnapshotId,
    createdAt: listed.createdAt,
    timeout: listed.timeout,
    vcpus: listed.vcpus,
    expiresAt: listed.expiresAt,
    keepLastSnapshots: listed.keepLastSnapshots,
  };
}

/** The public routes the sandbox's session serves, each at the address the SDK names for its port. */
function routesOf(sandbox: Sandbox): readonly SandboxRoute[] {
  return sandbox.routes.map(({ port }) => ({ port, url: sandbox.domain(port) }));
}

/** A sandbox the SDK answered whole, as we read it: the session it holds is the one running now, whatever the sandbox's own record lags. */
function openedOf(sandbox: Sandbox): OpenedSandbox {
  const session = sandbox.currentSession();
  return {
    name: sandbox.name,
    status: session.status,
    currentSessionId: session.sessionId,
    tags: sandbox.tags,
    currentSnapshotId: sandbox.currentSnapshotId,
    createdAt: sandbox.createdAt.getTime(),
    timeout: sandbox.timeout,
    vcpus: sandbox.vcpus,
    expiresAt: sandbox.expiresAt?.getTime(),
    keepLastSnapshots: sandbox.keepLastSnapshots,
    routes: routesOf(sandbox),
  };
}

/**
 * The fetch given, sending a list with Vercel's own filter to running
 * sandboxes. Note that the filter is added here, because the SDK's list
 * forwards no status, and the sweeps read a bounded number of pages of the
 * running sandboxes, which stopped ones listed beside them would crowd out
 * (https://vercel.com/docs/rest-api/sandboxes/list-sandboxes takes `status`
 * under a sort by creation).
 */
function runningOnly(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    url.searchParams.set("status", SANDBOX_STATUS.RUNNING);
    return fetch(url, init);
  };
}

/** What a call on a session its sandbox no longer runs answers: Vercel's not-found, as it answers a session it no longer holds. */
function sessionEnded(call: SandboxCall): SandboxUnavailable {
  return new SandboxUnavailable({ call, status: NOT_FOUND_STATUS, detail: "the session ended" });
}

/**
 * The calls on a sandbox's session through the SDK's handle on it, where the
 * sandbox still runs it, holding each command it starts or reads for the
 * operation's later calls on it, so a launch's start, stdin, and kill look
 * nothing up again.
 */
function sessionCallsOf(current: Option.Option<Session>): SandboxSessionApi {
  const commands = new Map<string, Command>();
  const on = <A>(
    call: SandboxCall,
    run: (session: Session, signal: AbortSignal) => Promise<A>,
  ): Effect.Effect<A, SandboxUnavailable> =>
    Option.match(current, {
      onNone: () => Effect.fail(sessionEnded(call)),
      onSome: (session) => sdkCall(call, (signal) => run(session, signal)),
    });
  const held = (command: Command) =>
    Effect.sync(() => {
      commands.set(command.cmdId, command);
    });
  const onCommand = <A>(
    call: SandboxCall,
    commandId: string,
    run: (command: Command, signal: AbortSignal) => Promise<A>,
  ) =>
    Effect.suspend(() => {
      const known = commands.get(commandId);
      return known === undefined
        ? Effect.tap(
            on(call, (session, signal) => session.getCommand(commandId, { signal })),
            held,
          )
        : Effect.succeed(known);
    }).pipe(Effect.flatMap((command) => sdkCall(call, (signal) => run(command, signal))));
  return {
    run: (ask) =>
      on(SANDBOX_CALL.CMD, async (session, signal) => {
        const finished = await session.runCommand({
          cmd: ask.command,
          args: [...ask.args],
          ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
          ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
          signal,
        });
        return {
          exitCode: finished.exitCode,
          stdout: await finished.stdout(),
          stderr: await finished.stderr(),
        };
      }),
    openInteractive: () =>
      Effect.gen(function* () {
        // Note that the session's own call is made, never the sandbox's, because the sandbox's resumes a stopped sandbox to open it.
        const minted = yield* on(SANDBOX_CALL.INTERACTIVE, (session, signal) =>
          session.openInteractive({ signal }),
        );
        if (!isSandboxShellAddress(minted.url)) {
          yield* Effect.logWarning("a minted PTY address was not on Vercel's sandbox domain");
          return yield* new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE });
        }
        return { url: minted.url, token: Redacted.make(minted.token) };
      }),
    stop: () =>
      on(SANDBOX_CALL.STOP, (session, signal) => session.stop({ signal })).pipe(
        Effect.asVoid,
        Effect.catchIf(isGone, () => Effect.void),
      ),
    extendTimeout: (durationMs) =>
      on(SANDBOX_CALL.EXTEND, (session, signal) => session.extendTimeout(durationMs, { signal })),
    snapshot: (expiresAfter) =>
      on(SANDBOX_CALL.SNAPSHOT, async (session, signal) => {
        // Vercel's create-a-snapshot takes 0 for a snapshot that never expires.
        const expiration = Duration.isFinite(expiresAfter) ? Duration.toMillis(expiresAfter) : 0;
        return (await session.snapshot({ expiration, signal })).snapshotId;
      }),
    writeFiles: (files) =>
      on(SANDBOX_CALL.FS_WRITE, (session, signal) =>
        session.writeFiles(
          files.map((file) => ({ path: file.path, content: file.contents, mode: file.mode })),
          { signal },
        ),
      ),
    updateNetworkPolicy: (policy) =>
      on(SANDBOX_CALL.NETWORK_POLICY, (session, signal) =>
        session.update({ networkPolicy: sdkPolicyOf(policy) }, { signal }),
      ),
    start: (ask) =>
      on(SANDBOX_CALL.CMD, (session, signal) =>
        session.runCommand({
          cmd: ask.command,
          args: [...ask.args],
          ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
          env: { ...ask.env },
          sudo: ask.sudo,
          detached: true,
          stdin: true,
          signal,
        }),
      ).pipe(
        Effect.tap(held),
        Effect.map((command) => command.cmdId),
      ),
    writeStdin: (commandId, text) =>
      // Note that the SDK asks where the stdin stands first and writes from there, so a write it tries again is never taken twice.
      onCommand(SANDBOX_CALL.STDIN, commandId, (command, signal) =>
        command.writeStdin(text, { abortSignal: signal }),
      ),
    commandExit: (commandId, within = SANDBOX_API.EXIT_WAIT) =>
      onCommand(SANDBOX_CALL.CMD, commandId, async (command, signal) => {
        // Note that the read waits for the exit, because Vercel records an exit only once such a read has seen it.
        const finished = await command.wait({ signal });
        return finished.exitCode;
      }).pipe(
        Effect.timeoutOption(within),
        Effect.map((exit): CommandExit => (Option.isNone(exit) ? null : exit.value)),
        Effect.catchIf(sessionGone, () => Effect.succeed<CommandExit>(COMMAND_GONE)),
        // Note that a wait Vercel ended before the command did answers it with no exit, which the SDK cannot read as a finished command.
        Effect.catchIf(
          (failure) => failure.status !== undefined && succeeded(failure.status),
          () => Effect.succeed<CommandExit>(null),
        ),
      ),
    commandStderrTail: (commandId, secrets = []) =>
      onCommand(SANDBOX_CALL.LOGS, commandId, (command, signal) => command.stderr({ signal })).pipe(
        Effect.timeoutOption(SANDBOX_API.EXIT_WAIT),
        Effect.flatMap((stderr) =>
          Option.isNone(stderr)
            ? Effect.fail(
                new SandboxUnavailable({ call: SANDBOX_CALL.LOGS, detail: "no answer in time" }),
              )
            : Effect.succeed(stderr.value === "" ? undefined : stderrTail(stderr.value, secrets)),
        ),
      ),
    kill: (commandId) =>
      onCommand(SANDBOX_CALL.KILL, commandId, (command, signal) =>
        command.kill("SIGTERM", { abortSignal: signal }),
      ).pipe(Effect.catchIf(sessionGone, () => Effect.void)),
  };
}

/**
 * The session named, looked up at its first use and held for every later
 * one: what an operation hands its calls where none of them is the one
 * place to look it up first. A lookup that fails is not held, so the next
 * call asks again.
 */
export function sessionOnFirstUse(
  api: VercelSandboxApi,
  ref: SessionRef,
): Effect.Effect<SandboxSessionApi, SandboxUnavailable> {
  let held: SandboxSessionApi | undefined;
  return Effect.suspend(() =>
    held === undefined
      ? Effect.tap(api.session(ref), (session) =>
          Effect.sync(() => {
            held = session;
          }),
        )
      : Effect.succeed(held),
  );
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

/** The API under the token the reader hands, read afresh for each call, sending its static calls on the `SandboxFetch` it is built under. */
export function vercelSandboxApi(readToken: OidcTokenRead): Effect.Effect<VercelSandboxApi> {
  return Effect.map(Effect.service(SandboxFetch), (fetch) => {
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
          catch: (cause) => new SandboxUnavailable({ call, detail: causeDetail(cause) }),
        });
        const claims = claimsOf(token);
        if (claims === undefined) {
          return yield* new SandboxUnavailable({ call, detail: "a token naming no project" });
        }
        return { token, ...claims, fetch };
      });

    /** A call of the SDK's statics, under the credentials and the fetch they are made with. */
    const asked = <A>(
      call: SandboxCall,
      run: (
        signal: AbortSignal,
        under: Effect.Success<ReturnType<typeof credentials>>,
      ) => Promise<A>,
    ) =>
      Effect.flatMap(credentials(call), (under) => sdkCall(call, (signal) => run(signal, under)));

    /** The named sandbox as it stands, without resuming it. */
    const found = (call: SandboxCall, name: string) =>
      asked(call, (signal, under) => Sandbox.get({ ...under, name, resume: false, signal }));

    /** The named sandbox's configuration updated, without resuming it. */
    const updated = (call: SandboxCall, name: string, update: Parameters<Sandbox["update"]>[0]) =>
      asked(call, async (signal, under) => {
        const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
        await sandbox.update(update, { signal });
      });

    const resume = (name: string) =>
      Effect.map(
        asked(SANDBOX_CALL.GET, (signal, under) =>
          Sandbox.get({ ...under, name, resume: true, signal }),
        ),
        openedOf,
      ).pipe(Effect.withSpan("web/sandboxResume"));

    const listCarrying = (tag: string, value: string) =>
      Effect.map(
        asked(SANDBOX_CALL.LIST, (signal, under) =>
          Sandbox.list({
            ...under,
            limit: SANDBOX_API.PAGE,
            // SAFETY: one tag, as the SDK's filter takes it, which its type holds only for a literal name.
            tags: { [tag]: value } as Record<"tag", string>,
            signal,
          }),
        ),
        (page) => page.sandboxes.map(listedOf),
      );

    return {
      listTagged: (tag, value) =>
        Effect.map(listCarrying(tag, value), (listed) =>
          listed.toSorted((first, second) => (second.createdAt ?? 0) - (first.createdAt ?? 0)),
        ),
      listCarrying,
      listRunning: (cursor, order) =>
        Effect.map(
          asked(SANDBOX_CALL.LIST, (signal, under) =>
            Sandbox.list({
              ...under,
              fetch: runningOnly(under.fetch),
              limit: SANDBOX_API.PAGE,
              // Note that the API takes a status filter only under a sort by creation; its cursor is opaque, the `pagination.next` of the page before.
              sortBy: "createdAt",
              sortOrder: order,
              ...(cursor === undefined ? undefined : { cursor }),
              signal,
            }),
          ),
          (page) => ({
            sandboxes: page.sandboxes.map(listedOf),
            next: page.pagination.next ?? undefined,
          }),
        ),
      resume,
      deleteSandbox: (name) =>
        asked(SANDBOX_CALL.DELETE, async (signal, under) => {
          // Note that the lookup asks no resume, because a sandbox on its way out is never woken to be deleted.
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          await sandbox.delete({ deleteOrphanSnapshots: true, signal });
        }).pipe(Effect.catchIf(isGone, () => Effect.void)),
      session: (ref) =>
        found(SANDBOX_CALL.SESSION, ref.name).pipe(
          Effect.map((sandbox) => {
            const current = sandbox.currentSession();
            return current.sessionId === ref.sessionId
              ? Option.some(current)
              : Option.none<Session>();
          }),
          Effect.catchIf(isGone, () => Effect.succeed(Option.none<Session>())),
          Effect.map(sessionCallsOf),
        ),
      create: (ask) =>
        Effect.map(
          asked(SANDBOX_CALL.CREATE, (signal, under) =>
            Sandbox.create({ ...under, ...createParams(ask), signal }),
          ),
          openedOf,
        ),
      getOrCreate: (ask, onCreate) =>
        Effect.map(
          asked(SANDBOX_CALL.GET_OR_CREATE, async (signal, under) => {
            /** A sandbox this call created, set up as the ask says before it is handed back. */
            const setUp = async (created: Sandbox) => {
              if (ask.user !== undefined) await madeUser(created, ask.user, signal);
              await onCreate?.(openedOf(created));
            };
            try {
              return await Sandbox.getOrCreate({
                ...under,
                ...createParams(ask),
                resume: true,
                signal,
                onCreate: setUp,
              });
            } catch (failure) {
              // Note that the name is taken where the SDK tried again a create whose first answer was lost, so the sandbox holding it is the one this call created, which `onCreate` never saw.
              if (!(failure instanceof APIError) || failure.response.status !== NAME_TAKEN_STATUS) {
                throw failure;
              }
              const joined = await Sandbox.get({ ...under, name: ask.name, resume: true, signal });
              await setUp(joined);
              return joined;
            }
          }),
          openedOf,
        ),
      startAsUser: (name, username, ask) =>
        asked(SANDBOX_CALL.CMD, async (signal, under) => {
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          const command = await sandbox.asUser(username).runCommand({
            cmd: ask.command,
            args: [...ask.args],
            ...(ask.cwd === undefined ? undefined : { cwd: ask.cwd }),
            ...(ask.env === undefined ? undefined : { env: { ...ask.env } }),
            detached: true,
            stdin: true,
            signal,
          });
          return command.cmdId;
        }),
      getNamed: (name) =>
        found(SANDBOX_CALL.GET, name).pipe(
          Effect.map((sandbox): ListedSandbox | undefined => openedOf(sandbox)),
          Effect.catchIf(isGone, () => Effect.succeed(undefined)),
        ),
      updateTags: (name, tags) => updated(SANDBOX_CALL.TAGS, name, { tags: { ...tags } }),
      updatePorts: (name, ports, tags) =>
        asked(SANDBOX_CALL.PORTS, async (signal, under) => {
          const sandbox = await Sandbox.get({ ...under, name, resume: false, signal });
          await sandbox.update({ ports: [...ports], tags: { ...tags } }, { signal });
          return routesOf(sandbox);
        }),
    };
  });
}
