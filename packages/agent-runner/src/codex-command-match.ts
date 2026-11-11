/**
 * codex-command-match.ts -- whether a command a Codex approval request names starts with one of the commands the member always allows, read conservatively: one plain command or nothing.
 *
 * Codex takes allow rules only from files in its home or the checkout, and
 * an exec-policy `allow` runs its command outside Codex's sandbox, so the
 * runner never hands Codex a rule: it accepts, once, an ask whose command
 * is one the member's list covers (`codex.ts`'s `servedAsk`), and asks the
 * member every other. Codex's own reading of a shell script is not reachable
 * from here, so this one reads less than it would rather than differently:
 *
 * - The request's `command` is the argv Codex will run, quoted and joined
 *   (`shlex_join`), so it is split back by POSIX quoting; anything else a
 *   shell would read in it, unquoted, refuses the match.
 * - An argv that runs a system shell on a script (`/bin/bash -lc 'pnpm
 *   test'`) is read as its script, which must be one simple command of plain words: no
 *   quote, escape, operator, redirection, substitution, glob, comment, or
 *   line break, so a compound command or any other shell syntax is never a
 *   match.
 * - Every word, the argv's own or the script's, is a plain one
 *   (`CommandPrefixSchema`'s token), and the command's words begin with a
 *   listed prefix's, token for token; the prefix alone is a match.
 */

import { type CommandPrefix, CommandPrefixSchema } from "@repo/wire";
import { Option, Schema } from "effect";

/**
 * The shells whose `-c` script is read as the command it runs: each by its
 * bare name, found on the launch's own PATH, or at a system install's path.
 * Note that a shell is known by its whole path, never its file name, since a
 * checkout's own `./tools/bash` would run the script as it pleases.
 */
const SHELLS: ReadonlySet<string> = new Set(
  ["bash", "sh", "zsh"].flatMap((shell) => [
    shell,
    ...["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"].map((bin) => `${bin}/${shell}`),
  ]),
);

/** The flags that hand a shell its script. */
const SCRIPT_FLAGS: ReadonlySet<string> = new Set(["-c", "-lc"]);

/** The words between plain spaces or tabs of a script that is one simple command. */
const SCRIPT_SPACE = /[ \t]+/u;

const readPlain = Schema.decodeUnknownOption(CommandPrefixSchema);

/**
 * The argv a joined command stands for, split by POSIX quoting: single
 * quotes literal, double quotes with their escapes, a backslash outside
 * them escaping the next character; none where a quote is left open, a line
 * break stands anywhere, or a character a shell reads as more than a word
 * stands unquoted.
 */
function splitJoined(command: string): readonly string[] | undefined {
  if (/[\r\n]/u.test(command)) return undefined;
  const words: string[] = [];
  let word: string | undefined;
  let at = 0;
  while (at < command.length) {
    const char = command.charAt(at);
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
      at += 1;
    } else if (char === "'") {
      const close = command.indexOf("'", at + 1);
      if (close < 0) return undefined;
      word = (word ?? "") + command.slice(at + 1, close);
      at = close + 1;
    } else if (char === '"') {
      const read = readDoubleQuoted(command, at + 1);
      if (read === undefined) return undefined;
      word = (word ?? "") + read.text;
      at = read.next;
    } else if (char === "\\") {
      if (at + 1 >= command.length) return undefined;
      word = (word ?? "") + command.charAt(at + 1);
      at += 2;
    } else if (/[;&|<>$`(){}[\]*?#!~]/u.test(char)) {
      return undefined;
    } else {
      word = (word ?? "") + char;
      at += 1;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

/** A double-quoted span from just past its opening quote: its text and where it ends, none where it is left open or substitutes. */
function readDoubleQuoted(
  command: string,
  from: number,
): { readonly text: string; readonly next: number } | undefined {
  let text = "";
  let at = from;
  while (at < command.length) {
    const char = command.charAt(at);
    if (char === '"') return { text, next: at + 1 };
    // Note that a substitution inside double quotes still runs, so it is no plain word.
    if (char === "$" || char === "`") return undefined;
    if (char === "\\" && at + 1 < command.length && /["\\$`]/u.test(command.charAt(at + 1))) {
      text += command.charAt(at + 1);
      at += 2;
    } else {
      text += char;
      at += 1;
    }
  }
  return undefined;
}

/** Whether a word is one a prefix's token could be: a prefix holds a few, but a command any number. */
function isPlainWord(word: string): boolean {
  return Option.isSome(readPlain([word]));
}

/** The words a shell's script runs, where it is one simple command of plain words; none otherwise. */
function scriptWords(script: string): readonly string[] | undefined {
  const trimmed = script.trim();
  if (trimmed === "") return undefined;
  const words = trimmed.split(SCRIPT_SPACE);
  return words.every(isPlainWord) ? words : undefined;
}

/** The plain words the argv runs: a shell's script read as its one command, or the argv itself; none where any is no plain word. */
function commandWords(argv: readonly string[]): readonly string[] | undefined {
  const [program, flag, script, ...rest] = argv;
  if (
    program !== undefined &&
    SHELLS.has(program) &&
    flag !== undefined &&
    SCRIPT_FLAGS.has(flag)
  ) {
    return script === undefined || rest.length > 0 ? undefined : scriptWords(script);
  }
  return argv.length > 0 && argv.every(isPlainWord) ? argv : undefined;
}

/** Whether the words begin with the prefix's, token for token. */
function startsWith(words: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= words.length && prefix.every((token, at) => words[at] === token);
}

/**
 * Whether the joined command Codex asks about is one plain command starting
 * with one of the allowed prefixes; false wherever it cannot be read as one.
 * Note that a listed prefix is read again as a prefix, since an empty one
 * would start every command.
 */
export function commandAllowed(command: string, allowed: readonly (readonly string[])[]): boolean {
  const argv = splitJoined(command);
  const words = argv === undefined ? undefined : commandWords(argv);
  return (
    words !== undefined &&
    allowed.some((prefix) => Option.isSome(readPlain(prefix)) && startsWith(words, prefix))
  );
}

/** The prefix Codex proposed as an ask's exec-policy amendment, where it is one the member's list keeps; none otherwise. */
export function proposedPrefix(amendment: unknown): CommandPrefix | undefined {
  return Option.getOrUndefined(readPlain(amendment));
}
