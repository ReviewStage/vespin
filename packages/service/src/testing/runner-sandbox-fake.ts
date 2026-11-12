/**
 * runner-sandbox-fake.ts -- Vercel Sandbox's REST API as a native harness's launch reaches it, faked as a store of what it was asked for, for the suites of `coder-host/runner-sessions.ts`'s harnesses.
 *
 * It keeps every sandbox, command, stdin, upload, network policy, and run it
 * was asked for, opens and resumes sandboxes as Vercel does, and answers a
 * list and a stop only where Vercel would (`@repo/sandbox/testing`). A
 * command `@vercel/sandbox` starts as a user (`asUser`) is kept as that user's
 * command, its environment read back off `sudo`'s command line, where the SDK
 * writes it.
 * Beside it, the lines a launch reads from our store (`runner_line`),
 * read back the way a test reads a command's stdin, and stamped taken as a
 * runner's ACCEPTED would, which no fake runner posts. Synthetic team,
 * project, and tokens throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { gunzipSync } from "node:zlib";
import {
  type ClaudeCodeConfig,
  ClaudeCodeConfigSchema,
  type CodexConfig,
  CodexConfigSchema,
  type InputLine,
  InputLineSchema,
  RUNNER_ENV,
  type RunnerConfig,
  RunnerConfigSchema,
} from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import { recordNativeHanded } from "@repo/database/models/agent-store";
import { acceptRunnerLine } from "@repo/database/models/runner-line-store";
import { agentTable } from "@repo/database/schemas/agent";
import { runnerLine } from "@repo/database/schemas/runner-line";
import {
  commandAnswered,
  commandLogsStreamed,
  commandRunStreamed,
  fakeDrives,
  sandboxDeleted,
  sandboxesListed,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sandboxTagsRefusal,
  sessionAnswered,
  snapshotOf,
  vercelSandboxOver,
} from "@repo/sandbox/vercel/testing";
import type { WireValue } from "@repo/wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect, Layer, Option, Predicate, Schema } from "effect";
import { agentTag } from "../agents/agent-sandbox-open.js";
import { EXCESS_KEYS } from "../core.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

/** The user and group the image runs the API's commands as, which `@vercel/sandbox` reads off `id` before it makes a user. */
const DEFAULT_USER = "ubuntu";

/** What `@vercel/sandbox` runs to read the default user and its group. */
const DEFAULT_USER_READ = "id -un; id -gn";

export interface FakeSandbox {
  name: string;
  status: string;
  currentSessionId: string;
  tags: Record<string, string>;
  /** The image it was created from; none for one created from a snapshot. */
  image: string | undefined;
  /** The snapshot it was created from; none for one created from an image. */
  sourceSnapshotId?: string;
  deleted: boolean;
  /** The timeout each session of the sandbox opens with, as its create or a later update set it. */
  timeout: number;
  /** The timeout each session a resume opened started with, in order. */
  resumedWith: number[];
  /** Whether the snapshot the sandbox resumes from expired, so a resume is answered 410 as Vercel answers it. */
  snapshotExpired?: boolean;
  /** When the sandbox was created, as Vercel's list says it: later for each sandbox opened. */
  createdAt: number;
  /** The snapshot it resumes from, which its last snapshot made; none before one is taken. */
  currentSnapshotId?: string;
  /** What its create mounted, as the create sent it, which the drives read back (`fakeDrives`). */
  mounted?: unknown;
}

export interface FakeCommand {
  readonly id: string;
  readonly sandboxSessionId: string;
  /** The user `@vercel/sandbox` started the command as (`asUser`); none for one the API started as its own. */
  readonly user?: string;
  /** The agent the command's sandbox was tagged for as it started, whose queued lines a launch reads. */
  readonly agentId: string | undefined;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly sudo: boolean;
  /** How many network policies the API had taken as its first stdin was written, its config line, which `policyAtConfig` reads its session's from; none before that write. */
  policiesBeforeConfig?: number;
  stdin: string;
  exitCode: number | null;
  /** What the command printed on stderr, which its logs answer. */
  stderr?: string;
  /** Whether Vercel recorded the exit, which it does only once a read that waits for it saw it. */
  recorded?: boolean;
}

/** A command as a read of its exit finds it: its id, the exit it has, and whether Vercel recorded it. */
interface ReadCommand {
  readonly id: string;
  readonly exitCode: number | null;
  recorded?: boolean;
}

