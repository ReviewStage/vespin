import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commandAllowed } from "./codex-command-match.js";

/**
 * The runner accepts a Codex ask itself only where the command is one plain
 * command starting with an always-allowed prefix, so each row here is a
 * command a looser reading would let through unasked. Commands are written
 * as Codex joins its argv (`shlex_join`).
 */

const ALLOWED = [
  ["pnpm", "test"],
  ["git", "status"],
];

describe("an always-allowed command on Codex", () => {
  it.each([
    { command: "pnpm test", why: "the bare prefix" },
    { command: "pnpm test --filter web", why: "the prefix with plain arguments" },
    { command: "/bin/bash -lc 'pnpm test --filter web'", why: "a shell's one plain command" },
    { command: "/bin/zsh -c 'git status'", why: "another shell's one plain command" },
    { command: 'bash -lc "pnpm test"', why: "a double-quoted script" },
  ])("matches $why", ({ command }) => {
    assert.equal(commandAllowed(command, ALLOWED), true);
  });

  it.each([
    { command: "pnpm testing", why: "a longer first word" },
    { command: "pnpm", why: "less than the prefix" },
    { command: "/bin/bash -lc 'pnpm test && rm -rf /'", why: "a compound command" },
    { command: "/bin/bash -lc 'pnpm test; rm -rf /'", why: "a sequence" },
    { command: "/bin/bash -lc 'pnpm test | sh'", why: "a pipe" },
    { command: "/bin/bash -lc 'pnpm test & rm -rf /'", why: "a background job" },
    { command: "/bin/bash -lc 'pnpm test $(rm -rf /)'", why: "a command substitution" },
    { command: "/bin/bash -lc 'pnpm test `rm -rf /`'", why: "a backquoted substitution" },
    { command: '/bin/bash -lc "pnpm test \\"$(rm -rf /)\\""', why: "a substitution in quotes" },
    { command: "/bin/bash -lc 'pnpm test > ~/.bashrc'", why: "a redirection" },
    { command: "/bin/bash -lc 'pnpm test *'", why: "a glob" },
    { command: "/bin/bash -lc 'pnpm test\nrm -rf /'", why: "a line break" },
    { command: "/bin/bash -lc 'pnpm test # x'", why: "a comment" },
    { command: "/bin/bash -lc 'pnpm test \"a b\"'", why: "a quoted word inside the script" },
    { command: "/bin/bash -lc 'FOO=1 pnpm test'", why: "an environment prefix" },
    { command: "env FOO=1 pnpm test", why: "a command run through env" },
    { command: "/bin/bash -lc 'pnpm test' extra", why: "a shell handed more than its script" },
    { command: "/bin/bash -e -c 'pnpm test'", why: "a shell flag before its script" },
    { command: "pnpm test 'a b'", why: "an argument holding a space" },
    { command: "pnpm test 'unclosed", why: "an open quote" },
    { command: "pnpm test;rm", why: "an unquoted operator" },
  ])("does not match $why", ({ command }) => {
    assert.equal(commandAllowed(command, ALLOWED), false);
  });

  it("matches nothing for an empty prefix, which would start every command", () => {
    assert.equal(commandAllowed("rm -rf /", [[]]), false);
  });
});
