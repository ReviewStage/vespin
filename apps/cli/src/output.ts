/**
 * output.ts -- how a `vespin` command speaks: its answer on stdout as JSON, lines, or ids, its notes and failures on stderr, and what it reads from stdin or a file.
 *
 * A command never writes to stdout itself. It hands `answer` the three
 * readings of what it found, and the flags and the terminal decide which
 * one is printed: JSON with `--json` or wherever stdout is not a terminal,
 * so a script or a coding agent always reads JSON; the ids alone with
 * `-q`; the lines a person reads otherwise. Everything else a command says
 * (a link to open, that it is waiting, why it failed) goes to stderr, so
 * stdout stays the answer alone.
 *
 * A command asks a person nothing unless stdin is a terminal (`canPrompt`):
 * where it is not, what it would ask is read from stdin as input, bar a
 * destructive command's go-ahead, which then takes `--yes` alone.
 */

import { CLI_EXIT, type CliExit } from "@repo/features/cli-exit";
import { Console, Data, Effect, FileSystem, Option, Queue, Stdio, Stream, Terminal } from "effect";
import { JSON_FLAG, QUIET_FLAG } from "./flags.js";

/** The `-F` value that names stdin rather than a file. */
const STDIN_SOURCE = "-";

/** The indent JSON is printed with, so a person reading it can. */
const JSON_INDENT = 2;

/**
 * A command that ended short: the exit code it ends with and the sentence
 * that says why, printed on stderr. Its words never carry a token.
 */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly exit: CliExit;
  readonly message: string;
}> {}

/** What a command found, as each reader takes it. */
export interface Answer {
  /** What `--json`, and stdout that is not a terminal, prints. */
  readonly json: unknown;
  /** What a person at a terminal reads. */
  readonly lines: readonly string[];
  /** What `-q` prints, one a line; none prints nothing. */
  readonly ids?: readonly string[];
}

/** Whether this run prints JSON: asked for, or stdout is not a terminal. */
const printsJson = Effect.gen(function* () {
  const asked = yield* JSON_FLAG;
  if (asked) return true;
  const stdio = yield* Stdio.Stdio;
  return !(yield* stdio.stdoutIsTerminal);
});

/** A command's answer on stdout, in the one reading the flags and the terminal choose. */
export const answer = Effect.fnUntraced(function* (found: Answer) {
  if (yield* QUIET_FLAG) {
    for (const id of found.ids ?? []) yield* Console.log(id);
    return;
  }
  if (yield* printsJson) {
    yield* Console.log(JSON.stringify(found.json, null, JSON_INDENT));
    return;
  }
  for (const line of found.lines) yield* Console.log(line);
});

/**
 * Lines of an answer a person reads as they come, such as a turn followed
 * live, on stdout; nothing with `-q` or where the run prints JSON, whose
 * reader takes the whole answer once it is done.
 */
export const streamLines = Effect.fnUntraced(function* (lines: readonly string[]) {
  if ((yield* QUIET_FLAG) || (yield* printsJson)) return;
  for (const line of lines) yield* Console.log(line);
});

/** A note for the person running the command, on stderr, where it never mixes with the answer. */
export function note(line: string): Effect.Effect<void> {
  return Console.error(line);
}

/** Whether the command may ask the person something: stdin is a terminal. */
const canPrompt = Effect.flatMap(Stdio.Stdio, (stdio) => stdio.stdinIsTerminal);

const stdinText = Effect.flatMap(Stdio.Stdio, (stdio) =>
  Stream.mkString(Stream.decodeText(stdio.stdin)),
);

/**
 * One line from the person: asked with `prompt` where stdin is a terminal,
 * or the first line of stdin where it is not. Nothing where stdin ended
 * before a line, or the person quit.
 */
export const readLine = Effect.fnUntraced(function* (prompt: string) {
  if (yield* canPrompt) {
    yield* note(prompt);
    const terminal = yield* Terminal.Terminal;
    return yield* Effect.option(terminal.readLine).pipe(Effect.map(Option.getOrUndefined));
  }
  const piped = yield* Effect.orElseSucceed(stdinText, () => "");
  return piped.split("\n")[0];
});

