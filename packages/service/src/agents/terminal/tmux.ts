/**
 * tmux.ts -- a Terminal tab's shells as tmux sessions in the agent's sandbox: the commands that start, name, end, and list them, and the list read back.
 *
 * Each shell a developer opens is a tmux session named for its id, so it
 * outlives any connection to it: a dropped socket, the relay's bound, or a
 * sleeping laptop reattaches to the same process. A session's name carries
 * the id alone, its developer-given name rides as a session option, and
 * every command names its session exactly (`=`), since tmux would otherwise
 * take a prefix of one for another. Every command is a script we write,
 * and what a developer typed reaches it only as a positional argument, never
 * spliced into its text. tmux and its settings come with the image
 * (`apps/web/agent-image/tmux.conf`), and nothing here installs them: the
 * settings keep tmux out of sight, with no status line, no mouse, and its
 * output scrolling into the terminal's own scrollback. Every command runs as
 * the sandbox's default user, on a server of its own (`TMUX.SOCKET`).
 *
 * A run action is one such session too, started for the action
 * (`startRunAction`), named for its label and marked with its id, but its
 * process is the action's command itself, run by a login shell that reads
 * no input, rather than an interactive shell the command is typed into.
 * tmux makes that process the leader of a process group of its own, so a
 * stop signals the action and everything it started (`signalRunAction`),
 * and nothing a developer runs beside it is ever mistaken for it. Its window keeps the pane once the command ends
 * (`remain-on-exit`), so the tab goes on showing what it printed and the list
 * says how it exited; pressing the action again runs it anew in that same
 * pane (`rerunAction`). A run action's tab attaches read-only
 * (`attachTerminal`), since nothing typed belongs in it.
 *
 * tmux prints a control character in a format's value as `_`, so a list
 * cannot separate its fields with one; each free-text field is read on its
 * own and travels in base64, which no name, title, or path can break.
 */

import { constants } from "node:os";
import type { ShellExit, TerminalSummary } from "@repo/features/terminal-wire";
import type { CommandAsk, CommandRun } from "@repo/sandbox";
import { readEither } from "@repo/wire/effect";
import { Result } from "effect";
import { unparsedWire, wireUuidSchema } from "../../core.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";

export const TMUX = {
  /** What a Terminal tab's session names start with; the rest is the shell's id. */
  SESSION_PREFIX: "terminal-",
  /** The session option a developer-given name rides in. */
  TITLE_OPTION: "@terminal_title",
  /** The session option a run action's id rides in, on a shell started for one. */
  RUN_ACTION_OPTION: "@run_action",
  /** The window option that keeps a run action's pane once its command ends, so its output and exit stand. */
  REMAIN_OPTION: "remain-on-exit",
  /** Where a new shell stands: the agent's checkout. */
  START_DIRECTORY: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /**
   * The socket every command names its server by. Note that it is a name of
   * its own rather than tmux's default, so a sandbox's old server on the
   * default, from before shells ran on this one, is never the one attached to.
   */
  SOCKET: "terminal",
} as const;

/** What the list prints where a pane's process group still has a process. */
const RUNNING_GROUP = "1";

/** The foreground commands that are a shell at its prompt, so nothing else runs there. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "zsh", "sh", "dash", "fish"]);

/**
 * How a run action's command is run: by a login shell, as a Terminal tab's
 * shell is, its files written at the umask every shell writes at
 * (`apps/web/agent-image/tmux.conf`'s `default-command`), the command
 * handed to it as an argument of its own, never spliced into this text.
 */
const RUN_ACTION_PROCESS = ["sh", "-c", 'umask 0002 && exec bash -lc "$1"', "run-action"] as const;

/** The signals a stop sends a run action's process group: TERM first, KILL where it outlives the grace, and none at all to ask whether any of it still runs. */
export const RUN_ACTION_SIGNAL = { TERM: "TERM", KILL: "KILL", PROBE: "0" } as const;

export type RunActionSignal = (typeof RUN_ACTION_SIGNAL)[keyof typeof RUN_ACTION_SIGNAL];

