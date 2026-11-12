/**
 * mac-shell-procedures.ts -- shells on this Mac as the act port carries them: a cloud agent's mirror found or made, the developer's login shell opened in a folder for the asking panel, attached on a port of its own, and closed, and a local agent's run actions run, stopped, and listed, from a panel alone.
 *
 * The platform holds each shell (`MacShell`: the desktop's main, over
 * node-pty), and these procedures hold which window it belongs to. A shell
 * belongs to the page of the window that opened it, and no other window can
 * attach to or close it. An attach opens a channel and posts its other end
 * to that window under the ticket a cloud shell's port carries, so the
 * Terminal tab reads it as it reads a cloud shell's: what the shell prints,
 * paced to the tab's acks (`TERMINAL_FLOW`), how it stands, and its exit,
 * out; what the panel types, resizes, and acks, in. The panel closing the
 * port detaches; the page going, a reload or the window's close, ends its
 * shells, and the tab opens a fresh one. What a shell prints is never read
 * here, logged, or written to app state: it passes from the shell to its
 * window's one port.
 *
 * A run action of an agent that runs on this Mac is held apart, as its
 * cloud twin is in tmux (`@repo/service`'s `tmux.ts`): its process is the
 * action's command itself, run by the developer's login shell in the
 * agent's worktree, the leader of a process group of its own, so a stop
 * signals the action and everything it started, TERM and then KILL where any
 * of it outlives the grace (`RUN_ACTION_STOP`). It belongs to its agent
 * rather than to a page, so it runs on past a reload, and any panel of this
 * Mac that names the agent and the shell attaches to it, read-only, since
 * nothing typed belongs in it. It counts as running while any process of
 * its group lives, as the cloud's does, so one that left a background
 * process behind is still stopped rather than started again: a press while
 * it runs answers it rather than starting it twice, and a press once all of
 * it ended runs it anew under the same id, its screen started over. Once it ends its output stands, as tmux's
 * `remain-on-exit` keeps a pane, and the list says how it ended. Note that
 * the last of what it printed is kept in memory alone (`SCROLLBACK_BYTES`),
 * so a tab that attaches after the press, or after a reload, shows what it
 * missed, as tmux's own scrollback does; it is never read, logged, or
 * written anywhere else, and goes with the process. A close hangs it up, as
 * a cloud tab's close ends its shell, KILL following where any of it
 * outlives the grace, and a quit ends it with the app.
 */

import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalPortTicket,
  terminalPortInboundSchema,
} from "@repo/features/terminal-acts";
import type { ShellExit } from "@repo/features/terminal-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Duration, Effect, Result } from "effect";
import {
  MAC_SHELL_ACT_KIND,
  type MacRunActionShell,
  type MacShellActKind,
} from "../contract/index.js";
import { actPortFor, type PlatformActProcedures, refuseUnlessPanel } from "./base.js";
import type { HostTerminalPort, TerminalPortSeam } from "./terminal-procedures.js";

/** The signals a run action's process group is sent: TERM to stop it, KILL where it outlives the grace, HUP as its tab closes, as a closed terminal hangs up. */
export const MAC_SHELL_SIGNAL = {
  TERM: "SIGTERM",
  KILL: "SIGKILL",
  HUP: "SIGHUP",
} as const;

export type MacShellSignal = (typeof MAC_SHELL_SIGNAL)[keyof typeof MAC_SHELL_SIGNAL];

