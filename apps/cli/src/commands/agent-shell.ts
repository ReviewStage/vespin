/**
 * agent-shell.ts -- `vespin agent shell` and `vespin agent shells`: one of a coding agent's Terminal tab shells attached to this terminal, and the shells listed.
 *
 * A shell is a tmux session in the agent's sandbox, which outlives any
 * connection to it, so attaching starts nothing but a socket: the relay the
 * desktop's Terminal tab attaches through (`terminal-wire.ts`), opened under
 * the account's credential (`@repo/features/relay-credential`) over `ws`
 * (`@repo/features/node`). It speaks the tab's frames: typing as binary
 * frames, a resize as the relay's text frame, the shell's output back as
 * bytes, and the relay's `attached` and `exited` frames and close codes read
 * as the host's terminal composer reads them (`compose-terminals.ts`). With
 * no shell named, the command starts one (`agents.openTerminal`) and attaches
 * to it.
 *
 * The local terminal is in raw mode for as long as the socket is attached,
 * so every key, Ctrl-C among them, reaches the shell; Ctrl-] detaches, as it
 * does in telnet, and leaves the shell running. Raw mode is the scope's, so
 * it is restored however the command ends. A socket that drops once the
 * shell attached (a network change, the relay function's own bound) is
 * opened again after half a second, as the tab's is; one that never attached is asked
 * again on a backoff a few times before the command gives up. Output is
 * paced to what this terminal takes: the socket stops being read while
 * stdout is full. Nothing a shell printed is kept here.
 */

import { HOSTED_API_ERROR, terminalRelayAddress, webSocketOrigin } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import { HOSTED_DEADLINE } from "@repo/features/hosted-link";
import { openTerminalSocketOverWs } from "@repo/features/node";
import { openedUnderCredential } from "@repo/features/relay-credential";
import type { TerminalSocket } from "@repo/features/relay-socket";
import {
  RELAY_SOCKET_END,
  SANDBOX_STATE,
  socketEnding,
  TERMINAL_RELAY_FRAME,
  terminalRelayServiceFrameSchema,
} from "@repo/features/terminal-wire";
import {
  Data,
  Deferred,
  Duration,
  Effect,
  Option,
  Queue,
  Ref,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, note } from "../output.js";
import { askService, SIGN_IN_HINT, session } from "../session.js";

/** The byte a terminal sends for Ctrl-], which detaches. */
const DETACH_BYTE = 0x1d;

/** The bounds of a size the relay takes (`terminalRelayResizeSchema`). */
const SIZE_BOUNDS = { MIN: 1, MAX: 1_000 } as const;

/** The size a terminal that reports none is taken as. */
const FALLBACK_SIZE = { cols: 80, rows: 24 } as const;

/** How long a socket that never attached waits before it is asked again, doubling to the longest, and how many times. */
const REOPEN = {
  /** The first wait, and the wait before a socket that dropped once attached opens again. */
  FIRST: Duration.millis(500),
  LONGEST: Duration.seconds(10),
  TIMES: 5,
} as const;

/** The status a relay refuses an upgrade with for want of an account it answers for. */
const UNAUTHORIZED_STATUS = 401;

/** The status of an upgrade to a path the deployment does not serve. */
const NOT_FOUND_STATUS = 404;

/** The status of an upgrade a server refused for want of itself rather than the ask: it may answer the next one. */
const SERVER_ERROR_STATUS = 500;

/** The most typing held for the next socket while one reopens; typing past it is let go. */
const TYPED_WHILE_AWAY_MAX_BYTES = 64 * 1024;

/** How an attached shell's session ended, where it was not a failure. */
const SHELL_ENDING = {
  /** The person pressed Ctrl-]; the shell keeps running. */
  DETACHED: "detached",
  /** The shell itself exited. */
  EXITED: "exited",
} as const;

/** How one socket's life ended, where the session does not end with a failure. */
const SOCKET_ENDING = {
  /** The shell exited. */
  EXITED: "exited",
  /** The shell had attached, and the socket dropped: it is opened again. */
  DROPPED: "dropped",
} as const;

type SocketEnding =
  | { readonly ending: typeof SOCKET_ENDING.EXITED; readonly code: number | undefined }
  | { readonly ending: typeof SOCKET_ENDING.DROPPED };

