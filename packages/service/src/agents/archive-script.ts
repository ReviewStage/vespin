/**
 * archive-script.ts -- a repository's archive script, run in an archived agent's sandbox once the archive stands.
 *
 * An agent's archive lets it go (`session-sandboxes.ts`'s
 * `archivedInBackground`), and where its workspace keeps an archive script
 * for the agent's repository (Settings › Cloud environment), the sandbox runs it,
 * as the agent's own user from its checkout, with the workspace's
 * variables, typically to stop services, upload logs, or let go of what the
 * agent made outside it, such as a preview database. A sandbox only stopped,
 * as one idle for `SANDBOX_IDLE` is, runs nothing, since it is kept.
 *
 * The script is a courtesy the archive never waits on and never fails on: a
 * sandbox already gone, or one that cannot be resumed (one stopped on a drive
 * of its own, which kept no disk to resume, its snapshot gone, or a resume
 * past `ARCHIVE_SCRIPT.RESUME_TIMEOUT`), skips it, and one that runs
 * past `ARCHIVE_SCRIPT.RUN_TIMEOUT` is ended; each is said in a log line, and
 * the archive stands. What the script prints goes to the sandbox's setup log
 * (`REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG`), which the agent's Terminal
 * reads until the sandbox is released, and its stderr's tail, every
 * workspace variable's value and every token-shaped run redacted (`commandStderrTail`), to the
 * service's log with how it exited.
 */

import { AGENT_USER } from "@repo/agent-runner/pins";
import type { DatabaseServices } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import { openWorkspaceEnvironment } from "@repo/database/models/workspace-environment-store";
import { readRepositorySetup } from "@repo/database/models/workspace-sandbox-script-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { REPOSITORY_SCRIPT_KIND } from "@repo/features/workspace-sandbox-setup-wire";
import {
  COMMAND_GONE,
  type SandboxError,
  type SandboxRunning,
  type SandboxService,
  UP_STATUSES,
} from "@repo/sandbox";
import { DateTime, Duration, Effect, Option, Result, Schedule } from "effect";
import { HostedEnvironment } from "../environment.js";
import { SESSION_TAG } from "./agent-sandbox-open.js";
import { CODER } from "./coder-host/bounds.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";

/**
 * The archive script's bounds. Note that all of it runs inside the archive's
 * kept work (`SandboxDeleteReach`'s `keepAwake`), whose function Vercel ends
 * at Fluid's default of five minutes, so the resume and the script stay
 * well inside that.
 */
export const ARCHIVE_SCRIPT = {
  /** How long a stopped sandbox's resume is waited on before the script is skipped: a resume from its snapshot takes about eleven seconds (`SANDBOX_IDLE`). */
  RESUME_TIMEOUT: Duration.minutes(1),
  /** How long the script runs before it is ended, as Settings › Cloud environment says: long enough to stop services and upload logs, short enough that the delete still lands. */
  RUN_TIMEOUT: Duration.seconds(90),
  /** How often a script still running is asked again for its exit, where the provider ended a wait before it did. */
  EXIT_POLL: Duration.seconds(1),
} as const;

/** Why no run stands for the script: no sandbox, one stopped on its own drive with no disk kept, or a skip already logged. */
const ARCHIVE_SKIP = { GONE: "gone", KEPT_NO_DISK: "kept-no-disk", LOGGED: "logged" } as const;

/** Where the script is written in the sandbox, as its default user, for the run to read. */
const ARCHIVE_FILE = "/tmp/vespin-setup/archive.sh";

const SETUP_LOG = REPOSITORY_SANDBOX_CONTRACT.PATH.SETUP_LOG;

/**
 * The archive script's run, by bash as the agent's user: the script, failing
 * on its first failed command as the setup script does, its output appended
 * to the setup log under a heading of its own and copied to the command's
 * stderr for the service's log, and how it exited after. Note that the exit
 * is the script's own (`PIPESTATUS`), so a log the user may not append to
 * fails nothing.
 */
const ARCHIVE_RUN_SCRIPT = [
  `echo "--- archive script" >> ${SETUP_LOG} 2> /dev/null`,
  `bash -e -o pipefail ${ARCHIVE_FILE} 2>&1 | tee -a ${SETUP_LOG} >&2`,
  `status=\${PIPESTATUS[0]}`,
  `echo "--- exit $status" >> ${SETUP_LOG} 2> /dev/null`,
  'exit "$status"',
].join("\n");

/** How an archive script that exited ran: when it started, and its exit. */
export interface ArchiveScriptRan {
  readonly ranAt: Date;
  readonly exitCode: number;
}

/** A repository's archive script as an archive runs it: the bash, and the workspace's variables it runs with. */
export interface ArchiveScript {
  readonly script: string;
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * The workspace's variables, opened for an archive script; none in a
 * deployment with no ring, under which none could have been set, nor where
 * the caller runs without the hosted environment, as a test may.
 */
const workspaceEnvironment = (organizationId: string) =>
  Effect.gen(function* () {
    const hosted = yield* Effect.serviceOption(HostedEnvironment);
    const keys = Option.isSome(hosted) ? hosted.value.providerKeyEncryptionKeys : undefined;
    const ring = keys === undefined ? undefined : parseKeyRing(keys);

    if (ring === undefined || Result.isFailure(ring)) return {};

    return yield* openWorkspaceEnvironment(ring.success, organizationId);
  });

/**
 * The archive script the agent's sandbox runs before its delete, with the
 * workspace's variables: its repository's, where its workspace keeps one; none
 * for an agent with no repository or on a Mac, which has no sandbox to run it
 * in, nor where it could not be read, which is logged and leaves the delete
 * to go on.
 */
export const archiveScriptOf = (
  agent: Pick<Agent, "organizationId" | "repository" | "machine">,
): Effect.Effect<ArchiveScript | undefined, never, DatabaseServices> =>
  Effect.gen(function* () {
    const { repository } = agent;

    if (agent.machine !== AGENT_MACHINE.VERCEL || repository === null) return undefined;

    const saved = yield* readRepositorySetup(
      agent.organizationId,
      repository,
      REPOSITORY_SCRIPT_KIND.ARCHIVE,
    );

    if (Option.isNone(saved)) return undefined;

    return {
      script: saved.value.script,
      environment: yield* workspaceEnvironment(agent.organizationId),
    };
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`An archived agent's archive script was not read: ${failure._tag}`),
        undefined,
      ),
    ),
  );

