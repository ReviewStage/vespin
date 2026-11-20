import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { INSTALLED_SKILL_REFUSAL, MAC_SKILL_APP } from "@repo/features/installed-skill-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import { readMacSkills } from "./mac-skills.js";

/**
 * The Mac's skills read from a home folder the test lays out in a temporary
 * directory: a skill offered with its own files, a folder linked from a
 * second agent's skills folder offered once, from where it really is, an
 * agent's own skill passed over, a file linked from outside a skill's folder
 * left out of it, an invalid one left out with why, and only the folders
 * asked read. Synthetic skills throughout.
 */

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`;

it.effect(
  "a home's skills are offered with their own files, a linked folder once and an agent's own never, and an invalid one is left out with why",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* temporaryDirectoryScoped("mac-skills-");

      const write = (relative: string, text: string) =>
        Effect.gen(function* () {
          const at = path.join(home, relative);
          yield* fs.makeDirectory(path.dirname(at), { recursive: true });
          yield* fs.writeFileString(at, text);
        });

      yield* write(".agents/skills/release-notes/SKILL.md", skillFile("release-notes", "Notes."));
      yield* write(".agents/skills/release-notes/scripts/tags.sh", "git tag --list");
      yield* write(".agents/skills/release-notes/.DS_Store", "finder");
      yield* write(".agents/skills/release-notes/node_modules/dep/index.js", "module");
      yield* write(".claude/skills/flaky-tests/SKILL.md", skillFile("flaky-tests", "Reruns."));
      yield* write(".netrc", "machine example.test");
      yield* fs.symlink(
        path.join(home, ".netrc"),
        path.join(home, ".claude/skills/flaky-tests/netrc"),
      );
      yield* write(".claude/skills/no-description/SKILL.md", "---\nname: no-description\n---\n");
      yield* write(".claude/skills/not-a-skill/README.md", "No SKILL.md here.");
      yield* write(".codex/skills/.system/plan/SKILL.md", skillFile("plan", "Codex's own."));
      yield* write(".cursor/skills/unasked/SKILL.md", skillFile("unasked", "Never read."));
      // `npx skills add` keeps the folder under ~/.agents and links it into each agent's.
      yield* fs.symlink(
        path.join(home, ".agents/skills/release-notes"),
        path.join(home, ".claude/skills/release-notes"),
      );

      const read = yield* readMacSkills(home, [
        MAC_SKILL_APP.CODEX,
        MAC_SKILL_APP.CLAUDE_CODE,
        MAC_SKILL_APP.AGENTS,
      ]);

      assert.deepEqual(
        read.sources.map(({ app, present }) => [app, present]),
        [
          [MAC_SKILL_APP.AGENTS, true],
          [MAC_SKILL_APP.CLAUDE_CODE, true],
          [MAC_SKILL_APP.CODEX, true],
        ],
        "the folders asked, the shared one first, and no Cursor folder unasked",
      );
      assert.deepEqual(
        read.skills.map(({ app, folder, name, files }) => ({
          app,
          folder,
          name,
          files: files.map((file) => [file.path, Buffer.from(file.base64, "base64").toString()]),
        })),
        [
          {
            app: MAC_SKILL_APP.AGENTS,
            folder: "~/.agents/skills/release-notes",
            name: "release-notes",
            files: [
              ["SKILL.md", skillFile("release-notes", "Notes.")],
              ["scripts/tags.sh", "git tag --list"],
            ],
          },
          {
            app: MAC_SKILL_APP.CLAUDE_CODE,
            folder: "~/.claude/skills/flaky-tests",
            name: "flaky-tests",
            files: [["SKILL.md", skillFile("flaky-tests", "Reruns.")]],
          },
        ],
      );
      // Note that the link from Claude Code's folder and Codex's own skill are passed over, unlisted.
      assert.deepEqual(read.left, [
        {
          app: MAC_SKILL_APP.CLAUDE_CODE,
          folder: "~/.claude/skills/no-description",
          name: "no-description",
          reason: INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID,
        },
      ]);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