/**
 * Lists the tab's sessions, one line each: the session's name, when it was
 * created, then its title, foreground command, folder, run action, and how
 * its pane stands (dead or not, then the status or signal it exited on),
 * each in base64, then whether any process of the pane's process group still
 * lives (1 or 0), which a run action whose own process ended may leave behind.
 * A tmux with no server holds no session, which is an empty list; any other
 * failure exits nonzero.
 */
const LIST_SCRIPT = [
  "listed=$(tmux list-sessions -F '#{session_name} #{session_created}' 2>&1) || {",
  '  case "$listed" in *"no server running"*|*"rror connecting to"*) exit 0 ;; esac',
  `  printf '%s\\n' "$listed" >&2`,
  "  exit 1",
  "}",
  `field() { tmux display-message -p -t "=$1:" "$2" | base64 | tr -d '\\n'; }`,
  `group() { kill -0 "-$(tmux display-message -p -t "=$1:" '#{pane_pid}')" 2>/dev/null && echo 1 || echo 0; }`,
  `printf '%s\\n' "$listed" | while read -r name created; do`,
  `  case "$name" in ${TMUX.SESSION_PREFIX}*) ;; *) continue ;; esac`,
  `  printf '%s %s %s %s %s %s %s %s\\n' "$name" "$created" "$(field "$name" '#{${TMUX.TITLE_OPTION}}')" "$(field "$name" '#{pane_current_command}')" "$(field "$name" '#{pane_current_path}')" "$(field "$name" '#{${TMUX.RUN_ACTION_OPTION}}')" "$(field "$name" '#{pane_dead} #{pane_dead_status} #{pane_dead_signal}')" "$(group "$name")"`,
  "done",
].join("\n");

/** One listed field read back from base64, less the newline tmux printed after it. */
function fieldOf(encoded: string | undefined): string {
  return Buffer.from(encoded ?? "", "base64")
    .toString("utf8")
    .replace(/\n$/, "");
}

const readId = readEither(wireUuidSchema);

/** The platform's signals by name, which a signal tmux printed by name is read through. */
const { signals } = constants;

/** The session a shell is, by its id. */
function sessionOf(terminalId: string): string {
  return `${TMUX.SESSION_PREFIX}${terminalId}`;
}

/** The exact target of a shell's session, which tmux matches whole rather than by prefix. */
function targetOf(terminalId: string): string {
  return `=${sessionOf(terminalId)}`;
}

/** The exact target of a shell's session as an option command takes it: the session's own pane, never a window of another's. */
function optionTargetOf(terminalId: string): string {
  return `${targetOf(terminalId)}:`;
}

/** A script, its arguments as positional parameters, so none of them is ever read as shell text. */
function script(text: string, args: readonly string[] = []): CommandAsk {
  return {
    command: "sh",
    args: ["-c", `tmux() { command tmux -L ${TMUX.SOCKET} "$@"; }\n${text}`, "sh", ...args],
  };
}

/** One tmux command, in place of the script's shell. */
function tmux(args: readonly string[]): CommandAsk {
  return script(`exec tmux -L ${TMUX.SOCKET} "$@"`, args);
}

/** Lists the tab's sessions, in the lines `terminalsOf` reads. */
export function listTerminals(): CommandAsk {
  return script(LIST_SCRIPT);
}