/** The run the session's newest sandbox is up in, resumed from its snapshot where it stopped; else why there is none (`ARCHIVE_SKIP`). */
const runningOf = (api: SandboxService, sessionId: string) =>
  Effect.gen(function* () {
    const [newest] = yield* api.listTagged(SESSION_TAG, sessionId);

    if (newest === undefined) return ARCHIVE_SKIP.GONE;

    if (UP_STATUSES.has(newest.status) && newest.running !== undefined) {
      return { name: newest.name, running: newest.running } satisfies SandboxRunning;
    }

    // Note that a sandbox stopped on a drive of its own kept no disk, so it has nothing to resume, and making it again needs the agents' image, which an archive is not handed.
    if (yield* api.ownDriveStands(newest.name)) return ARCHIVE_SKIP.KEPT_NO_DISK;

    const resumed = yield* api
      .resume(newest.name)
      .pipe(Effect.timeoutOption(ARCHIVE_SCRIPT.RESUME_TIMEOUT));

    if (Option.isNone(resumed)) {
      yield* Effect.logWarning(
        "An archived agent's sandbox did not resume in time, so its archive script was skipped",
      );

      return ARCHIVE_SKIP.LOGGED;
    }

    return { name: resumed.value.name, running: resumed.value.running } satisfies SandboxRunning;
  });

/** The script's exit, asked again while it runs, for as long as `RUN_TIMEOUT`; none where it ran past that. */
const exitWithin = (api: SandboxService, place: SandboxRunning, commandId: string) =>
  api.commandExit(place, commandId, ARCHIVE_SCRIPT.RUN_TIMEOUT).pipe(
    Effect.repeat({
      schedule: Schedule.spaced(ARCHIVE_SCRIPT.EXIT_POLL),
      while: (exit) => exit === null,
    }),
    Effect.timeoutOption(ARCHIVE_SCRIPT.RUN_TIMEOUT),
  );

/**
 * The archive script run in the session's newest sandbox, as the agent's
 * user from its checkout, resumed first where it stopped, and how it ended
 * logged: its exit with its stderr's tail, redacted, or that it ran past its
 * bound and was ended, or that no sandbox stood to run it in. Answers when
 * it started and how it exited, or nothing where it did not exit. Fails only
 * where the sandbox refused a call, its snapshot gone among them, which the
 * caller logs and lets go of.
 */
export const archiveScriptRun = (
  api: SandboxService,
  sessionId: string,
  archive: ArchiveScript,
): Effect.Effect<ArchiveScriptRan | undefined, SandboxError> =>
  Effect.gen(function* () {
    const place = yield* runningOf(api, sessionId);

    if (place === ARCHIVE_SKIP.GONE) {
      yield* Effect.logInfo(
        "An archived agent's sandbox was already gone, so its archive script was skipped",
      );

      return undefined;
    }

    if (place === ARCHIVE_SKIP.KEPT_NO_DISK) {
      yield* Effect.logWarning(
        "An archived agent's sandbox had stopped on its own drive, keeping no disk to resume, so its archive script was skipped",
      );

      return undefined;
    }

    if (place === ARCHIVE_SKIP.LOGGED) return undefined;

    yield* api.writeFiles(place, [
      { path: ARCHIVE_FILE, contents: new TextEncoder().encode(archive.script), mode: 0o644 },
    ]);
    const ranAt = yield* DateTime.nowAsDate;

    const commandId = yield* api.start(place, {
      user: AGENT_USER,
      command: "bash",
      args: ["-c", ARCHIVE_RUN_SCRIPT],
      cwd: CODER.CHECKOUT_PATH,
      env: {
        HOME: `/home/${AGENT_USER}`,
        USER: AGENT_USER,
        LOGNAME: AGENT_USER,
        ...archive.environment,
      },
    });

    const exit = yield* exitWithin(api, place, commandId);

    // Note that an exit still null is one the repeat stopped asking after, which ran past its bound too.
    if (Option.isNone(exit) || exit.value === null) {
      yield* Effect.ignore(api.kill(place, commandId));
      yield* Effect.logWarning(
        `An archive script ran past ${Duration.format(ARCHIVE_SCRIPT.RUN_TIMEOUT)} and was ended`,
      );

      return undefined;
    }

    if (exit.value === COMMAND_GONE) {
      yield* Effect.logWarning("An archive script's sandbox stopped before it exited");

      return undefined;
    }

    const stderr = yield* api
      .commandStderrTail(place, commandId, Object.values(archive.environment))
      .pipe(Effect.orElseSucceed(() => undefined));

    const said = `An archive script exited ${String(exit.value)}: ${stderr ?? "nothing printed"}`;
    yield* exit.value === 0 ? Effect.logInfo(said) : Effect.logWarning(said);

    return { ranAt, exitCode: exit.value };
  }).pipe(Effect.withSpan("web/archiveScript"));
