import assert from "node:assert/strict";
import { test } from "vitest";
import {
  attachTerminal,
  holdsTerminal,
  killTerminal,
  listTerminals,
  RUN_ACTION_SIGNAL,
  renameTerminal,
  rerunAction,
  signalRunAction,
  startRunAction,
  startTerminal,
  TMUX,
  terminalsOf,
} from "./tmux.js";

/**
 * A Terminal tab's shells as tmux sessions in the agent's sandbox: the
 * commands that start, name, and end one name its session exactly, never by
 * a prefix tmux would take for another, and splice nothing into shell text;
 * a list reads back only the sessions a tab started, oldest first, each
 * named as the developer named it or as its foreground command is, and
 * running where that command is not the shell at its prompt, or, for a run
 * action, while its own process runs, saying how it exited once it has. A
 * run action's command is its pane's process, handed to the shell that runs
 * it as an argument of its own. Every command
 * runs on a tmux server of its own, and none installs anything or reaches
 * for sudo itself.
 */

/** The script a command runs, past `sh -c`. */
function scriptOf(ask: { readonly args: readonly string[] }): string | undefined {
  return ask.args[1];
}

const SHELL_A = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL_B = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

/** One field as the list prints it: what tmux printed, newline and all, in base64. */
const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

/** One line as the list prints it: the session's name, when it was created, and its free-text fields in base64, a run action's and its pane's where given. */
function listed(
  name: string,
  created: number,
  title: string,
  command: string,
  cwd: string,
  action?: { readonly id: string; readonly pane: string; readonly group: "0" | "1" },
): string {
  const fields = [name, String(created), field(title), field(command), field(cwd)];

  return (
    action === undefined ? fields : [...fields, field(action.id), field(action.pane), action.group]
  ).join(" ");
}

test("starting, naming, and ending a shell target its session exactly and carry a name as one argument", () => {
  const exact = `=terminal-${SHELL_A}`;
  const hostile = "dev server; rm -rf / $(id) 'q'";
  const started = startTerminal(SHELL_A, hostile);
  const renamed = renameTerminal(SHELL_A, hostile);
  const killed = killTerminal(SHELL_A);

  for (const ask of [started, renamed, killed]) {
    assert.ok(!scriptOf(ask)?.includes(hostile), "nothing typed is spliced into the script");
  }

  // tmux would take a bare name as a prefix of another session's; an option command takes the session's own pane.
  assert.ok(started.args.includes(`${exact}:`) && renamed.args.includes(`${exact}:`));
  assert.ok(killed.args.includes(exact));
  assert.equal(started.args.at(-1), hostile);
  assert.equal(renamed.args.at(-1), hostile);
  assert.ok(startTerminal(SHELL_A, undefined).args.includes(TMUX.START_DIRECTORY));
  assert.ok(!startTerminal(SHELL_A, undefined).args.includes(TMUX.TITLE_OPTION));
});

test("a run action's command, label, and variables reach tmux as written where they end in a semicolon, which tmux would read as the end of its command", () => {
  // Note that tmux 3.6 reads `find . -exec rm {} \;` as `find . -exec rm {} ;` and `pnpm dev;` as `pnpm dev`: a backslash before the last `;` hands each back whole.
  const run = {
    actionId: SHELL_A,
    label: "Clean;",
    command: "find . -exec rm {} \\;",
    environment: { MODE: "a;" },
  };

  const started = startRunAction(SHELL_A, run);
  const rerun = rerunAction(SHELL_A, { ...run, command: "pnpm dev;" });

  assert.ok(started.args.includes("find . -exec rm {} \\\\;"));
  assert.ok(started.args.includes("Clean\\;"));
  assert.ok(started.args.includes("MODE=a\\;"));
  assert.ok(rerun.args.includes("pnpm dev\\;"));
  assert.ok(rerun.args.includes("MODE=a\\;"));
});