/**
 * A read of a command, as Vercel answers it: a plain read answers no exit
 * until a read that waits (`wait=true`) has seen the command exit, and one
 * that waits records the exit it sees. A command still running holds a
 * waiting read until the reader gives up where `hold` is set, or until the
 * command exits where `exits` tells its exits, and answers it at once with
 * no exit otherwise, as a hold past the reader's wait ends.
 */
async function commandRead(
  command: ReadCommand,
  url: URL,
  init: RequestInit,
  hold: boolean,
  exits?: EventEmitter,
): Promise<Response> {
  const waits = url.searchParams.get("wait") === "true";

  if (waits && command.exitCode === null && hold) {
    assert.ok(init.signal, "a held read needs a reader that can give up");

    if (exits === undefined) await once(init.signal, "abort");
    // Note that the wait rejects once the reader gives up, which the SDK reads as no answer.
    else await once(exits, command.id, { signal: init.signal });

    if (command.exitCode === null) throw new Error("the reader gave up");
  }

  if (waits && command.exitCode !== null) command.recorded = true;
  const sessionId = /\/sessions\/([^/]+)\//u.exec(url.pathname)?.[1] ?? "";

  return Response.json(
    commandAnswered({
      id: command.id,
      sessionId,
      exitCode: command.recorded === true ? command.exitCode : null,
    }),
  );
}

/** The files a gzipped tar holds, by path. */
function untar(archive: Uint8Array): Map<string, string> {
  const tar = gunzipSync(archive);
  const files = new Map<string, string>();
  let at = 0;

  while (at + 512 <= tar.length) {
    const name = tar
      .subarray(at, at + 100)
      .toString("utf8")
      .replace(/\0.*$/su, "");

    if (name === "") break;

    const prefix = tar
      .subarray(at + 345, at + 500)
      .toString("utf8")
      .replace(/\0.*$/su, "");

    const size = Number.parseInt(tar.subarray(at + 124, at + 136).toString("utf8"), 8);
    files.set(
      `/${prefix === "" ? "" : `${prefix}/`}${name}`,
      tar.subarray(at + 512, at + 512 + size).toString("utf8"),
    );
    at += 512 + Math.ceil(size / 512) * 512;
  }

  return files;
}

/**
 * A command `@vercel/sandbox`'s `asUser` started, as it wrote it:
 * `sudo -u <user> -- bash -c <cd and exec> bash <cwd> [env K=V…] <command> <args…>`,
 * read back as the user's command, its folder, and its environment; none for
 * a command written any other way.
 */
function asUserCommand(command: string, args: readonly string[]) {
  const [flag, user, dashes, shell, , script, , cwd, ...rest] = args;

  if (command !== "sudo" || flag !== "-u" || dashes !== "--" || shell !== "bash") return undefined;

  if (user === undefined || script === undefined || cwd === undefined) return undefined;
  const env: Record<string, string> = {};
  let at = 0;

  if (rest[0] === "env") {
    at = 1;

    for (; at < rest.length; at += 1) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su.exec(rest[at] ?? "");

      if (match === null) break;
      env[match[1] ?? ""] = match[2] ?? "";
    }
  }

  const [run = "", ...runArgs] = rest.slice(at);

  return { user, cwd, env, command: run, args: runArgs };
}

type Hooks = {
  onStart?: ((command: FakeCommand) => Promise<void>) | undefined;
  runExit?: ((args: readonly string[]) => number) | undefined;
  runStdout?: ((args: readonly string[]) => string | undefined) | undefined;
  onRun?:
    | ((
        env: Readonly<Record<string, string>>,
        command: string,
        args: readonly string[],
      ) => Promise<void>)
    | undefined;
};

type StopsAt = { call?: ((rest: string) => boolean) | undefined };

