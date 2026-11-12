import { Schema as EffectSchema } from "effect";
import { wireUuidSchema } from "./service-wire.js";

/**
 * terminal-wire.ts -- a coding agent's terminals, as the desktop lists, names, and ends them, and how its sandbox stands.
 *
 * A Terminal tab belongs to one coding agent's sandbox, never to the task.
 * Each of its shells is a tmux session in that sandbox, which outlives any
 * connection to it, so the list is read from the sandbox itself: one row
 * per shell, its name, what it is running, and where. The list never wakes a
 * stopped sandbox; only the resume path does, on the developer's click.
 * Every request refuses a key it does not name, as every request frame on
 * this wire does.
 */

/** Where the agent's sandbox stands, as the tab reads it. */
export const SANDBOX_STATE = {
  /** Up: its shells can be listed, started, and attached. */
  RUNNING: "running",
  /** Stopped with its files kept; its shells ended with it, and it comes back only on the developer's resume. */
  STOPPED: "stopped",
  /** Not open yet: the agent opens its sandbox on its first command, or it is still coming up. */
  STARTING: "starting",
} as const;

export type SandboxState = (typeof SANDBOX_STATE)[keyof typeof SANDBOX_STATE];

const TERMINAL_BOUNDS = {
  /** The most characters of a shell's name. */
  MAX_TITLE_CHARS: 60,
} as const;

/** A shell's name: a short line of printable characters, since it is shown in a list and stored as a tmux option. */
const title = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(TERMINAL_BOUNDS.MAX_TITLE_CHARS),
  EffectSchema.isPattern(/^\P{Cc}+$/u),
);

/**
 * One shell in the agent's sandbox: its id, the name the developer gave it
 * or the shell's own, what its foreground process is, the folder it stands
 * in, and whether something other than the shell itself is running there.
 */
const terminalSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  title: EffectSchema.String,
  command: EffectSchema.String,
  cwd: EffectSchema.String,
  running: EffectSchema.Boolean,
  /** The run action the shell was started for (`workspace-sandbox-setup-wire.ts`), by its id; none for a shell a developer opened. */
  runAction: EffectSchema.optionalKey(EffectSchema.String),
  /** How a run action's process ended, its pane kept to show it: the status it exited with, or the signal that ended it; none while it runs, and none for a shell a developer opened. */
  exited: EffectSchema.optionalKey(
    EffectSchema.Union([
      EffectSchema.Struct({ code: EffectSchema.Int }),
      EffectSchema.Struct({ signal: EffectSchema.Int }),
    ]),
  ),
});

/** How a run action's process ended (`TerminalSummary.exited`). */
export type ShellExit = NonNullable<(typeof terminalSummarySchema.Type)["exited"]>;

export type TerminalSummary = typeof terminalSummarySchema.Type;

/** The agent's shells (GET), oldest first, and where its sandbox stands; none while it is not running. */
export const terminalsAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  terminals: EffectSchema.Array(terminalSummarySchema),
});

export type TerminalsAnswer = typeof terminalsAnswerSchema.Type;

/** A new shell in the agent's sandbox (POST), named where the developer named it. */
export const terminalCreateRequestSchema = EffectSchema.Struct({
  title: EffectSchema.optional(title),
});

/** The shell started (POST). */
export const terminalCreatedAnswerSchema = EffectSchema.Struct({
  terminal: terminalSummarySchema,
});

/** A shell's new name (PATCH). */
export const terminalRenameRequestSchema = EffectSchema.Struct({ title });

/** Where the sandbox stands once a resume answered (POST). */
export const sandboxResumedAnswerSchema = EffectSchema.Struct({
  sandbox: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
});

/**
 * The terminal relay: one WebSocket per attached shell, from the desktop's
 * host to the service under the account's bearer, which the service pipes to
 * the shell's PTY in the agent's sandbox. The desktop sends what was typed
 * as binary frames and a resize as a text frame; the service sends what the
 * shell printed as binary frames, and a text frame once the shell is
 * attached or has exited. How the socket ended says what the tab shows: the
 * close codes below, each a state of the connection rather than a failure.
 */