/** The socket dropped, or never opened, before the shell attached. */
class RelayDropped extends Data.TaggedError("RelayDropped") {}

/** What to do about a stopped sandbox, whether starting a shell or the relay said so. */
const SANDBOX_STOPPED_WORDS =
  "The agent's sandbox is stopped; resume it from the agent's Terminal tab, then run this again.";

/** Why the relay ended a shell's socket for good, in words for a person. */
const ENDED_WORDS = {
  [RELAY_SOCKET_END.STOPPED]: SANDBOX_STOPPED_WORDS,
  [RELAY_SOCKET_END.STARTING]: "The agent hasn't opened its sandbox yet.",
  [RELAY_SOCKET_END.GONE]: "The shell is gone: the agent was archived, or the shell ended.",
} as const;

const readServiceFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(terminalRelayServiceFrameSchema),
);

/** One dimension of the terminal's size, within what the relay takes. */
function bounded(value: number | undefined, fallback: number): number {
  if (value === undefined || value < SIZE_BOUNDS.MIN) return fallback;
  return Math.min(value, SIZE_BOUNDS.MAX);
}

/** This terminal's size as it stands. */
function terminalSize() {
  return {
    cols: bounded(process.stdout.columns, FALLBACK_SIZE.cols),
    rows: bounded(process.stdout.rows, FALLBACK_SIZE.rows),
  };
}

/** The relay's resize frame for a size. */
function resizeFrame(size: { readonly cols: number; readonly rows: number }): string {
  return JSON.stringify({ type: TERMINAL_RELAY_FRAME.RESIZE, ...size });
}

/** This terminal in raw mode for the scope's life, so every key reaches the shell; the scope's close restores it. */
const rawMode: Effect.Effect<void, never, Scope.Scope> = Effect.acquireRelease(
  Effect.sync(() => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }),
  () =>
    Effect.sync(() => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }),
);

/** What is typed, as it comes. */
const typed = Stream.callback<Uint8Array>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const onData = (chunk: Buffer) => Queue.offerUnsafe(queue, new Uint8Array(chunk));
      process.stdin.on("data", onData);
      return onData;
    }),
    (onData) => Effect.sync(() => process.stdin.off("data", onData)),
  ),
);

/** Each time this terminal is resized. */
const resized = Stream.callback<void>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const onResize = () => Queue.offerUnsafe(queue, undefined);
      process.stdout.on("resize", onResize);
      return onResize;
    }),
    (onResize) => Effect.sync(() => process.stdout.off("resize", onResize)),
  ),
);

/** Bytes written to this terminal, the socket left unread until stdout drains where it is full. */
function written(socket: TerminalSocket, bytes: Uint8Array) {
  return Effect.gen(function* () {
    if (process.stdout.write(bytes)) return;
    yield* socket.pause;
    yield* Effect.callback<void>((resume) => {
      process.stdout.once("drain", () => resume(Effect.void));
    });
    yield* socket.resume;
  });
}

/**
 * One shell attached to this terminal until it exits, the person detaches,
 * or the relay ends it; the session's ending, or a failure that says why.
 */