test("a run action's command is its pane's own process, handed to its shell as an argument rather than typed or spliced into a script", () => {
  const hostile = "pnpm dev $(id) 'q'";
  const run = { actionId: SHELL_A, label: "Dev", command: hostile, environment: {} };

  for (const ask of [startRunAction(SHELL_A, run), rerunAction(SHELL_A, run)]) {
    assert.ok(!scriptOf(ask)?.includes(hostile));
    assert.ok(!ask.args.includes("send-keys"));
    // The command follows the script that runs it and the name that script's `$0` takes.
    const at = ask.args.indexOf(hostile);
    assert.equal(ask.args[at - 1], "run-action");
    assert.match(ask.args[at - 2] ?? "", /bash -lc "\$1"/);
  }

  // The pane outlives its process, so what it printed and how it exited stand.
  assert.ok(startRunAction(SHELL_A, run).args.includes(TMUX.REMAIN_OPTION));
  const signaled = signalRunAction(SHELL_A, RUN_ACTION_SIGNAL.TERM);
  assert.deepEqual(signaled.args.slice(-2), [`=terminal-${SHELL_A}:`, RUN_ACTION_SIGNAL.TERM]);
});

test("every command runs on a tmux server of its own, and none installs tmux or reaches for sudo", () => {
  const asks = [
    listTerminals(),
    startTerminal(SHELL_A, "dev server"),
    attachTerminal(SHELL_A),
    holdsTerminal(SHELL_A),
    signalRunAction(SHELL_A, RUN_ACTION_SIGNAL.KILL),
    renameTerminal(SHELL_A, "dev server"),
    killTerminal(SHELL_A),
  ];

  for (const ask of asks) {
    assert.deepEqual(ask.args.slice(0, 1), ["-c"]);
    assert.doesNotMatch(scriptOf(ask) ?? "", /\b(sudo|apt-get|dnf)\b/);
    assert.match(scriptOf(ask) ?? "", /tmux -L terminal "\$@"/);
  }
});

test("a list reads back a tab's shells oldest first, named and marked running as they stand, and nothing else tmux holds", () => {
  const stdout = [
    listed(`terminal-${SHELL_B}`, 200, "dev server", "node", "/workspace/repository/apps/web"),
    listed("main", 50, "", "bash", "/root"),
    listed("terminal-not-an-id", 60, "", "bash", "/root"),
    listed(`terminal-${SHELL_A}`, 100, "", "zsh", "/workspace/repository"),
    "",
  ].join("\n");

  assert.deepEqual(terminalsOf({ exitCode: 0, stdout, stderr: "" }), [
    { id: SHELL_A, title: "zsh", command: "zsh", cwd: "/workspace/repository", running: false },
    {
      id: SHELL_B,
      title: "dev server",
      command: "node",
      cwd: "/workspace/repository/apps/web",
      running: true,
    },
  ]);
});

test("a title or folder with spaces is read back whole, and a list that failed is none at all", () => {
  const stdout = listed(`terminal-${SHELL_A}`, 100, "dev  server", "node", "/workspace/my app");

  assert.deepEqual(terminalsOf({ exitCode: 0, stdout, stderr: "" }), [
    { id: SHELL_A, title: "dev  server", command: "node", cwd: "/workspace/my app", running: true },
  ]);
  assert.deepEqual(terminalsOf({ exitCode: 0, stdout: "", stderr: "" }), []);
  assert.equal(terminalsOf({ exitCode: 1, stdout: "", stderr: "" }), undefined);
});

test("a run action reads as running while its process or any process it left behind runs, whatever its foreground command, and says how it exited once none does", () => {
  const at = (n: number) => `terminal-${n}b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d`;

  const stdout = [
    listed(at(1), 100, "Dev", "vim", "/", { id: "dev", pane: "0  ", group: "1" }),
    listed(at(2), 200, "Check", "bash", "/", { id: "check", pane: "1 1 ", group: "0" }),
    // Note that tmux prints a signal by number on glibc and by name where the C library names it.
    listed(at(3), 300, "Serve", "bash", "/", { id: "serve", pane: "1  15", group: "0" }),
    listed(at(4), 400, "Watch", "bash", "/", { id: "watch", pane: "1  TERM", group: "0" }),
    listed(at(5), 500, "Leaver", "bash", "/", { id: "leaver", pane: "1 0 ", group: "1" }),
  ].join("\n");

  const read = terminalsOf({ exitCode: 0, stdout, stderr: "" }) ?? [];

  assert.deepEqual(
    read.map(({ runAction, running, exited }) => ({ runAction, running, exited })),
    [
      { runAction: "dev", running: true, exited: undefined },
      { runAction: "check", running: false, exited: { code: 1 } },
      { runAction: "serve", running: false, exited: { signal: 15 } },
      { runAction: "watch", running: false, exited: { signal: 15 } },
      { runAction: "leaver", running: true, exited: undefined },
    ],
  );
});