/** Starts a shell detached in the agent's checkout, under its id, named where the developer named it. */
export function startTerminal(terminalId: string, title: string | undefined): CommandAsk {
  const start = ["new-session", "-d", "-s", sessionOf(terminalId), "-c", TMUX.START_DIRECTORY];

  return tmux(
    title === undefined
      ? start
      : [...start, ";", "set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title],
  );
}

/**
 * A word handed to tmux as itself. tmux reads an argument that ends in `;`
 * as the end of its command, and one ending in `\;` as ending in `;`, so a
 * command like `find . -exec rm {} \;`, or a label or variable that ends in
 * one, would be cut short or lose its backslash; a `\` before the last `;`
 * hands back the word as written.
 */
function literal(word: string): string {
  return word.endsWith(";") ? `${word.slice(0, -1)}\\;` : word;
}

/** What a run action's process is started with: the action's id, its label for the tab, its command, and the workspace's variables it runs with. */
export interface RunActionStart {
  readonly actionId: string;
  readonly label: string;
  readonly command: string;
  readonly environment: Readonly<Record<string, string>>;
}

/** The workspace's variables as tmux's `-e` takes them, one argument each. */
function environmentOf(run: RunActionStart): readonly string[] {
  return Object.entries(run.environment).flatMap(([name, value]) => [
    "-e",
    literal(`${name}=${value}`),
  ]);
}

/** The action's command as the pane's process, its last word handed back whole. */
function processOf(run: RunActionStart): readonly string[] {
  return [...RUN_ACTION_PROCESS, literal(run.command)];
}

/**
 * Starts a run action detached in the agent's checkout, under its id, its
 * command the pane's own process, with the workspace's variables, named for
 * the action's label and marked with its id. Note that the pane is kept on
 * exit by a command of the same list, because tmux runs a list whole before
 * it hears a process end, so even a command that ends at once leaves its
 * pane and its status standing.
 */
export function startRunAction(terminalId: string, run: RunActionStart): CommandAsk {
  const target = optionTargetOf(terminalId);

  return tmux([
    ...["new-session", "-d", "-s", sessionOf(terminalId), "-c", TMUX.START_DIRECTORY],
    ...environmentOf(run),
    ...processOf(run),
    ...[";", "set-option", "-w", "-t", target, TMUX.REMAIN_OPTION, "on"],
    ...[";", "set-option", "-t", target, TMUX.TITLE_OPTION, literal(run.label)],
    ...[";", "set-option", "-t", target, TMUX.RUN_ACTION_OPTION, run.actionId],
  ]);
}

/**
 * Runs a run action anew in its pane once its process has ended, with the
 * command and label it holds now, the pane's screen started over. tmux
 * refuses a pane whose process still runs, so a second press never runs the
 * action twice.
 */
export function rerunAction(terminalId: string, run: RunActionStart): CommandAsk {
  const target = optionTargetOf(terminalId);

  return tmux([
    ...["respawn-pane", "-t", target, "-c", TMUX.START_DIRECTORY],
    ...environmentOf(run),
    ...processOf(run),
    ...[";", "set-option", "-t", target, TMUX.TITLE_OPTION, literal(run.label)],
  ]);
}

/** How a signal sent to a run action exits besides 0, which says its process group still runs after it. */
export const RUN_ACTION_EXIT = {
  /** tmux holds no such session. */
  NO_SESSION: 3,
  /** No process of the action's group is left. */
  ENDED: 4,
} as const;

/**
 * Sends a signal to a run action's whole process group, the pane's process
 * leading it, and says whether any of it still runs (`RUN_ACTION_EXIT`);
 * the probe sends none and only asks.
 */
export function signalRunAction(terminalId: string, signal: RunActionSignal): CommandAsk {
  return script(
    [
      `group=$(tmux display-message -p -t "$1" '#{pane_pid}' 2>/dev/null) || exit ${RUN_ACTION_EXIT.NO_SESSION}`,
      `[ -n "$group" ] || exit ${RUN_ACTION_EXIT.NO_SESSION}`,
      `kill -"$2" "-$group" 2>/dev/null`,
      `kill -0 "-$group" 2>/dev/null || exit ${RUN_ACTION_EXIT.ENDED}`,
    ].join("\n"),
    [optionTargetOf(terminalId), signal],
  );
}

/**
 * Attaches a terminal's PTY to a shell that stands, read-only where it is a
 * run action's, so a key typed there never reaches the action; one that
 * does not stand is never started here, which only the shell route does.
 * Note that the read-only client still sizes the window, as `-r` would not.
 */
export function attachTerminal(terminalId: string): CommandAsk {
  return script(
    [
      `if [ -n "$(tmux show-options -qv -t "$2" ${TMUX.RUN_ACTION_OPTION})" ]; then`,
      `  exec tmux attach-session -f read-only -t "$1"`,
      "fi",
      `exec tmux attach-session -t "$1"`,
    ].join("\n"),
    [targetOf(terminalId), optionTargetOf(terminalId)],
  );
}

/** How the shell check exits where tmux ran and holds no such session: apart from tmux's own 1, and the 127 of a tmux missing. */
export const TMUX_EXIT = { NO_SESSION: 3 } as const;

/**
 * Whether a shell stands: exit 0 where its session does, printing the run
 * action it was started for where it was, `TMUX_EXIT.NO_SESSION` where tmux
 * holds none by that name, and anything else where tmux could not be asked.
 */
export function holdsTerminal(terminalId: string): CommandAsk {
  return script(
    [
      `tmux has-session -t "$1" 2>/dev/null || exit ${TMUX_EXIT.NO_SESSION}`,
      `tmux show-options -qv -t "$2" ${TMUX.RUN_ACTION_OPTION}`,
    ].join("\n"),
    [targetOf(terminalId), optionTargetOf(terminalId)],
  );
}

/** Names a shell anew. */
export function renameTerminal(terminalId: string, title: string): CommandAsk {
  return tmux(["set-option", "-t", optionTargetOf(terminalId), TMUX.TITLE_OPTION, title]);
}

/** Ends a shell, and whatever it was running. */
export function killTerminal(terminalId: string): CommandAsk {
  return tmux(["kill-session", "-t", targetOf(terminalId)]);
}

/**
 * A signal as tmux prints it, by its number. Note that tmux names it through
 * the platform's `sig2name`, a number where the C library keeps no names, as
 * glibc's, and a name (`TERM`) where it does, so both are read.
 */
function signalOf(printed: string): number | undefined {
  if (/^\d+$/.test(printed)) return Number(printed);

  const named: number | undefined = (signals as Record<string, number | undefined>)[
    `SIG${printed}`
  ];

  return named;
}

/** How a run action's pane stands, from its dead flag, status, and signal: none while its process runs, or how it ended. */
function exitOf(pane: string): ShellExit | undefined {
  const [dead, status, signal] = pane.split(" ");

  if (dead !== "1") return undefined;
  const signaled = signal === undefined || signal === "" ? undefined : signalOf(signal);

  if (signaled !== undefined) return { signal: signaled };

  return { code: Number(status === undefined || status === "" ? 0 : status) };
}

/**
 * The shells a list printed, oldest first: only the sessions a Terminal tab
 * started, each named as the developer named it or as its foreground
 * command is. A shell a developer opened runs where that command is not the
 * shell at its prompt; a run action's runs while its own process or any
 * process of its group does, so one that left a process behind is still
 * stopped rather than started beside it, and says how it exited once none
 * does. A list that failed is none at all, never an empty one.
 */
export function terminalsOf(run: CommandRun): readonly TerminalSummary[] | undefined {
  if (run.exitCode !== 0) return undefined;

  const listed = run.stdout.split("\n").flatMap((line) => {
    const [name, created, title, command, cwd, runAction, pane, group] = line.split(" ");

    if (name === undefined || !name.startsWith(TMUX.SESSION_PREFIX)) return [];
    const id = readId(unparsedWire(name.slice(TMUX.SESSION_PREFIX.length)));

    if (Result.isFailure(id)) return [];
    const foreground = fieldOf(command);
    const named = fieldOf(title);
    const action = fieldOf(runAction);
    const exited = action === "" || group === RUNNING_GROUP ? undefined : exitOf(fieldOf(pane));

    return [
      {
        created: Number(created ?? 0),
        terminal: {
          id: id.success,
          title: named === "" ? foreground : named,
          command: foreground,
          cwd: fieldOf(cwd),
          running:
            action === "" ? foreground !== "" && !SHELLS.has(foreground) : exited === undefined,
          ...(action !== "" && { runAction: action }),
          ...(exited !== undefined && { exited }),
        },
      },
    ];
  });

  return listed.sort((a, b) => a.created - b.created).map((row) => row.terminal);
}