function attached(agentId: string, terminalId: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const { origin, credential } = yield* session;
      const socketOrigin = webSocketOrigin(origin);
      if (socketOrigin === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `${origin} serves no terminal relay.`,
        });
      }
      const current = yield* Ref.make<TerminalSocket | undefined>(undefined);
      const held = yield* Ref.make<readonly Uint8Array[]>([]);
      const detached = yield* Deferred.make<void>();
      // Note that typing and an attach's flush of what was held take turns, so new typing never overtakes held typing.
      const inOrder = (yield* Semaphore.make(1)).withPermits(1);

      /** Typing sent to the shell, or held while the socket reopens. */
      const send = (bytes: Uint8Array) =>
        inOrder(
          Effect.gen(function* () {
            if (bytes.length === 0) return;
            const socket = yield* Ref.get(current);
            if (socket !== undefined) return yield* socket.send({ bytes });
            yield* Ref.update(held, (before) => {
              const size = before.reduce((sum, each) => sum + each.length, 0);
              return size + bytes.length <= TYPED_WHILE_AWAY_MAX_BYTES
                ? [...before, bytes]
                : before;
            });
          }),
        );

      /** One socket's life: opened, read until it closes, and its close read as how the session stands. */
      const attempt = Effect.scoped(
        Effect.gen(function* () {
          const size = terminalSize();
          const address = terminalRelayAddress(socketOrigin, { agentId, terminalId, ...size });
          const opening = yield* openedUnderCredential(
            credential,
            openTerminalSocketOverWs,
            address,
          );
          if ("unreachable" in opening) return yield* new RelayDropped();
          if ("refused" in opening) {
            if (opening.refused >= SERVER_ERROR_STATUS) return yield* new RelayDropped();
            if (opening.refused === UNAUTHORIZED_STATUS) {
              return yield* new CommandFailed({
                exit: CLI_EXIT.AUTH,
                message: `Not signed in, or the sign-in lapsed. ${SIGN_IN_HINT}`,
              });
            }
            if (opening.refused === NOT_FOUND_STATUS) {
              return yield* new CommandFailed({
                exit: CLI_EXIT.UNAVAILABLE,
                message: `${origin} serves no terminal relay.`,
              });
            }
            return yield* new CommandFailed({
              exit: CLI_EXIT.REFUSED,
              message: "No such shell, or the agent is not yours to reach.",
            });
          }
          const { socket } = opening;
          yield* Effect.addFinalizer(() => Ref.set(current, undefined));
          let attachedOnce = false;
          let exitCode: number | undefined;
          let closeCode: number | undefined;
          yield* Stream.runForEach(socket.arrivals, (arrival) => {
            if ("close" in arrival) {
              closeCode = arrival.close;
              return Effect.void;
            }
            if ("bytes" in arrival) return written(socket, arrival.bytes);
            const frame = Option.getOrUndefined(readServiceFrame(arrival.text));
            if (frame?.type === TERMINAL_RELAY_FRAME.EXITED) exitCode = frame.code;
            if (frame?.type !== TERMINAL_RELAY_FRAME.ATTACHED) return Effect.void;
            attachedOnce = true;
            return inOrder(
              Effect.gen(function* () {
                yield* Ref.set(current, socket);
                // A resize while the socket opened reached no socket, so the size is set right now.
                const now = terminalSize();
                if (now.cols !== size.cols || now.rows !== size.rows) {
                  yield* socket.send({ text: resizeFrame(now) });
                }
                // What was typed while the socket was away reaches the shell first, in the order it was typed.
                const typedWhileAway = yield* Ref.getAndSet(held, []);
                yield* Effect.forEach(typedWhileAway, (bytes) => socket.send({ bytes }), {
                  discard: true,
                });
              }),
            );
          });
          const end = socketEnding(closeCode, exitCode, attachedOnce);
          switch (end.kind) {
            case RELAY_SOCKET_END.EXITED:
              return { ending: SOCKET_ENDING.EXITED, code: end.code } satisfies SocketEnding;
            case RELAY_SOCKET_END.STOPPED:
            case RELAY_SOCKET_END.STARTING:
            case RELAY_SOCKET_END.GONE:
              return yield* new CommandFailed({
                exit: CLI_EXIT.REFUSED,
                message: ENDED_WORDS[end.kind],
              });
            case RELAY_SOCKET_END.UNATTACHED:
              return yield* new RelayDropped();
            case RELAY_SOCKET_END.DROPPED:
              return { ending: SOCKET_ENDING.DROPPED } satisfies SocketEnding;
          }
        }),
      );

      // The socket opened, and opened again after each drop, until the shell exits or the relay ends it.
      const reopening = attempt.pipe(
        Effect.retry({
          while: (failure): boolean => failure._tag === "RelayDropped",
          times: REOPEN.TIMES,
          schedule: Schedule.exponential(REOPEN.FIRST).pipe(
            Schedule.modifyDelay(({ duration }) =>
              Effect.succeed(Duration.min(duration, REOPEN.LONGEST)),
            ),
          ),
        }),
        Effect.repeat({
          schedule: Schedule.spaced(REOPEN.FIRST),
          while: (socket) => socket.ending === SOCKET_ENDING.DROPPED,
        }),
        Effect.mapError((failure) =>
          failure._tag === "RelayDropped"
            ? new CommandFailed({
                exit: CLI_EXIT.UNAVAILABLE,
                message: "Could not reach the agent's shell.",
              })
            : failure,
        ),
      );

      yield* rawMode;
      yield* Effect.forkScoped(
        Stream.runForEach(typed, (bytes) =>
          Effect.gen(function* () {
            const detach = bytes.indexOf(DETACH_BYTE);
            if (detach < 0) return yield* send(bytes);
            yield* send(bytes.subarray(0, detach));
            yield* Deferred.succeed(detached, undefined);
          }),
        ),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(resized, () =>
          Effect.gen(function* () {
            const socket = yield* Ref.get(current);
            if (socket !== undefined) yield* socket.send({ text: resizeFrame(terminalSize()) });
          }),
        ),
      );
      return yield* Effect.raceFirst(
        Effect.map(reopening, (socket) => ({
          ending: SHELL_ENDING.EXITED,
          code: socket.ending === SOCKET_ENDING.EXITED ? socket.code : undefined,
        })),
        Effect.as(Deferred.await(detached), { ending: SHELL_ENDING.DETACHED, code: undefined }),
      );
    }),
  );
}