/** Vercel Sandbox's REST API, as a store of the sandboxes and commands it was asked for. */
export function runnerSandboxApi() {
  const sandboxes: FakeSandbox[] = [];

  // A drive a running sandbox mounts is one Vercel refuses to delete.
  const drives = fakeDrives((mountsIt) =>
    sandboxes.some((each) => !each.deleted && each.status === "running" && mountsIt(each.mounted)),
  );

  /** How many stdin writes with data the API refuses next, and with what status: a passing outage by default. */
  const failStdin = { remaining: 0, status: 502 };
  const commands: FakeCommand[] = [];
  const uploads: Map<string, string>[] = [];
  const policies: { readonly session: string; readonly policy: unknown }[] = [];

  const runs: {
    readonly session: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    /** How many network policies the API had taken as it ran, as a command's `policiesBefore`. */
    readonly policiesBefore: number;
  }[] = [];

  /**
   * How many reads of a command, and how many network policy updates, the
   * API refuses next. Note that each refusal is a 400 rather than a passing
   * outage's 503, because `@vercel/sandbox` tries a 5xx again on a real
   * timer, so only a status it never retries fails the call at once, as a
   * test reads it.
   */
  const failCommandReads = { remaining: 0 };
  const failPolicy = { remaining: 0 };
  /** How many network policy updates the API holds next, answering none until the caller gives up. */
  const holdPolicy = { remaining: 0 };
  /** Whether a read that waits for a running command's exit is held until the reader gives up or the command exits. */
  const waits = { hold: false };
  const exits = new EventEmitter();

  /** The command exits with the code given, unless it already ended, and a read held on it answers. */
  const exit = (command: FakeCommand, code: number) => {
    command.exitCode = command.exitCode ?? code;
    exits.emit(command.id);
  };

  /** Vercel's own idle stop, `SANDBOX_IDLE` past the last touch: every running sandbox stopped, and its commands ended. */
  const idleStop = () => {
    for (const sandbox of sandboxes.filter((each) => each.status === "running")) {
      sandbox.status = "stopped";

      for (const command of commands.filter(
        (each) => each.sandboxSessionId === sandbox.currentSessionId,
      )) {
        command.exitCode = command.exitCode ?? 143;
      }
    }
  };

  /**
   * The call to a session at which its sandbox begins to stop, as a launch's
   * end or the sweep stops it a moment before a send reaches it, by the
   * path past the session: that call and every one after it are answered
   * 422 `sandbox_stopping`, as Vercel answers them, until a resume opens the
   * sandbox's next session.
   */
  const stopsAt: StopsAt = {};
  /** How many resumes the API refuses next with 422 `sandbox_snapshotting`, as Vercel answers one while the last stop's snapshot is still being taken. */
  const snapshotting = { remaining: 0 };

  /** What a test does the moment a detached command has started, before the API answers; the exit a waited run ends on, 0 unless it says, and what it prints, nothing unless it says; and what it does as a waited run arrives, before it ends. */
  const hooks: Hooks = {};

  /** The snapshots taken, in order. */
  const snapshots: string[] = [];
  /** The snapshots that lapsed or were deleted, which a create from one is refused for. */
  const goneSnapshots = new Set<string>();
  /** The expiration each snapshot was asked with, by its id, as the API's body carried it. */
  const snapshotExpirations = new Map<string, unknown>();
  let next = 0;

  const id = (prefix: string) => {
    next += 1;

    return `${prefix}_${next}`;
  };

  /** A sandbox session's id, unique beyond this fake as Vercel's are, since a firewall's record in the suite's database is kept by it. */
  const sessionIds = randomUUID();
  const mintSession = () => id(`sbs_${sessionIds}`);

  const listed = (sandbox: FakeSandbox) => ({
    name: sandbox.name,
    status: sandbox.status,
    currentSessionId: sandbox.currentSessionId,
    tags: sandbox.tags,
    createdAt: sandbox.createdAt,
    timeout: sandbox.timeout,
    ...(sandbox.currentSnapshotId === undefined
      ? undefined
      : { currentSnapshotId: sandbox.currentSnapshotId }),
  });

  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method ?? "GET";
    assert.equal(parsed.searchParams.get("teamId"), TEAM);
    const body = async () => JSON.parse(await new Response(init.body).text());

    if (method === "POST" && path === "/api/v3/sandboxes") {
      const asked = await body();
      assert.equal(asked.projectId, PROJECT);
      assert.ok(Predicate.isBoolean(asked.persistent));

      // A name a sandbox still holds is refused, which is what makes a name a lock.
      if (sandboxes.some((each) => !each.deleted && each.name === asked.name)) {
        return Response.json({ error: { code: "conflict" } }, { status: 409 });
      }

      const tagsRefused = sandboxTagsRefusal(asked.tags);

      if (tagsRefused !== undefined) return tagsRefused;
      const mounted = drives.mountsSent(asked);

      // A drive mounted must stand, as Vercel mounts only a drive it holds.
      if (!drives.mountable(mounted)) {
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }

      const source: string | undefined = asked.source?.snapshotId;

      // A snapshot that lapsed or was deleted is refused as Vercel refuses it.
      if (source !== undefined && goneSnapshots.has(source)) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }

      const sandbox: FakeSandbox = {
        name: asked.name,
        status: "running",
        currentSessionId: mintSession(),
        tags: asked.tags,
        image: asked.image,
        ...(source === undefined ? undefined : { sourceSnapshotId: source }),
        ...(mounted === undefined ? undefined : { mounted }),
        deleted: false,
        createdAt: sandboxes.length + 1,
        timeout: asked.timeout,
        resumedWith: [],
      };

      sandboxes.push(sandbox);

      return Response.json(sandboxFound(listed(sandbox)));
    }

    if (method === "GET" && path === "/api/v2/sandboxes") {
      const refused = sandboxListRefusal(parsed);

      if (refused !== undefined) return refused;
      const [key, value] = (parsed.searchParams.get("tags") ?? "").split(":");

      const found = sandboxes.filter(
        (each) => !each.deleted && key !== undefined && each.tags[key] === value,
      );

      return Response.json(sandboxesListed(found.map(listed)));
    }

    const onDrive = await drives.answer(path, method, body);

    if (onDrive !== undefined) return onDrive;
    const named = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(path);

    if (named !== null) {
      // A name deleted and taken again is the new sandbox's, as Vercel holds one sandbox per name.
      const name = decodeURIComponent(named[1] ?? "");

      const sandbox =
        sandboxes.find((each) => !each.deleted && each.name === name) ??
        sandboxes.find((each) => each.name === name);

      if (sandbox === undefined || sandbox.deleted) return new Response(null, { status: 404 });

      if (method === "PATCH") {
        // Only the fields given change, as Vercel's update takes them.
        const asked = await body();
        const tagsRefused = sandboxTagsRefusal(asked.tags);

        if (tagsRefused !== undefined) return tagsRefused;

        if (asked.tags !== undefined) sandbox.tags = asked.tags;

        if (asked.timeout !== undefined) sandbox.timeout = asked.timeout;

        return Response.json(sandboxDeleted(listed(sandbox)));
      }

      if (method === "DELETE") {
        sandbox.deleted = true;

        return Response.json(sandboxDeleted(listed(sandbox)));
      }

      const resuming = parsed.searchParams.get("resume") === "true";

      if (resuming && sandbox.status === "stopped" && sandbox.snapshotExpired === true) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }

      if (resuming && snapshotting.remaining > 0) {
        snapshotting.remaining -= 1;

        return Response.json(
          { error: { code: "sandbox_snapshotting", message: "Sandbox is being snapshotted." } },
          { status: 422 },
        );
      }

      // A resume of a sandbox still stopping waits the stop out and opens its next session, which
      // `@vercel/sandbox`'s `withResume` relies on.
      if (resuming && (sandbox.status === "stopped" || sandbox.status === "stopping")) {
        sandbox.status = "running";
        sandbox.currentSessionId = mintSession();
        sandbox.resumedWith.push(sandbox.timeout);
      }

      return Response.json(sandboxFound(listed(sandbox)));
    }

    const session = /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(path);
    assert.ok(session !== null, `an unexpected call: ${method} ${path}`);
    const [, sessionId = "", rest = ""] = session;

    if (rest === "stop") {
      const refused = sandboxStopRefusal(init);

      if (refused !== undefined) return refused;

      for (const sandbox of sandboxes.filter((each) => each.currentSessionId === sessionId)) {
        sandbox.status = "stopped";
      }

      for (const command of commands.filter((each) => each.sandboxSessionId === sessionId)) {
        command.exitCode = command.exitCode ?? 143;
      }

      return Response.json(sessionAnswered({ id: sessionId, status: "stopped" }));
    }

    const current = sandboxes.find((each) => !each.deleted && each.currentSessionId === sessionId);

    if (current?.status === "running" && stopsAt.call?.(rest) === true) {
      stopsAt.call = undefined;
      current.status = "stopping";

      for (const command of commands.filter((each) => each.sandboxSessionId === sessionId)) {
        command.exitCode = command.exitCode ?? 143;
      }
    }

    if (current?.status === "stopping") {
      return Response.json(
        {
          error: {
            code: "sandbox_stopping",
            message: "Sandbox is stopping and no longer accepts commands.",
          },
        },
        { status: 422 },
      );
    }

    if (current?.status === "stopped") {
      return Response.json(
        {
          error: {
            code: "sandbox_stopped",
            message: "Sandbox has stopped execution and is no longer available",
          },
        },
        { status: 410 },
      );
    }

    if (rest === "snapshot") {
      // A snapshot stops the session it is taken of, so a second one asked of it is refused.
      const taking = sandboxes.find(
        (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
      );

      if (taking === undefined) return new Response(null, { status: 422 });
      const snapshot = id("snap");
      snapshots.push(snapshot);
      snapshotExpirations.set(snapshot, (await body()).expiration);
      taking.status = "stopped";
      taking.currentSnapshotId = snapshot;

      return Response.json({
        snapshot: snapshotOf({ id: snapshot, status: "created", sourceSessionId: sessionId }),
        ...sessionAnswered({ id: sessionId, status: "stopped" }),
      });
    }

    if (rest === "network-policy" && holdPolicy.remaining > 0) {
      holdPolicy.remaining -= 1;
      assert.ok(init.signal, "a held update needs a caller that can give up");
      await once(init.signal, "abort");
      throw new Error("the caller gave up");
    }

    if (rest === "network-policy" && failPolicy.remaining > 0) {
      failPolicy.remaining -= 1;

      return Response.json({ error: { code: "bad_request" } }, { status: 400 });
    }

    if (rest === "network-policy") {
      policies.push({ session: sessionId, policy: await body() });

      return Response.json(sessionAnswered({ id: sessionId, status: "running" }));
    }

    if (rest === "fs/write") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");

      // Note that an upload relayed as text through GitHub's fake is not an archive any more, and is not kept.
      if (!Predicate.isString(init.body)) {
        uploads.push(untar(new Uint8Array(await new Response(init.body).arrayBuffer())));
      }

      return Response.json({});
    }

    if (rest === "fs/mkdir") return Response.json({});

    if (rest === "cmd") {
      const asked = await body();

      if (asked.wait === true) {
        await hooks.onRun?.(asked.env ?? {}, asked.command, asked.args);
        runs.push({
          session: sessionId,
          args: asked.args,
          env: asked.env ?? {},
          policiesBefore: policies.length,
        });
        const exitCode = hooks.runExit?.(asked.args) ?? 0;

        const stdout =
          asked.args[1] === DEFAULT_USER_READ
            ? `${DEFAULT_USER}\n${DEFAULT_USER}\n`
            : (hooks.runStdout?.(asked.args) ?? "");

        return commandRunStreamed({ id: id("cmd"), sessionId }, { exitCode, stdout, stderr: "" });
      }

      assert.equal(asked.attachStdin, true);
      const asUser = asUserCommand(asked.command, asked.args);

      const command: FakeCommand = {
        id: id("cmd"),
        sandboxSessionId: sessionId,
        ...(asUser === undefined ? undefined : { user: asUser.user }),
        agentId: agentTag(
          sandboxes.find((sandbox) => sandbox.currentSessionId === sessionId)?.tags,
        ),
        command: asUser?.command ?? asked.command,
        args: asUser?.args ?? asked.args,
        cwd: asUser?.cwd ?? asked.cwd,
        env: asUser?.env ?? asked.env,
        sudo: asked.sudo,
        stdin: "",
        exitCode: null,
      };

      commands.push(command);
      await hooks.onStart?.(command);

      return Response.json(commandAnswered({ id: command.id, sessionId, exitCode: null }));
    }

    const commandCall = /^cmd\/([^/]+)(\/stdin|\/kill|\/logs)?$/u.exec(rest);
    assert.ok(commandCall !== null, `an unexpected call: ${method} ${path}`);
    const command = commands.find((each) => each.id === commandCall[1]);

    if (command === undefined) return new Response(null, { status: 404 });

    if (commandCall[2] === "/kill") {
      command.exitCode = command.exitCode ?? 143;

      return Response.json(
        commandAnswered({ id: command.id, sessionId, exitCode: command.exitCode }),
      );
    }

    if (commandCall[2] === "/logs") return commandLogsStreamed(command.stderr ?? "");

    if (commandCall[2] === "/stdin") {
      // Vercel refuses stdin to a command that already exited.
      if (command.exitCode !== null) {
        return Response.json(
          { error: { code: "command_not_found_or_exited", message: "the command exited" } },
          { status: 404 },
        );
      }

      const asked = await body();

      if (asked.data !== undefined && failStdin.remaining > 0) {
        failStdin.remaining -= 1;

        return Response.json(
          { error: { code: "stdin_refused", message: "the command's stdin was refused" } },
          { status: failStdin.status },
        );
      }

      if (asked.data !== undefined) {
        command.policiesBeforeConfig ??= policies.length;
        const bytes = Buffer.from(command.stdin, "utf8");
        const data = Buffer.from(asked.data, "base64");
        command.stdin = Buffer.concat([bytes.subarray(0, asked.offset), data]).toString("utf8");
      }

      return Response.json(
        commandAnswered(
          {
            id: command.id,
            sessionId,
            exitCode: command.recorded === true ? command.exitCode : null,
          },
          Buffer.byteLength(command.stdin),
        ),
      );
    }

    if (failCommandReads.remaining > 0) {
      failCommandReads.remaining -= 1;

      return Response.json({ error: { code: "bad_request" } }, { status: 400 });
    }

    return commandRead(command, parsed, init, waits.hold, exits);
  };

  /**
   * The network policy a command's session stood at as its config line was
   * written, before which a runner reaches nothing: the last one set for that
   * session by then, none where none was or nothing was written.
   */
  const policyAtConfig = (command: FakeCommand | undefined) =>
    command?.policiesBeforeConfig === undefined
      ? undefined
      : policies
          .slice(0, command.policiesBeforeConfig)
          .findLast((each) => each.session === command.sandboxSessionId)?.policy;

  return {
    layer: Layer.provideMerge(vercelSandboxOver(respond), fakeHttpClientLayer(respond)),
    respond,
    policyAtConfig,
    sandboxes,
    drives: drives.drives,
    mountedAt: (sandbox: FakeSandbox | undefined, at: string) =>
      drives.mountedAt(sandbox?.mounted, at),
    commands,
    snapshots,
    goneSnapshots,
    snapshotExpirations,
    uploads,
    policies,
    runs,
    failStdin,
    failCommandReads,
    failPolicy,
    holdPolicy,
    waits,
    exit,
    idleStop,
    stopsAt,
    snapshotting,
    hooks,
  };
}

