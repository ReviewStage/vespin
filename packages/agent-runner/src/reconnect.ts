/**
 * reconnect.ts -- the wait for a provider's host to answer again after the harness gave up reaching it: what a model turn's failure says of its connection, the probe, and the backoff that asks it again.
 *
 * Each harness retries a model call it could not deliver on its own, and
 * fails the model turn once those retries run out: Claude Code with a
 * `result` whose text is the Agent SDK's connection error, Codex with a
 * `turn/completed` whose `codexErrorInfo` names a connection or a stream it
 * could not open or keep. Neither failure is the model's, a limit's, or a
 * credential's: the host was not there, and it comes back on its own once
 * the network does. So a launch that reads one keeps its harness up and
 * probes the host, a TCP connect on 443, through the `HTTPS_PROXY` where the
 * harness goes through one, since what the harness needs is the proxy's
 * answer, not the host's. The probe is asked again on a doubling wait, never
 * past its longest, for at most `RUNNER_RECONNECT.GIVE_UP_MS`
 * (`protocol.ts`), and the launch carries its turn on once a probe answers,
 * or ends failed once none has.
 */

import { connect } from "node:net";
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";
import { CODEX_ERROR_INFO, codexErrorKind, RUNNER_RECONNECT } from "./protocol.js";

/**
 * What Claude Code's `result` says when the CLI gave up reaching the API: the
 * Agent SDK's own words for a connection it could not open, one that
 * dropped, a request that timed out, and a response that never came, and
 * Node's codes where the CLI names the one it got. Every other failed
 * result, a status among them, failed for a reason no probe mends.
 */
const CLAUDE_CODE_CONNECTION_WORDS: readonly string[] = [
  "Connection error",
  "Connection lost",
  "Connection to the API was lost",
  "Connection closed before the response finished",
  "No response from API",
  "Request timed out",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
  "EPIPE",
];

/** Whether a failed Claude Code `result`, by its text and the API's status where it had one, says the CLI could not reach the API. */
export function claudeCodeConnectionLost(
  result: Readonly<{ result?: string | undefined; api_error_status?: number | null | undefined }>,
): boolean {
  // Note that a status is an answer, so a result carrying one was reached.
  if (result.api_error_status !== undefined && result.api_error_status !== null) return false;
  const said = result.result ?? "";
  return CLAUDE_CODE_CONNECTION_WORDS.some((word) => said.includes(word));
}

/** Codex's kinds for a connection or a stream it could not open or keep (`CODEX_ERROR_INFO`). */
const CODEX_CONNECTION_KINDS: ReadonlySet<string> = new Set([
  CODEX_ERROR_INFO.HTTP_CONNECTION_FAILED,
  CODEX_ERROR_INFO.RESPONSE_STREAM_CONNECTION_FAILED,
  CODEX_ERROR_INFO.RESPONSE_STREAM_DISCONNECTED,
  CODEX_ERROR_INFO.RESPONSE_TOO_MANY_FAILED_ATTEMPTS,
]);

/**
 * Whether a failed Codex turn's `codexErrorInfo` says app-server could not
 * reach its provider: one of its connection kinds with no HTTP status under
 * it, since a status is the provider's answer, a refused credential's 401
 * among them, which no probe mends.
 */
export function codexConnectionLost(info: unknown): boolean {
  const kind = codexErrorKind(info);
  if (kind === undefined || !CODEX_CONNECTION_KINDS.has(kind)) return false;
  if (typeof info !== "object" || info === null) return true;
  const detail: unknown = Object.values(info)[0];
  const status =
    typeof detail === "object" && detail !== null && "httpStatusCode" in detail
      ? detail.httpStatusCode
      : null;
  return status === null || status === undefined;
}

/** What the probe connects to: the host, or the proxy the harness goes through. */
export interface ProbeTarget {
  readonly host: string;
  readonly port: number;
}

const HTTPS_PORT = 443;
const HTTP_PORT = 80;

/** The proxy variables the harnesses and Node's fetch read, in the order the first set one wins. */
const PROXY_VARIABLES = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] as const;

/** The host of a base URL, or the name as given where it is no URL. */
export function hostOf(urlOrHost: string): string {
  try {
    return new URL(urlOrHost).hostname;
  } catch {
    return urlOrHost;
  }
}

/**
 * Where to probe for `host`: the proxy's own address where the environment
 * names one, since the harness reaches the host only through it, else the
 * host on 443.
 */
export function probeTargetOf(
  env: Readonly<Record<string, string | undefined>>,
  host: string,
): ProbeTarget {
  for (const name of PROXY_VARIABLES) {
    const proxy = env[name];
    if (proxy === undefined || proxy === "") continue;
    try {
      const url = new URL(proxy);
      const port =
        url.port === "" ? (url.protocol === "https:" ? HTTPS_PORT : HTTP_PORT) : Number(url.port);
      return { host: url.hostname, port };
    } catch {
      // A proxy that is no URL is left to the harness; the host is probed directly.
    }
  }
  return { host, port: HTTPS_PORT };
}

/** A probe the target did not answer. */
export class Unreachable extends Data.TaggedError("Unreachable")<{
  readonly target: ProbeTarget;
}> {}

/** The one door to the network for a probe, so a test hands a scripted one where production opens a socket. */
export class ProviderProbe extends Context.Service<
  ProviderProbe,
  {
    /** Connects once to the target, answering once the connection opens; fails where it is refused, unresolved, or silent past the probe's timeout. */
    readonly reach: (target: ProbeTarget) => Effect.Effect<void, Unreachable>;
  }
>()("@repo/agent-runner/ProviderProbe") {}

/** A TCP connect, closed as soon as it opens: an open socket is the whole of the answer. */
export const providerProbeLive: Layer.Layer<ProviderProbe> = Layer.succeed(ProviderProbe, {
  reach: (target) =>
    Effect.callback<void, Unreachable>((resume) => {
      const socket = connect({ host: target.host, port: target.port });
      socket.once("connect", () => {
        socket.destroy();
        resume(Effect.void);
      });
      socket.once("error", () => resume(Effect.fail(new Unreachable({ target }))));
      return Effect.sync(() => socket.destroy());
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(RUNNER_RECONNECT.PROBE_TIMEOUT_MS),
        orElse: () => Effect.fail(new Unreachable({ target })),
      }),
    ),
});

/**
 * The waits between probes: the first, doubling to the longest, for as long
 * as the bound allows in all.
 */
const PROBE_BACKOFF = Schedule.exponential(Duration.millis(RUNNER_RECONNECT.FIRST_WAIT_MS)).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.millis(RUNNER_RECONNECT.LONGEST_WAIT_MS))),
  ),
  Schedule.upTo({ duration: Duration.millis(RUNNER_RECONNECT.GIVE_UP_MS) }),
);

/**
 * Waits for the target to answer a probe: true once one does, false once the
 * bound passes with none answered.
 */
export const awaitProvider = Effect.fn("agent-runner/awaitProvider")(function* (
  target: ProbeTarget,
) {
  const probe = yield* ProviderProbe;
  return yield* probe.reach(target).pipe(
    Effect.retry({ schedule: PROBE_BACKOFF }),
    Effect.as(true),
    Effect.catchTag("Unreachable", () => Effect.succeed(false)),
  );
});
