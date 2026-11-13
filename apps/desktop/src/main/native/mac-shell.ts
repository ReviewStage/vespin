import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { MacShell, MacShellSignal } from "@repo/host/act-port";
import type * as NodePty from "node-pty";
import { nativeHelperPath } from "./native-helper";

/**
 * mac-shell.ts -- the developer's login shell on this Mac, run in a pseudoterminal by node-pty, as the act port's shells ask for one (`@repo/host/act-port`'s `MacShell`).
 *
 * node-pty's folder (`scripts/package-layout.mjs`'s `NODE_PTY`) is loaded
 * from beside the helpers rather than bundled, since its JavaScript finds
 * its N-API addon and `spawn-helper` from its own folder. Each shell is a
 * child of main, so it lives as long as the app and no longer: a quit
 * closes its terminal, and the shell hangs up. It starts at the size its
 * tab's screen was first fitted to, in the app's environment without what
 * names the app's own runtime or another terminal the app was started from.
 * What a shell prints is handed on as the bytes it wrote, and never read,
 * logged, or kept here.
 *
 * A run action's process is the same login shell handed the action's
 * command (`-c`), so it reads the developer's profile as a Terminal tab
 * does and runs nothing else (`commandArguments`). node-pty starts every
 * child as the leader of a session and process group of its own, so its
 * group is signaled by the negated pid, reaching what the command started
 * as well.
 */

/** The shell a Mac account starts with when its own is unknown. */
const FALLBACK_SHELL = "/bin/zsh";

/** What the shell is told its terminal is, as the Terminal tab's xterm draws it. */
const TERMINAL_NAME = "xterm-256color";

/** What the shell is told the program drawing its terminal is. */
const TERMINAL_PROGRAM = "vespin";

/**
 * The variables the app's environment holds that a shell is not handed: the
 * app's own runtime's (`ELECTRON_*`), and those that would tell the shell it
 * runs inside another terminal or at another size (`TMUX`, `TMUX_PANE`,
 * `STY`, `COLUMNS`, `LINES`), as a terminal app started from one of them
 * would otherwise pass on.
 */
const UNHANDED_ENV = /^(ELECTRON_.+|TMUX|TMUX_PANE|STY|COLUMNS|LINES)$/u;

/** The locale a shell gets where the app was launched without one, as Finder launches it, so a shell reads and writes UTF-8. */
const FALLBACK_LANG = "en_US.UTF-8";

/** A failure's code alone, which a log line may carry: its message may name a path in the developer's home. */
function failureCode(cause: unknown): string {
  return cause instanceof Error && "code" in cause ? String(cause.code) : "no code";
}

let nodePty: typeof NodePty | null | undefined;

/** node-pty, loaded once; null where it cannot be. */
function loadedNodePty(): typeof NodePty | null {
  if (nodePty !== undefined) return nodePty;

  try {
    const loaded: typeof NodePty = createRequire(__filename)(nativeHelperPath("node-pty"));
    nodePty = loaded;
  } catch (cause) {
    console.error(`node-pty did not load (${failureCode(cause)}), so no shell opens on this Mac.`);
    nodePty = null;
  }

  return nodePty;
}

/** Whether `folder` is a folder on this Mac. */
function isFolder(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** The environment a shell is handed: the app's, less what is the app's own or another terminal's. */
function shellEnvironment() {
  const handed = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !UNHANDED_ENV.test(entry[0]),
  );

  return {
    ...Object.fromEntries(handed),
    TERM: TERMINAL_NAME,
    TERM_PROGRAM: TERMINAL_PROGRAM,
    COLORTERM: "truecolor",
    LANG: process.env.LANG || FALLBACK_LANG,
  } satisfies Record<string, string>;
}

/**
 * The arguments a shell runs a command with, as a login shell. Note that zsh,
 * macOS's own, is made interactive too, because the tools a developer puts on
 * `PATH` are mostly set up in `.zshrc`, which a login shell alone never
 * reads; and that its job control is turned off (`+m`), because an
 * interactive zsh otherwise puts each job in a process group of its own,
 * where a stop of the action's group would not reach it. Another shell reads
 * its login profile alone, as bash's sources its `.bashrc` by convention.
 */
function commandArguments(shell: string, command: string): readonly string[] {
  return path.basename(shell) === "zsh" ? ["-l", "-i", "+m", "-c", command] : ["-l", "-c", command];
}

/** Whether a process group still has a process in it, asked with no signal sent; only a group the system says is gone has none, so one we may not signal still runs. */
function groupAlive(group: number): boolean {
  try {
    process.kill(-group, 0);

    return true;
  } catch (cause) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ESRCH");
  }
}

/**
 * The developer's login shell started in `folder` at the size given, or that
 * shell running `command` alone where one is given; none where that is no
 * folder, or node-pty did not load or start it.
 */
export function spawnMacShell(
  folder: string,
  cols: number,
  rows: number,
  command?: string,
): MacShell | undefined {
  const pty = loadedNodePty();

  if (pty === null || !isFolder(folder)) return undefined;
  const shell = process.env.SHELL || os.userInfo().shell || FALLBACK_SHELL;
  let running: NodePty.IPty;

  try {
    // Note that the shell's bytes are taken as it wrote them, never decoded here, so a character a read cuts in two reaches the screen whole.
    // Note that the command is handed to the shell as an argument of its own, never spliced into other text.
    running = pty.spawn(
      shell,
      command === undefined ? ["-l"] : [...commandArguments(shell, command)],
      {
        name: TERMINAL_NAME,
        cwd: folder,
        cols,
        rows,
        encoding: null,
        env: shellEnvironment(),
      },
    );
  } catch (cause) {
    console.error(`A shell did not start on this Mac (${failureCode(cause)}).`);

    return undefined;
  }

  // Note that a pseudoterminal spawned with no encoding hands each chunk as
  // the Buffer it read, which node-pty's typings still name a string, so the
  // chunk passes through as it came and a string is only ever encoded here
  // for those typings' sake.
  const bytesOf = (chunk: string | Uint8Array): Uint8Array =>
    chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);

  return {
    onData: (listener) => void running.onData((chunk) => listener(bytesOf(chunk))),
    onExit: (listener) => void running.onExit(({ exitCode, signal }) => listener(exitCode, signal)),
    write: (data) => running.write(data),
    resize: (cols, rows) => {
      // Note that a terminal that closed under a resize is let be, because its exit is already on its way.
      try {
        running.resize(cols, rows);
      } catch {}
    },
    pause: () => running.pause(),
    resume: () => running.resume(),
    kill: () => running.kill(),
    signalGroup: (signal: MacShellSignal) => {
      // Note that a group already gone is let be, because its end is already on its way.
      try {
        process.kill(-running.pid, signal);
      } catch {}
    },
    groupRuns: () => groupAlive(running.pid),
  };
}