const WHOLE = { onExcessProperty: EXCESS_KEYS.REFUSE } as const;
const decodeRunnerConfig = Schema.decodeUnknownSync(RunnerConfigSchema);
const decodeClaudeCodeConfig = Schema.decodeUnknownSync(ClaudeCodeConfigSchema);
const decodeCodexConfig = Schema.decodeUnknownSync(CodexConfigSchema);
const decodeInputLine = Schema.decodeUnknownSync(InputLineSchema);

/** A launch's config, of either harness, read whole: a key its schema does not name fails the read. */
export const readRunnerConfig = (input: unknown): RunnerConfig => decodeRunnerConfig(input, WHOLE);

/** A Claude Code launch's config, read whole: a key its schema does not name fails the read. */
export const readClaudeCodeConfig = (input: unknown): ClaudeCodeConfig =>
  decodeClaudeCodeConfig(input, WHOLE);

/** A Codex launch's config, read whole: a key its schema does not name fails the read. */
export const readCodexConfig = (input: unknown): CodexConfig => decodeCodexConfig(input, WHOLE);

/** A line a runner is handed, read whole: a key its schema does not name fails the read. */
export const readInputLine = (input: unknown): InputLine => decodeInputLine(input, WHOLE);

/** The lines a command's stdin holds, each read back. */
export function linesOf(command: FakeCommand | undefined): unknown[] {
  assert.ok(command !== undefined);

  return command.stdin
    .split("\n")
    .filter((text) => text !== "")
    .map((text) => JSON.parse(text));
}

