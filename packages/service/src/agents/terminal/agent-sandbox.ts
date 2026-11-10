/**
 * agent-sandbox.ts -- a coding agent's sandbox as its Terminal tab reaches it: where it stands, its shells, and the developer's resume.
 *
 * The sandbox is found by the session the agent runs in, after which it is
 * named (`../agent-sandbox-open.ts`'s `agentSandboxOf`). Where it stands is
 * read and never changed by a read: a stopped sandbox stays stopped until
 * the developer's resume, which opens it as the agent's next turn does,
 * through the same `getOrCreate` (`reopenedOf`): the one standing under its
 * session's name is resumed, or made again from the image, with the tags
 * and the size it stood with, where its snapshot is gone; a legacy one,
 * opened under a UUID, is moved to its session's name from its last
 * snapshot. A shell is started, named,
 * and ended by a short tmux command run in the sandbox's running session
 * (`tmux.ts`), and the list is
 * read back from tmux, so it is whatever the sandbox holds now. A shell
 * starts only in a running sandbox; asked of any other, the service answers
 * where the sandbox stands instead.
 *
 * The ports a server listens on are read the same way, from the kernel's
 * socket tables in the running session (`listening-ports.ts`), and never
 * from a sandbox that is not running. One of them may be shared, the
 * sandbox's own route to a relay in front of that port
 * (`preview-relay.ts`), opened only on a
 * running sandbox and living only while it runs; sharing never keeps the
 * sandbox up. Closing the share closes its route whatever the sandbox
 * stands, and the share is read back from the sandbox's routes alone.
 *
 * The GitHub credential the firewall carries for the agent is set here in
 * the shape its own session and a copy of its work set it
 * (`../sandbox-firewall.ts`): an installation token on GitHub's two hosts,
 * or a member's own classic token on the agent's one repository's git and
 * REST paths alone. The swaps of a launch running there stay, since every write composes the
 * session's whole policy with them.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { ListeningPortsAnswer } from "@repo/features/listening-ports-wire";
import {
  SANDBOX_STATE,
  type SandboxState,
  type TerminalSummary,
  type TerminalsAnswer,
} from "@repo/features/terminal-wire";
import {
  type InteractiveShell,
  type ListedSandbox,
  SANDBOX_CALL,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxError,
  type SandboxRunning,
  type SandboxService,
  SandboxUnavailable,
} from "@repo/sandbox";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import { agentSandboxOf, openAgentSandboxPromptly, reopenedOf } from "../agent-sandbox-open.js";
import { AgentImage, type AgentImageService } from "../coder-host/agent-image.js";
import {
  type FirewallSession,
  type RepositoryCredential,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import { listeningPortsOf, readSocketTables } from "./listening-ports.js";
import {
  FORGET_RECORD,
  READ_RECORD,
  recordingRelay,
  relayable,
  relayPortOf,
  restoringRelay,
  STOP_RELAY,
  sharedPortOf,
} from "./preview-relay.js";
import {
  holdsTerminal,
  killTerminal,
  listTerminals,
  renameTerminal,
  startTerminal,
  TMUX_EXIT,
  terminalsOf,
} from "./tmux.js";

/** A sandbox's statuses, read as the tab reads them; one the provider named none of reads as stopped. */
const STATE_OF_STATUS = new Map<string | undefined, SandboxState>([
  [SANDBOX_STATUS.RUNNING, SANDBOX_STATE.RUNNING],
  [SANDBOX_STATUS.STARTING, SANDBOX_STATE.STARTING],
  [SANDBOX_STATUS.STOPPING, SANDBOX_STATE.STOPPED],
  [SANDBOX_STATUS.STOPPED, SANDBOX_STATE.STOPPED],
]);

/** Why a shell could not be had: the sandbox is not running, as it stands, or the shell named is not there. */
export const SHELL_REFUSAL = {
  NOT_RUNNING: "not-running",
  NOT_FOUND: "not-found",
} as const;

export type ShellRefusal =
  | { readonly kind: typeof SHELL_REFUSAL.NOT_RUNNING; readonly sandbox: SandboxState }
  | { readonly kind: typeof SHELL_REFUSAL.NOT_FOUND };

type ShellEffect<A> = Effect.Effect<Result.Result<A, ShellRefusal>, SandboxError>;