export const TERMINAL_RELAY = {
  PATH: "/api/terminal/sessions",
  QUERY: { AGENT: "agent", TERMINAL: "terminal", COLUMNS: "cols", ROWS: "rows" },
} as const;

/** How the relay ends a shell's socket, by what the tab should show. */
export const TERMINAL_RELAY_CLOSE = {
  /** The sandbox is stopped; only the developer's resume brings it back. */
  STOPPED: 4001,
  /** The agent has not opened its sandbox yet. */
  STARTING: 4002,
  /** The agent was archived, or is no agent this account reaches. */
  GONE: 4003,
  /** The shell exited; its status rode in the `exited` frame before the close. */
  EXITED: 4004,
  /** Vercel could not be reached, or did not answer; the tab may try again. */
  UNAVAILABLE: 4005,
} as const;

/** The relay's own text frames, by type. */
export const TERMINAL_RELAY_FRAME = {
  /** desktop → service: the terminal's size. */
  RESIZE: "resize",
  /** service → desktop: the shell is attached; what follows is its output. */
  ATTACHED: "attached",
  /** service → desktop: the shell exited with the code given. */
  EXITED: "exited",
} as const;

/** The desktop's resize frame. */
export const terminalRelayResizeSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.RESIZE),
  cols: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum: 1_000 })),
  rows: EffectSchema.Int.check(EffectSchema.isBetween({ minimum: 1, maximum: 1_000 })),
});

/**
 * The service's text frames.
 *
 * @public Read by the host's terminal client (PR 4's implementation), which lands above the relay.
 */
export const terminalRelayServiceFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.ATTACHED) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TERMINAL_RELAY_FRAME.EXITED),
    code: EffectSchema.Int,
  }),
]);

/** How one relay socket's life ended, read from its close, the `exited` frame's code, and whether the shell attached. */
export const RELAY_SOCKET_END = {
  /** The sandbox is stopped; only the developer's resume brings it back. */
  STOPPED: "stopped",
  /** The agent was archived, or the shell ended elsewhere. */
  GONE: "gone",
  /** The shell exited, its status in `code` where the `exited` frame carried one. */
  EXITED: "exited",
  /** The agent has not opened its sandbox yet. */
  STARTING: "starting",
  /** The shell had attached, and the socket dropped: it may open again at once. */
  DROPPED: "dropped",
  /** The socket dropped, or closed, before the shell attached: it may open again after a wait. */
  UNATTACHED: "unattached",
} as const;

export type RelaySocketEnd =
  | { readonly kind: typeof RELAY_SOCKET_END.EXITED; readonly code: number | undefined }
  | {
      readonly kind: Exclude<
        (typeof RELAY_SOCKET_END)[keyof typeof RELAY_SOCKET_END],
        typeof RELAY_SOCKET_END.EXITED
      >;
    };

/** The ends a relay's close code says outright, whether or not the shell attached; any other close is a drop. */
const END_BY_CLOSE: ReadonlyMap<number, RelaySocketEnd["kind"]> = new Map([
  [TERMINAL_RELAY_CLOSE.STOPPED, RELAY_SOCKET_END.STOPPED],
  [TERMINAL_RELAY_CLOSE.GONE, RELAY_SOCKET_END.GONE],
  [TERMINAL_RELAY_CLOSE.EXITED, RELAY_SOCKET_END.EXITED],
  [TERMINAL_RELAY_CLOSE.STARTING, RELAY_SOCKET_END.STARTING],
]);

/**
 * How a relay socket ended, the one reading every client of the relay
 * shares: the close code first, so a relay that said why is believed
 * whether or not the shell attached, then whether it attached. The exit
 * code rides only on an exit.
 */
export function socketEnding(
  closeCode: number | undefined,
  exitCode: number | undefined,
  attached: boolean,
): RelaySocketEnd {
  const said = closeCode === undefined ? undefined : END_BY_CLOSE.get(closeCode);

  if (said === RELAY_SOCKET_END.EXITED) return { kind: said, code: exitCode };

  if (said !== undefined) return { kind: said };

  return { kind: attached ? RELAY_SOCKET_END.DROPPED : RELAY_SOCKET_END.UNATTACHED };
}