/** What a person types at a confirmation to go on; anything else, or nothing, goes no further. */
const CONFIRM_WORDS: ReadonlySet<string> = new Set(["y", "yes"]);

/**
 * A destructive command's go-ahead: given with `--yes`, or asked of the
 * person where stdin is a terminal, who must answer y or yes. Note that
 * without a terminal nothing is read from stdin, because a script that
 * pipes a stray line must not delete by accident, so `--yes` is required.
 * A command that deletes nothing names what a refusal leaves undone.
 */
export const confirmOrYes = Effect.fnUntraced(function* (
  question: string,
  yes: boolean,
  declined = "Nothing was deleted.",
) {
  if (yes) return;
  if (!(yield* canPrompt)) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: `${question} Pass --yes to go ahead without a terminal to confirm at.`,
    });
  }
  const answered = yield* readLine(`${question} [y/N]`);
  if (answered !== undefined && CONFIRM_WORDS.has(answered.trim().toLowerCase())) return;
  return yield* new CommandFailed({ exit: CLI_EXIT.REFUSED, message: declined });
});

/** One line ending, as `echo` or a Windows editor leaves it at the end of piped stdin. */
const TRAILING_NEWLINE = /\r?\n$/u;

/** The keys that end a line typed at the terminal: Enter, as a raw terminal sends it, and Ctrl-J. */
const LINE_END_KEYS: ReadonlySet<string> = new Set(["return", "enter"]);

/**
 * One line typed at the terminal key by key, asked with `prompt` on stderr
 * and none of it echoed: Backspace takes back the last character and Enter
 * ends the line. Note that we read keys rather than `Terminal.readLine`,
 * because the terminal reads stdin raw with no line editing, so a line would
 * carry each Backspace as a character; and that the prompt is printed only
 * once the keys are read raw, so nothing typed the moment it shows is echoed.
 * Esc, Ctrl-C, or Ctrl-D ends the keys, which reads nothing.
 */
const hiddenLine = (prompt: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const terminal = yield* Terminal.Terminal;
      const keys = yield* terminal.readInput;
      yield* note(prompt);
      const typed: string[] = [];
      for (;;) {
        const pressed = yield* Effect.option(Queue.take(keys));
        if (Option.isNone(pressed)) return undefined;
        const { input, key } = pressed.value;
        if (LINE_END_KEYS.has(key.name)) return typed.join("");
        if (key.name === "backspace") typed.pop();
        else if (Option.isSome(input) && !key.ctrl && !key.meta) typed.push(input.value);
      }
    }),
  );

/**
 * A secret the person hands the command, never an argument, which a shell
 * keeps in its history: one line typed at a terminal, asked with `prompt` on
 * stderr and never echoed (`hiddenLine`); or all of piped stdin, one
 * trailing line ending dropped, so a value of several lines arrives whole.
 * Nothing read, or nothing but an empty value, is a usage failure, whose
 * words never carry what was read.
 */
export const readSecret = Effect.fnUntraced(function* (prompt: string) {
  const read = (yield* canPrompt)
    ? yield* hiddenLine(prompt)
    : yield* Effect.orElseSucceed(stdinText, () => undefined).pipe(
        Effect.map((piped) => piped?.replace(TRAILING_NEWLINE, "")),
      );
  if (read === undefined || read === "") {
    return yield* new CommandFailed({ exit: CLI_EXIT.USAGE, message: "No value was read." });
  }
  return read;
});

/** The text a `-F <file|->` names: the file's, or stdin's for `-`, or why it could not be read. */
export const readInput = Effect.fnUntraced(function* (source: string) {
  if (source === STDIN_SOURCE) {
    return yield* Effect.mapError(
      stdinText,
      () => new CommandFailed({ exit: CLI_EXIT.USAGE, message: "Could not read stdin." }),
    );
  }
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* Effect.mapError(
    fileSystem.readFileString(source),
    () => new CommandFailed({ exit: CLI_EXIT.USAGE, message: `Could not read ${source}.` }),
  );
});

/** The space between a table's columns. */
const COLUMN_GAP = "  ";

/**
 * Rows of cells as a person reads a table at a terminal: each column as
 * wide as its widest cell, the last left ragged, so a long name never pads
 * the line past it.
 */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join(COLUMN_GAP)
      .trimEnd(),
  );
}