/** What an attach finds: a running sandbox's PTY, minted for one connection, with the sandbox's name and its session, where the sandbox stands instead, or no such shell in it. */
type SandboxAttach =
  | {
      readonly state: typeof SANDBOX_STATE.RUNNING;
      readonly sandboxName: string;
      readonly sandboxSessionId: string;
      readonly shell: InteractiveShell;
    }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING }
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly gone: true };

/** What an open finds: a running sandbox's PTY, minted for one connection, or where the sandbox stands instead. */
export type SandboxOpen =
  | { readonly state: typeof SANDBOX_STATE.RUNNING; readonly shell: InteractiveShell }
  | { readonly state: typeof SANDBOX_STATE.STOPPED | typeof SANDBOX_STATE.STARTING };

/** Where a shared port's preview stands for a visit (`AgentSandboxService.preview`). */
export const PREVIEW_STANDING = { READY: "ready", WAKING: "waking", NONE: "none" } as const;

export type PreviewStanding =
  | { readonly kind: typeof PREVIEW_STANDING.READY; readonly url: string; readonly name: string }
  | { readonly kind: typeof PREVIEW_STANDING.WAKING; readonly state: SandboxState }
  | { readonly kind: typeof PREVIEW_STANDING.NONE };

export interface AgentSandboxService {
  /** The agent's shells and where its sandbox stands; none while it is not running. */
  readonly terminals: (sessionId: string) => Effect.Effect<TerminalsAnswer, SandboxError>;
  /** Whether the agent's sandbox is running, and the ports a server listens on in it; none while it is not running, which a read never changes. */
  readonly listeningPorts: (sessionId: string) => Effect.Effect<ListeningPortsAnswer, SandboxError>;
  /** The port shared by a public link from the agent's running sandbox, replacing any before, answering the link; none where it is not running, which a share never changes. */
  readonly share: (
    sessionId: string,
    port: number,
  ) => Effect.Effect<string | undefined, SandboxError>;
  /** The agent's shared port's link closed; a sandbox never opened has none. */
  readonly unshare: (sessionId: string) => Effect.Effect<void, SandboxError>;
  /** The port the agent's running sandbox shares now and its link; none while it is not running. */
  readonly shared: (
    sessionId: string,
  ) => Effect.Effect<{ readonly port: number; readonly url: string } | null, SandboxError>;
  /**
   * The agent's shared port as a preview visit finds it: its link where the
   * sandbox runs and shares it, waking where it is not running yet, and none
   * where nothing was shared. A running sandbox whose share a wake closed is
   * shared again from its record, the port's server started again where
   * none listens (`preview-relay.ts`); a stopped one is left for the caller
   * to resume.
   */
  readonly preview: (sessionId: string) => Effect.Effect<PreviewStanding, SandboxError>;
  /** A new shell in the agent's running sandbox, under the id given, named where the developer named it. */
  readonly start: (
    sessionId: string,
    terminalId: string,
    title: string | undefined,
  ) => ShellEffect<TerminalSummary>;
  /** A shell named anew. */
  readonly rename: (sessionId: string, terminalId: string, title: string) => ShellEffect<void>;
  /** A shell ended, with whatever it ran. */
  readonly kill: (sessionId: string, terminalId: string) => ShellEffect<void>;
  /** The agent's sandbox opened again, as its next turn opens it, answering where it stands after; one never opened stays starting, as does one made again on an image still being prepared, opened after the answer. */
  readonly resume: (sessionId: string) => Effect.Effect<SandboxState, SandboxError>;
  /** A connection to the running sandbox's PTY, or where the sandbox stands; a stopped sandbox is never woken here. */
  readonly attach: (
    sessionId: string,
    terminalId: string,
  ) => Effect.Effect<SandboxAttach, SandboxError>;
  /** A PTY minted on the running sandbox for a command of the caller's own, or where the sandbox stands; a stopped sandbox is never woken here. */
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxError>;
  /**
   * A fresh credential set at the running sandbox session's firewall, in the
   * shape the agent's own session sets it, so the shell reaches GitHub as
   * the agent does and never holds the token's bytes; the session is named
   * with the account whose agent it is.
   */
  readonly setCredential: (
    session: FirewallSession,
    credential: RepositoryCredential,
  ) => Effect.Effect<void, SandboxError>;
}

export class AgentSandbox extends Context.Service<AgentSandbox, AgentSandboxService>()(
  "AgentSandbox",
) {}

/** Where a listed sandbox stands; none listed is one the agent has not opened yet. */
function stateOf(sandbox: ListedSandbox | undefined): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.STARTING;
  return STATE_OF_STATUS.get(sandbox.status) ?? SANDBOX_STATE.STOPPED;
}