/**
 * The lines a launch was handed: its config on its stdin, then each line
 * queued for it to read, in the order they were queued (`runner_line`).
 */
export const launchLines = (command: FakeCommand | undefined) =>
  Effect.gen(function* () {
    assert.ok(command?.agentId !== undefined);
    const [first, ...stdin] = linesOf(command);
    const config = readRunnerConfig(first);
    const db = yield* Database;

    const queued = yield* db
      .select({ text: runnerLine.text })
      .from(runnerLine)
      .where(
        and(eq(runnerLine.agentId, command.agentId), eq(runnerLine.launch, config.firstSequence)),
      )
      .orderBy(asc(runnerLine.seq));

    return [first, ...stdin, ...queued.map((row): WireValue => JSON.parse(row.text))];
  });

/**
 * A launch as its runner reads it: its config as `readConfig` reads it, then
 * each line it was handed (`launchLines`).
 */
export const launchRead = <Config>(
  command: FakeCommand | undefined,
  readConfig: (input: unknown) => Config,
) =>
  Effect.map(launchLines(command), ([config, ...lines]) => ({
    config: readConfig(config),
    lines: lines.map(readInputLine),
  }));

type StdinRead<Config> = { readonly config: Config; readonly lines: readonly InputLine[] };

/** A launch's stdin as its runner reads it: its config as `readConfig` reads it, then each line written after it. */
export function stdinRead<Config>(
  command: FakeCommand | undefined,
  readConfig: (input: unknown) => Config,
): StdinRead<Config> {
  const [config, ...lines] = linesOf(command);

  return { config: readConfig(config), lines: lines.map(readInputLine) };
}

