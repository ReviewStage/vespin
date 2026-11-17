import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { INSTALLED_SKILL_REFUSAL, MAC_SKILL_APP } from "@repo/features/installed-skill-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import { MAC_SKILL_LEFT } from "./contract/mac-skills.js";
import { readMacSkills } from "./mac-skills.js";

/**
 * The Mac's skills read from a home folder the test lays out in a temporary
 * directory: a skill offered with its own files, a folder linked from a
 * second agent's skills folder told once, an agent's own and an invalid
 * skill left out with why, and an agent with no skills folder told as
 * absent. Synthetic skills throughout.
 */

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`;

it.effect(
  "a home's skills are offered with their files, a linked folder once, and every folder left out says why",
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
      yield* write(".claude/skills/no-description/SKILL.md", "---\nname: no-description\n---\n");
      yield* write(".claude/skills/not-a-skill/README.md", "No SKILL.md here.");
      yield* write(".codex/skills/.system/plan/SKILL.md", skillFile("plan", "Codex's own."));
      // `npx skills add` keeps the folder under ~/.agents and links it into each agent's.
      yield* fs.symlink(
        path.join(home, ".agents/skills/release-notes"),
        path.join(home, ".claude/skills/release-notes"),
      );

      const read = yield* readMacSkills(home);

      assert.deepEqual(
        read.sources.map(({ app, present }) => [app, present]),
        [
          [MAC_SKILL_APP.CLAUDE_CODE, true],
          [MAC_SKILL_APP.CODEX, true],
          [MAC_SKILL_APP.CURSOR, false],
          [MAC_SKILL_APP.GEMINI, false],
          [MAC_SKILL_APP.FACTORY, false],
          [MAC_SKILL_APP.AGENTS, true],
        ],
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
            app: MAC_SKILL_APP.CLAUDE_CODE,
            folder: "~/.claude/skills/flaky-tests",
            name: "flaky-tests",
            files: [["SKILL.md", skillFile("flaky-tests", "Reruns.")]],
          },
          {
            app: MAC_SKILL_APP.CLAUDE_CODE,
            folder: "~/.claude/skills/release-notes",
            name: "release-notes",
            files: [
              ["SKILL.md", skillFile("release-notes", "Notes.")],
              ["scripts/tags.sh", "git tag --list"],
            ],
          },
        ],
      );
      assert.deepEqual(read.left, [
        {
          app: MAC_SKILL_APP.CLAUDE_CODE,
          folder: "~/.claude/skills/no-description",
          name: "no-description",
          reason: INSTALLED_SKILL_REFUSAL.SKILL_FILE_INVALID,
        },
        {
          app: MAC_SKILL_APP.CODEX,
          folder: "~/.codex/skills/.system/plan",
          name: "plan",
          reason: MAC_SKILL_LEFT.APP_OWN,
        },
        {
          app: MAC_SKILL_APP.AGENTS,
          folder: "~/.agents/skills/release-notes",
          name: "release-notes",
          reason: MAC_SKILL_LEFT.SAME_FOLDER,
          sameAs: "~/.claude/skills/release-notes",
        },
      ]);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