/** The service over `Sandbox`, the store its firewall's launch is read from, and the agents' image a sandbox is made again from. */
const PreviewRecordJson = Schema.fromJsonString(Schema.Struct({ port: Schema.Int }));

/** The port a preview's record names, where the sandbox holds one. */
function recordedPortOf(record: string): number | undefined {
  const read = Schema.decodeUnknownOption(PreviewRecordJson)(record);
  return Option.isSome(read) ? read.value.port : undefined;
}

function agentSandboxOver(
  api: SandboxService,
  context: Context.Context<DatabaseServices>,
  image: AgentImageService,
): AgentSandboxService {
  const firewall = sandboxFirewall(api);
  /**
   * The session's sandbox, where it stands, and while it is up the run a
   * command goes to, fenced to it for the operation's every call.
   */
  const standing = (sessionId: string) =>
    Effect.gen(function* () {
      const sandbox = yield* agentSandboxOf(api, sessionId);
      const state = stateOf(sandbox);
      const sandboxSessionId = state === SANDBOX_STATE.RUNNING ? sandbox?.running : undefined;
      const running: SandboxRunning | undefined =
        sandbox === undefined || sandboxSessionId === undefined
          ? undefined
          : { name: sandbox.name, running: sandboxSessionId };
      return { sandbox, state, sandboxSessionId, running };
    });

  /** A command run in the running sandbox; a sandbox not running is refused as it stands. */
  const inRunning = <A>(
    sessionId: string,
    then: (running: SandboxRunning) => Effect.Effect<Result.Result<A, ShellRefusal>, SandboxError>,
  ): ShellEffect<A> =>
    Effect.flatMap(standing(sessionId), ({ state, running }) =>
      running === undefined
        ? Effect.succeed(Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: state }))
        : then(running),
    );

  /** A command that names one shell: its nonzero exit is a shell that is not there. */
  const onShell = (sessionId: string, ask: ReturnType<typeof renameTerminal>): ShellEffect<void> =>
    inRunning(sessionId, (running) =>
      Effect.map(api.run(running, ask), (run) =>
        run.exitCode === 0
          ? Result.succeed(undefined)
          : Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND }),
      ),
    );

  return {
    terminals: (sessionId) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) return { sandbox: state, terminals: [] };
        const listed = terminalsOf(yield* api.run(running, listTerminals()));
        // A list tmux could not give is an outage, never a sandbox with no shells.
        if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { sandbox: state, terminals: listed };
      }),
    listeningPorts: (sessionId) =>
      Effect.gen(function* () {
        const { running } = yield* standing(sessionId);
        if (running === undefined) return { running: false, ports: [], labels: [] };
        const listed = listeningPortsOf(yield* api.run(running, readSocketTables()));
        // Tables the kernel could not be read for are an outage, never a sandbox with no servers.
        if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
        return { running: true, ...listed };
      }),
    share: (sessionId, port) =>
      Effect.gen(function* () {
        const { sandbox, running } = yield* standing(sessionId);
        if (sandbox === undefined || running === undefined) return undefined;
        // The route serves the port's relay, which hands the port each request as if from its own loopback.
        const served = relayable(port) ? relayPortOf(port) : port;
        yield* api.run(running, STOP_RELAY);
        if (served !== port) yield* api.start(running, recordingRelay(port));
        const route = (yield* api.updatePorts(sandbox.name, [served])).find(
          (each) => each.port === served,
        );
        if (route === undefined) {
          return yield* new SandboxUnavailable({ call: SANDBOX_CALL.PORTS, detail: "no route" });
        }
        return route.url;
      }),
    unshare: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, running } = yield* standing(sessionId);
        if (running !== undefined) {
          yield* api.run(running, STOP_RELAY);
          yield* api.run(running, FORGET_RECORD);
        }
        if (sandbox !== undefined) yield* api.updatePorts(sandbox.name, []);
      }),
    preview: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state, running } = yield* standing(sessionId);
        if (sandbox === undefined) return { kind: PREVIEW_STANDING.NONE };
        if (running === undefined) return { kind: PREVIEW_STANDING.WAKING, state };
        const route = (yield* api.get(sandbox.name))?.routes?.[0];
        if (route !== undefined) {
          return { kind: PREVIEW_STANDING.READY, url: route.url, name: sandbox.name };
        }
        // A resume closes every route, so a share the sandbox stopped under comes back from its record.
        const port = recordedPortOf((yield* api.run(running, READ_RECORD)).stdout);
        if (port === undefined || !relayable(port)) return { kind: PREVIEW_STANDING.NONE };
        yield* api.start(running, restoringRelay());
        yield* api.updatePorts(sandbox.name, [relayPortOf(port)]);
        // Note that the relay it just started may not listen yet, so this visit waits and the next one goes through.
        return { kind: PREVIEW_STANDING.WAKING, state };
      }),
    shared: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, running } = yield* standing(sessionId);
        if (sandbox === undefined || running === undefined) return null;
        const route = (yield* api.get(sandbox.name))?.routes?.[0];
        return route === undefined ? null : { port: sharedPortOf(route.port), url: route.url };
      }),
    start: (sessionId, terminalId, title) =>
      inRunning(sessionId, (running) =>
        Effect.gen(function* () {
          const started = yield* api.run(running, startTerminal(terminalId, title));
          // A shell tmux could not start, or could not list once started, is an outage: the id is the service's own, so it names nothing missing.
          if (started.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
          const listed = terminalsOf(yield* api.run(running, listTerminals()));
          if (listed === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
          const shell = listed.find((terminal) => terminal.id === terminalId);
          return shell === undefined
            ? Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND })
            : Result.succeed(shell);
        }),
      ),
    rename: (sessionId, terminalId, title) => onShell(sessionId, renameTerminal(terminalId, title)),
    kill: (sessionId, terminalId) => onShell(sessionId, killTerminal(terminalId)),
    attach: (sessionId, terminalId) =>
      Effect.gen(function* () {
        const { sandbox, state, sandboxSessionId, running } = yield* standing(sessionId);
        if (sandbox === undefined || running === undefined || sandboxSessionId === undefined) {
          return {
            state:
              state === SANDBOX_STATE.STARTING ? SANDBOX_STATE.STARTING : SANDBOX_STATE.STOPPED,
          };
        }
        // A shell that is not there was ended elsewhere, or never started: no PTY is minted for it.
        const held = yield* api.run(running, holdsTerminal(terminalId));
        if (held.exitCode === TMUX_EXIT.NO_SESSION) {
          return { state: SANDBOX_STATE.RUNNING, gone: true } as const;
        }
        // A tmux that could not be started or asked is an outage the tab may retry, never a shell gone.
        if (held.exitCode !== 0) return yield* Effect.fail(new SandboxUnavailable({}));
        // The run's own PTY, which never resumes the sandbox.
        const shell = yield* api.openInteractive(running);
        return { state: SANDBOX_STATE.RUNNING, sandboxName: sandbox.name, sandboxSessionId, shell };
      }),
    open: (sessionId) =>
      Effect.gen(function* () {
        const { state, running } = yield* standing(sessionId);
        if (running === undefined) {
          return {
            state:
              state === SANDBOX_STATE.STARTING ? SANDBOX_STATE.STARTING : SANDBOX_STATE.STOPPED,
          };
        }
        // The run's own PTY, which never resumes the sandbox.
        const shell = yield* api.openInteractive(running);
        return { state: SANDBOX_STATE.RUNNING, shell };
      }),
    setCredential: (session, credential) =>
      Effect.provideContext(firewall.write(session, { github: credential }), context),
    resume: (sessionId) =>
      Effect.gen(function* () {
        const { sandbox, state } = yield* standing(sessionId);
        if (sandbox === undefined || state === SANDBOX_STATE.RUNNING) return state;
        // A sandbox made again on an image still being prepared is opened after the answer, which says it is starting.
        const opened = yield* Effect.flatMap(reopenedOf(sessionId, sandbox), (of) =>
          openAgentSandboxPromptly(of),
        ).pipe(
          Effect.provideService(AgentImage, image),
          Effect.provideService(Sandbox, api),
          Effect.catchTag("ImageNotReady", () => Effect.succeed(undefined)),
        );
        return opened === undefined ? SANDBOX_STATE.STARTING : stateOf(opened.sandbox);
      }),
  };
}

/** The service over the runtime's `Sandbox` and the agents' image its build names. */
export const agentSandboxLayer: Layer.Layer<
  AgentSandbox,
  never,
  DatabaseServices | AgentImage | Sandbox
> = Layer.effect(
  AgentSandbox,
  Effect.gen(function* () {
    const api = yield* Sandbox;
    return agentSandboxOver(api, yield* Effect.context<DatabaseServices>(), yield* AgentImage);
  }),
);