/** Every message queued for the agent's runner stamped taken, what its words handed kept, as each one's ACCEPTED would, which the fake runner never posts. */
export const runnerTook = (agentId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const waiting = yield* db
      .select({
        lineId: runnerLine.lineId,
        userId: runnerLine.userId,
        conversationId: agentTable.conversationId,
      })
      .from(runnerLine)
      .innerJoin(agentTable, eq(agentTable.id, runnerLine.agentId))
      .where(and(eq(runnerLine.agentId, agentId), isNull(runnerLine.acceptedAt)))
      .orderBy(asc(runnerLine.seq));

    // Each message as its ACCEPTED takes it: stamped taken, and what its words handed kept.
    for (const line of waiting) {
      if (line.lineId === null) continue;
      const handed = yield* acceptRunnerLine(line.userId, agentId, line.lineId);

      if (Option.isSome(handed)) yield* recordNativeHanded(line, handed.value);
    }

    yield* db
      .update(runnerLine)
      .set({ acceptedAt: new Date(0) })
      .where(and(eq(runnerLine.agentId, agentId), isNull(runnerLine.acceptedAt)));
  });

/** A network policy as Vercel's API is sent one: the open internet by name, or each host's matchers and transforms. */
type SentPolicy =
  | string
  | {
      readonly allow: Readonly<
        Record<
          string,
          readonly {
            readonly match?: {
              readonly headers?: readonly {
                readonly key: { readonly exact: string };
                readonly value: { readonly exact: string };
              }[];
            };
            readonly transform: readonly { readonly headers: Readonly<Record<string, string>> }[];
          }[]
        >
      >;
    };