/** One running shell, as the platform holds it. */
export interface MacShell {
  /** Hears each chunk the shell prints, in order. */
  onData(listener: (bytes: Uint8Array) => void): void;
  /** Hears the shell's exit status, and the signal that ended it where one did, once. */
  onExit(listener: (code: number, signal: number | undefined) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Stops reading what the shell prints until `resume`, so the shell waits on its terminal. */
  pause(): void;
  resume(): void;
  kill(): void;
  /** Sends a signal to the shell's whole process group, which it leads. */
  signalGroup(signal: MacShellSignal): void;
  /** Whether any process of the shell's group still runs, its leader or what it started. */
  groupRuns(): boolean;
}

export interface MacShellActsDependencies<Sender> {
  /** The agent's mirror on this Mac, made where none stands, by its folder; none where the host could not make it. */
  mirror: (agentId: string) => Effect.Effect<string | undefined>;
  /** A local agent's worktree on this Mac, by its folder; none where the agent has none here. */
  checkout: (agentId: string) => string | undefined;
  /**
   * The developer's login shell started in `folder` at the size given, or,
   * where a command is given, that command run by it and nothing else; none
   * where that is no folder on this Mac or the shell did not start.
   */
  spawn: (folder: string, cols: number, rows: number, command?: string) => MacShell | undefined;
  ports: TerminalPortSeam<Sender>;
  /** A fresh shell id. */
  createId: () => string;
  /** Waits out a span of a stop's grace: the clock's own, or a test's. */
  sleep: (span: Duration.Duration) => Effect.Effect<void>;
}

/**
 * How a run action is stopped: TERM to its process group, then KILL where
 * any of it still runs once the grace is past, asked after every poll so a
 * stop that took returns at once, as the cloud's stop goes.
 */
const RUN_ACTION_STOP = {
  GRACE: Duration.seconds(5),
  POLL: Duration.millis(500),
} as const;

/** The size a run action starts at, before a tab attaches and fits it. */
const RUN_ACTION_SIZE = { COLUMNS: 80, ROWS: 24 } as const;

/** The most of what a run action printed kept for a tab that attaches late: 512 KB. */
const SCROLLBACK_BYTES = 512 * 1024;

/** What a tab's screen is sent as a run action runs anew in it: the screen and its scrollback cleared, the cursor home. */
const SCREEN_CLEARED = new TextEncoder().encode("\u001b[H\u001b[2J\u001b[3J");

/** The line a run action's screen ends on once its process ended, dim, as tmux's dead pane says it. */
function endedLine(exited: ShellExit): Uint8Array {
  const how = "code" in exited ? `status ${exited.code}` : `signal ${exited.signal}`;

  return new TextEncoder().encode(`\r\n\u001b[2m[Process exited with ${how}]\u001b[0m\r\n`);
}

/** One shell a window opened, and where its port stands. */
interface Held {
  readonly shell: MacShell;
  readonly ticket: TerminalPortTicket;
  port: HostTerminalPort | undefined;
  /** Bytes posted that the tab has not acked. */
  unacked: number;
  paused: boolean;
  /** The shell's exit status, once it exited. */
  exitCode: number | undefined;
  /** Whether nothing typed reaches it, as a run action's. */
  readonly readOnly: boolean;
}

/** One run action's process, held by its agent and its action rather than by a page. */
interface RunHeld extends Held {
  /** The process now, replaced where the action runs anew. */
  shell: MacShell;
  readonly actionId: string;
  title: string;
  /** How its process ended, once it has. */
  exited: ShellExit | undefined;
  /** The last of what it printed, oldest first, for a tab that attaches late. */
  scrollback: Uint8Array[];
  scrollbackBytes: number;
  /** The window whose port draws it now, whose page's end lets that port go; none while no port stands. */
  drawnBy: unknown;
}

const readInbound = readEither(terminalPortInboundSchema);

/** Bytes posted on the shell's port, the shell paused once the tab fell far enough behind; none while no port stands. */
function post(held: Held, bytes: Uint8Array): void {
  if (held.port === undefined) return;
  held.port.post({ type: TERMINAL_PORT_MESSAGE.OUTPUT, data: bytes });
  held.unacked += bytes.length;

  if (held.paused || held.unacked <= TERMINAL_FLOW.PAUSE_ABOVE_BYTES) return;
  held.paused = true;
  held.shell.pause();
}

/** The shell's port closed and its count let go; the shell reads on, since nothing waits on a port that is gone. */
function detach(held: Held): void {
  held.port?.close();
  held.port = undefined;
  held.unacked = 0;

  if (!held.paused) return;
  held.paused = false;
  held.shell.resume();
}

/** What a run action printed, kept to its bound, the oldest let go first. */
function keep(held: RunHeld, bytes: Uint8Array): void {
  held.scrollback.push(bytes);
  held.scrollbackBytes += bytes.length;

  while (held.scrollbackBytes > SCROLLBACK_BYTES && held.scrollback.length > 1) {
    held.scrollbackBytes -= held.scrollback.shift()?.length ?? 0;
  }
}

/** What a run action printed, kept and posted on its port where one stands. */
function printed(held: RunHeld, bytes: Uint8Array): void {
  keep(held, bytes);
  post(held, bytes);
}

/** A run action as the list says it. */
function summaryOf(held: RunHeld): MacRunActionShell {
  return {
    id: held.ticket.terminalId,
    title: held.title,
    runAction: held.actionId,
    running: held.shell.groupRuns(),
    ...(held.exited === undefined ? undefined : { exited: held.exited }),
  };
}

/** What the panel sent on a shell's port, read and handed to the shell; anything else is dropped. */
function heard(held: Held, message: WireBoundaryInput): void {
  const read = readInbound(unparsedWire(message));

  if (Result.isFailure(read)) return;
  const inbound = read.success;

  if (inbound.type === TERMINAL_PORT_MESSAGE.ACK) {
    held.unacked = Math.max(0, held.unacked - inbound.bytes);

    if (!held.paused || held.unacked >= TERMINAL_FLOW.RESUME_BELOW_BYTES) return;
    held.paused = false;
    held.shell.resume();

    return;
  }

  // Note that a shell that exited takes nothing more, because its terminal is closed; one on this Mac holds nothing a shown tab need keep.
  if (held.exitCode !== undefined || inbound.type === TERMINAL_PORT_MESSAGE.SHOWN) return;

  if (inbound.type === TERMINAL_PORT_MESSAGE.INPUT) {
    // Note that a run action's tab takes nothing typed, because nothing typed belongs in its process.
    if (!held.readOnly) held.shell.write(inbound.data);
  } else held.shell.resize(inbound.cols, inbound.rows);
}

export function macShellProcedures<Sender>(
  dependencies: MacShellActsDependencies<Sender>,
): Pick<PlatformActProcedures<Sender>, MacShellActKind> {
  const { mirror, checkout, spawn, ports, createId, sleep } = dependencies;
  const macShellPort = actPortFor<Sender>();
  /** Each window's shells, by agent and then by shell. */
  const windows = new Map<Sender, Map<string, Map<string, Held>>>();
  /** Each local agent's run actions, by agent and then by action. */
  const runs = new Map<string, Map<string, RunHeld>>();
  /** The windows whose page's end is watched, once each. */
  const watched = new Set<Sender>();

  /** The window's page's end watched once: its shells end, and its ports on run actions close, the actions running on. */
  const watch = (sender: Sender) => {
    if (watched.has(sender)) return;
    watched.add(sender);
    ports.whenGone(sender, () => {
      watched.delete(sender);
      const shells = windows.get(sender);
      windows.delete(sender);

      for (const each of shells?.values() ?? []) {
        for (const held of each.values()) {
          detach(held);
          held.shell.kill();
        }
      }

      for (const actions of runs.values()) {
        for (const held of actions.values()) {
          if (held.drawnBy !== sender) continue;
          held.drawnBy = undefined;
          detach(held);
        }
      }
    });
  };

  /** The window's shells, its page's end watched the first time it opens one, which ends them. */
  const shellsOf = (sender: Sender) => {
    const held = windows.get(sender);

    if (held !== undefined) return held;
    const fresh = new Map<string, Map<string, Held>>();
    windows.set(sender, fresh);
    watch(sender);

    return fresh;
  };

  /** The run action a shell id names among the agent's. */
  const runNamed = (ticket: TerminalPortTicket) =>
    [...(runs.get(ticket.agentId)?.values() ?? [])].find(
      (each) => each.ticket.terminalId === ticket.terminalId,
    );

  /** The shell a call names: one the asking window opened, or one of the agent's run actions. */
  const named = (sender: Sender, ticket: TerminalPortTicket): Held | undefined =>
    windows.get(sender)?.get(ticket.agentId)?.get(ticket.terminalId) ?? runNamed(ticket);

  /** A run action's process watched: what it prints kept and posted, its end said on its screen and kept; a process since replaced is no longer heard. */
  const follow = (held: RunHeld, shell: MacShell) => {
    shell.onData((bytes) => {
      if (held.shell === shell) printed(held, bytes);
    });
    shell.onExit((code, signal) => {
      if (held.shell !== shell) return;
      held.exited = signal === undefined || signal === 0 ? { code } : { signal };
      printed(held, endedLine(held.exited));
    });
  };

  /** A run action started anew in its held place, its screen started over; false where its process did not start. */
  const respawn = (held: RunHeld, folder: string, command: string): boolean => {
    const shell = spawn(folder, RUN_ACTION_SIZE.COLUMNS, RUN_ACTION_SIZE.ROWS, command);

    if (shell === undefined) return false;
    held.shell = shell;

    // Note that a tab still behind on what the last run printed holds the new one paused too, because only a pause past the mark is ever undone by its acks.
    if (held.paused) shell.pause();
    held.exited = undefined;
    held.scrollback = [];
    held.scrollbackBytes = 0;
    post(held, SCREEN_CLEARED);
    follow(held, shell);

    return true;
  };

  /**
   * A run action's process group stopped: the signal given, then KILL where
   * any of it outlives the grace, asked after each poll. Note that the
   * process is the one standing as the stop began, because a press may run
   * the action anew in its place once this one ends, which no stop reaches.
   */
  const stopGroup = Effect.fnUntraced(function* (shell: MacShell, first: MacShellSignal) {
    if (!shell.groupRuns()) return;
    shell.signalGroup(first);

    const polls =
      Duration.toMillis(RUN_ACTION_STOP.GRACE) / Duration.toMillis(RUN_ACTION_STOP.POLL);

    for (let poll = 0; poll < polls && shell.groupRuns(); poll += 1) {
      yield* sleep(RUN_ACTION_STOP.POLL);
    }

    if (shell.groupRuns()) shell.signalGroup(MAC_SHELL_SIGNAL.KILL);
  });

  return {
    [MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_MIRROR].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const folder = yield* mirror(input.agentId);

        if (folder === undefined) return yield* Effect.fail(errors.REFUSED());

        return { folder };
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_OPEN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const shell = spawn(input.folder, input.cols, input.rows);

        if (shell === undefined) return yield* Effect.fail(errors.REFUSED());
        const ticket = { agentId: input.agentId, terminalId: createId() };

        const held: Held = {
          shell,
          ticket,
          port: undefined,
          unacked: 0,
          paused: false,
          exitCode: undefined,
          readOnly: false,
        };

        const agents = shellsOf(context.actor.sender);
        const shells = agents.get(ticket.agentId) ?? new Map<string, Held>();
        agents.set(ticket.agentId, shells.set(ticket.terminalId, held));
        shell.onData((bytes) => post(held, bytes));
        shell.onExit((code) => {
          held.exitCode = code;
          held.port?.post({
            type: TERMINAL_PORT_MESSAGE.STATE,
            state: TERMINAL_CONNECTION.EXITED,
            code,
          });
        });

        return { terminalId: ticket.terminalId };
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_ATTACH].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const sender = context.actor.sender;
        const held = named(sender, input);

        if (held === undefined) return yield* Effect.fail(errors.REFUSED());

        if (held.exitCode === undefined) held.shell.resize(input.cols, input.rows);
        // Note that a port an earlier attach opened is closed first, because the panel asked again before taking it, and the shell writes to one port alone.
        detach(held);
        const port = ports.open(sender, held.ticket);
        port.onMessage((message) => heard(held, message));
        // The panel closing its port detaches, so a shell no tab draws is never paced to one; a port an attach since replaced detaches nothing.
        port.onClose(() => {
          if (held.port === port) detach(held);
        });
        held.port = port;
        port.post({ type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED });

        // A run action's port is let go with its window's page, and starts on what it printed so far.
        if ("scrollback" in held) {
          // SAFETY: only a run action's held shell keeps a scrollback, so one that has it is a RunHeld.
          const run = held as RunHeld;
          watch(sender);
          run.drawnBy = sender;

          for (const bytes of run.scrollback) post(held, bytes);
        }
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE]: macShellPort[MAC_SHELL_ACT_KIND.MAC_SHELL_CLOSE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        const sender = context.actor.sender;
        const run = runNamed(input);

        // A run action's tab closed hangs up its process group, as a closed terminal does, KILL following past the grace.
        if (run !== undefined) {
          runs.get(input.agentId)?.delete(run.actionId);
          detach(run);

          return yield* stopGroup(run.shell, MAC_SHELL_SIGNAL.HUP);
        }

        const held = named(sender, input);

        if (held === undefined) return;
        windows.get(sender)?.get(input.agentId)?.delete(input.terminalId);
        detach(held);
        held.shell.kill();
      },
    ),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_RUN_ACTION]: macShellPort[
      MAC_SHELL_ACT_KIND.MAC_SHELL_RUN_ACTION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      // Note that the worktree is the host's to make, as it takes the agent's launch, so an agent with none on this Mac is refused rather than given one.
      const folder = checkout(input.agentId);

      if (folder === undefined) return yield* Effect.fail(errors.REFUSED());
      const actions = runs.get(input.agentId) ?? new Map<string, RunHeld>();
      const standing = actions.get(input.actionId);

      // A press while any of it runs answers the run that goes, so it never runs twice.
      if (standing?.shell.groupRuns()) {
        return { terminal: summaryOf(standing) };
      }

      if (standing !== undefined) {
        standing.title = input.title;

        if (!respawn(standing, folder, input.command)) return yield* Effect.fail(errors.REFUSED());

        return { terminal: summaryOf(standing) };
      }

      const shell = spawn(folder, RUN_ACTION_SIZE.COLUMNS, RUN_ACTION_SIZE.ROWS, input.command);

      if (shell === undefined) return yield* Effect.fail(errors.REFUSED());

      const held: RunHeld = {
        shell,
        ticket: { agentId: input.agentId, terminalId: createId() },
        port: undefined,
        unacked: 0,
        paused: false,
        exitCode: undefined,
        readOnly: true,
        actionId: input.actionId,
        title: input.title,
        exited: undefined,
        scrollback: [],
        scrollbackBytes: 0,
        drawnBy: undefined,
      };

      runs.set(input.agentId, actions.set(input.actionId, held));
      follow(held, shell);

      return { terminal: summaryOf(held) };
    }),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_STOP_ACTION]: macShellPort[
      MAC_SHELL_ACT_KIND.MAC_SHELL_STOP_ACTION
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const held = runs.get(input.agentId)?.get(input.actionId);

      if (held === undefined) return yield* Effect.fail(errors.REFUSED());
      yield* stopGroup(held.shell, MAC_SHELL_SIGNAL.TERM);
    }),
    [MAC_SHELL_ACT_KIND.MAC_SHELL_ACTIONS]: macShellPort[
      MAC_SHELL_ACT_KIND.MAC_SHELL_ACTIONS
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());

      return { terminals: [...(runs.get(input.agentId)?.values() ?? [])].map(summaryOf) };
    }),
  };
}
