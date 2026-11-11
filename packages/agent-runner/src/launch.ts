/**
 * launch.ts -- what every harness's launch is handed once the runner has read its config, and what it answers when it ends.
 *
 * The runner reads the bearer, the config line and the service's events route the
 * same way for either harness (`runner.ts`), then hands the rest of stdin and
 * the event sink to Claude Code's launch or Codex's (`codex.ts`). Each
 * answers why it ended once it has stopped its harness, and the runner posts
 * the launch's last event after that, so nothing the harness emits on the way
 * down is numbered after it.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Cause, Effect, Queue, Redacted } from "effect";
import { Data } from "effect";
import type { EventSink } from "./events.js";
import { SANDBOX_TOOL_ENV } from "./pins.js";
import { RUNNER_ENV, RUNNER_PLACE, type RunnerEnd } from "./protocol.js";
import type { LaunchTrace } from "./trace.js";

/** Whether the runner runs on a host its member added (`RUNNER_PLACE.HOST`), as the environment it was started with says. */
export function runsOnHost(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[RUNNER_ENV.PLACE] === RUNNER_PLACE.HOST;
}

/** The account's credentials a launch's starter may name in its environment (`RUNNER_ENV`), none of which a host's harnesses run on. */
const ACCOUNT_CREDENTIALS: readonly string[] = [
  RUNNER_ENV.CLAUDE_TOKEN,
  RUNNER_ENV.API_KEY,
  RUNNER_ENV.OPENAI_API_KEY,
];

/**
 * The environment a launch's harness is handed of the runner's own: on a
 * host without any of the account's credentials, since a host's Claude Code
 * and Codex run on the logins signed in on the machine; in the cloud's
 * sandbox as it was started.
 */
export function harnessEnvOf(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  if (!runsOnHost(env)) return env;
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !ACCOUNT_CREDENTIALS.includes(name)),
  );
}

/**
 * What every command a harness runs is handed of the machine's tools beside
 * the launch's own environment: in the cloud's sandbox the image's
 * (`SANDBOX_TOOL_ENV`); on a host nothing, since the image's would steer the
 * machine's own tools, a repository's Playwright among them, away from where
 * they keep their things.
 */
export function toolEnvOf(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return runsOnHost(env) ? {} : SANDBOX_TOOL_ENV;
}

/** Why a launch could not run at all, before or after its harness. */
export class RunnerFailed extends Data.TaggedError("RunnerFailed")<{ readonly detail: string }> {}

/** A launch whose config line never came within its bound, which exits as `RUNNER_EXIT.UNCONFIGURED`. */
export class RunnerUnconfigured extends Data.TaggedError("RunnerUnconfigured")<{
  readonly detail: string;
}> {}

/** What a harness's launch is handed. */
export interface LaunchContext<Config> {
  readonly config: Config;
  /** The service's lines after the config: stdin's, ended when the service closes stdin, and those read from the service where the config names the read (`lines.ts`). */
  readonly lines: Queue.Dequeue<string, Cause.Done>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly bearer: Redacted.Redacted;
  readonly sink: EventSink;
  /**
   * Settles only once the service will hear nothing more from the launch, its
   * post refused for good (`EventSink`'s `undelivered`), or hand it nothing
   * more, its line read refused for good (`lines.ts`), with why; the launch
   * ends as `FAILED` on it rather than stand up deaf.
   */
  readonly cutOff: Effect.Effect<string>;
  /** The launch's startup as Sentry spans, where the config handed a trace (`trace.ts`). */
  readonly trace: LaunchTrace;
}

/** Why a launch ended, and the harness's failure where it failed, for the last event. */
export interface LaunchOutcome {
  readonly end: RunnerEnd;
  readonly failure: string;
}

/**
 * The path under the installed skills' folder a config names, where the service
 * wrote it; none where the config names no folder or the member installed
 * no skills, since the service writes the folder only where there are some. Read
 * as each launch starts, so a relaunch finds what the sandbox's disk kept.
 */
export function installedSkillsPath(folder: string | undefined, entry: string): string | undefined {
  if (folder === undefined) return undefined;
  const path = join(folder, entry);
  return existsSync(path) ? path : undefined;
}