/**
 * The bearer a network policy swaps in on the host given for a request that
 * presents the placeholder as its bearer, as the firewall would set it on
 * the way out; none where the policy carries no such swap.
 */
function swappedBearer(
  policy: unknown,
  host: string,
  placeholder: string | undefined,
): string | undefined {
  // SAFETY: the policy is the body the API was sent, Vercel's network policy as the adapter spells it.
  const sent = policy as SentPolicy | undefined;

  if (sent === undefined || Predicate.isString(sent) || placeholder === undefined) return undefined;

  const swap = (sent.allow[host] ?? []).find((rule) =>
    (rule.match?.headers ?? []).some(
      (header) =>
        header.key.exact === "authorization" && header.value.exact === `Bearer ${placeholder}`,
    ),
  );

  const set = swap?.transform[0]?.headers.authorization;

  return set?.startsWith("Bearer ") ? set.slice("Bearer ".length) : undefined;
}

/** The bearer a launch's runner reaches the host given with: what the policy standing as its config line was written swaps in for the placeholder its environment holds. */
export function launchBearer(
  api: ReturnType<typeof runnerSandboxApi>,
  command: FakeCommand | undefined,
  host: string,
): string | undefined {
  return swappedBearer(api.policyAtConfig(command), host, command?.env[RUNNER_ENV.BEARER]);
}
