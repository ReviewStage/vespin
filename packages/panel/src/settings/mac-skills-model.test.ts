import assert from "node:assert/strict";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  MAC_SKILL_APP,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import type { MacSkill, MacSkills } from "@repo/host/contract";
import { test } from "vitest";
import { macSkillsReview, summaryLine } from "./mac-skills-model.js";

/**
 * Bring in from your Mac judged without drawing: a skill whose name the
 * reader already has left out, never renamed; a second skill of a name
 * found earlier left out too; each folder grouped with what it offers; and
 * every skill left out listed apart, by its folder and why. Synthetic skills
 * and folders throughout.
 */

function onMac(app: MacSkillApp, name: string): MacSkill {
  return {
    app,
    folder: `~/.${app}/skills/${name}`,
    name,
    description: `${name} described`,
    bytes: 1,
    files: [{ path: "SKILL.md", base64: "LQ==" }],
  };
}

function personal(name: string): InstalledSkillSummary {
  return {
    id: `id-${name}`,
    scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    name,
    description: `${name} described`,
    userInvocable: true,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT },
    enabled: true,
    installedBy: "user-ada",
    manageable: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

const READ: MacSkills = {
  sources: [
    { app: MAC_SKILL_APP.AGENTS, folder: "~/.agents/skills", present: true },
    { app: MAC_SKILL_APP.CLAUDE_CODE, folder: "~/.claude/skills", present: true },
    { app: MAC_SKILL_APP.CODEX, folder: "~/.codex/skills", present: true },
  ],
  skills: [
    onMac(MAC_SKILL_APP.CLAUDE_CODE, "pr-review"),
    onMac(MAC_SKILL_APP.CLAUDE_CODE, "flaky-tests"),
    onMac(MAC_SKILL_APP.CODEX, "flaky-tests"),
    onMac(MAC_SKILL_APP.CODEX, "db-migrations"),
  ],
  left: [
    {
      app: MAC_SKILL_APP.AGENTS,
      folder: "~/.agents/skills/leaky",
      name: "leaky",
      reason: INSTALLED_SKILL_REFUSAL.CREDENTIAL,
    },
  ],
};

test("a name the reader already has, or one found earlier, is left out rather than renamed, and each folder offers the rest", () => {
  const review = macSkillsReview(READ, [personal("pr-review")]);

  assert.deepEqual(
    review.groups.map((group) => [group.title, group.offered.map((skill) => skill.name)]),
    [
      ["Claude Code", ["flaky-tests"]],
      ["Codex", ["db-migrations"]],
    ],
  );
  assert.deepEqual(
    review.skipped.map(({ name, from, why }) => [name, from, why]),
    [
      ["pr-review", "Claude Code", "Already have one"],
      ["flaky-tests", "Codex", "Already have one"],
      ["leaky", "Agents folder", "Holds a credential"],
    ],
  );
  assert.equal(summaryLine(review), "Found 2 skills to bring in, and left out 3.");
});