const agentArgument = Argument.String("agent").pipe(Argument.withDescription("The agent's id"));

/** `vespin agent shell`: attach to one of the agent's shells, or a new one. */
export const shellCommand = Command.make(
  "shell",
  {
    agent: agentArgument,
    shell: Argument.String("shell").pipe(
      Argument.withDescription("The shell's id, from vespin agent shells (default: a new shell)"),
      Argument.optional,
    ),
    title: Flag.String("title").pipe(
      Flag.optional,
      Flag.withDescription("The new shell's name in the Terminal tab"),
    ),
  },
  ({ agent: agentId, shell, title }) =>
    Effect.gen(function* () {
      if (Option.isSome(shell) && Option.isSome(title)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "--title names a new shell; leave it out to attach to one that stands.",
        });
      }
      // Note that this is checked before a shell is started, so a piped run leaves none behind.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "vespin agent shell is interactive: run it in a terminal, not piped.",
        });
      }
      const terminalId = Option.isSome(shell)
        ? shell.value
        : (yield* askService(
            (yield* session).hosted.agents.openTerminal,
            {
              params: { id: agentId },
              body: Option.isSome(title) ? { title: title.value } : {},
            },
            HOSTED_DEADLINE.USUAL,
            { [HOSTED_API_ERROR.SANDBOX_STOPPED]: SANDBOX_STOPPED_WORDS },
          )).terminal.id;
      yield* note(`Attaching to shell ${terminalId}. Ctrl-] detaches and leaves it running.`);
      const ended = yield* attached(agentId, terminalId);
      if (ended.ending === SHELL_ENDING.DETACHED) {
        yield* note(
          `\nDetached; the shell keeps running. Attach again: vespin agent shell ${agentId} ${terminalId}`,
        );
        return;
      }
      yield* note(
        ended.code === undefined ? "\nThe shell exited." : `\nThe shell exited (${ended.code}).`,
      );
    }),
).pipe(
  Command.withDescription(
    "Open a shell in an agent's sandbox, or attach to one of its Terminal tab's shells; Ctrl-] detaches",
  ),
  Command.withExamples([
    { command: "vespin agent shell <id>", description: "A new shell in the agent's sandbox" },
    {
      command: "vespin agent shell <id> <shell>",
      description: "Attach to a shell that stands, from vespin agent shells",
    },
    { command: 'vespin agent shell <id> --title "dev server"', description: "A new shell, named" },
  ]),
);

/** `vespin agent shells`: the agent's shells, as its Terminal tab lists them. */
export const shellsCommand = Command.make("shells", { agent: agentArgument }, ({ agent: id }) =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const listed = yield* askService(hosted.agents.terminals, { id });
    const { sandbox, terminals } = listed;
    yield* answer({
      json: listed,
      lines:
        sandbox !== SANDBOX_STATE.RUNNING
          ? [`The agent's sandbox is ${sandbox}; it has no shells.`]
          : terminals.length === 0
            ? ["No shells. vespin agent shell <id> opens one."]
            : columns(terminals.map((each) => [each.id, each.title, each.command, each.cwd])),
      ids: terminals.map((each) => each.id),
    });
  }),
).pipe(
  Command.withDescription("List an agent's shells: its Terminal tab's, oldest first"),
  Command.withExamples([
    { command: "vespin agent shells <id>", description: "The shells to attach to" },
  ]),
);
