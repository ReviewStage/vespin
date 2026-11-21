/**
 * cursor-skills.test.ts -- the member's installed skills linked into a Cursor agent's checkout, kept out of git, with the repository's own skill of a name winning.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/wire/testing";
import { it } from "vitest";
import { linkInstalledSkills } from "./cursor-skills.js";

/** A git command run in the checkout, its output trimmed. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...(process.env.PATH === undefined ? undefined : { PATH: process.env.PATH }),
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  }).trim();
}

/** A skill's folder at `folder`, its `SKILL.md` saying whose it is. */
function skill(folder: string, words: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), words);
}

it("links each installed skill into .agents/skills, excluded in git once across launches, the repository's own of a name kept", async (t) => {
  const root = await temporaryDirectory(t, "cursor-skills-");
  const checkout = join(root, "checkout");
  const installed = join(root, "installed");
  mkdirSync(checkout);
  git(checkout, "init", "--quiet", "--initial-branch=main");
  skill(join(checkout, ".agents/skills/review"), "the repository's review");
  git(checkout, "add", "-A");
  git(checkout, "commit", "--quiet", "-m", "first");
  skill(join(installed, "skills/review"), "the member's review");
  skill(join(installed, "skills/deploy"), "the member's deploy");

  linkInstalledSkills(checkout, installed);
  linkInstalledSkills(checkout, installed);

  const read = (name: string) =>
    readFileSync(join(checkout, ".agents/skills", name, "SKILL.md"), "utf8");

  assert.equal(read("deploy"), "the member's deploy");
  assert.equal(read("review"), "the repository's review");
  assert.equal(git(checkout, "status", "--porcelain", "--untracked-files=all"), "");
  assert.deepEqual(
    readFileSync(join(checkout, ".git/info/exclude"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("/")),
    ["/.agents/skills/deploy"],
  );
});
