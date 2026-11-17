import assert from "node:assert/strict";
import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
  MAC_SKILL_APP,
  type MacSkillApp,
} from "@repo/features/installed-skill-wire";
import { MAC_SKILL_LEFT, type MacSkill, type MacSkills } from "@repo/host/contract";
import { test } from "vitest";
import { emptyLine, macSkillsReview, summaryLine } from "./mac-skills-model.js";

/**
 * Bring in from your Mac judged without drawing: a skill the reader already
 * has with the same files left out, one whose name is taken coming in under
 * the first free number, and each agent's folder grouped with what it offers
 * and what it left out. Synthetic skills and folders throughout.
 */

const base64 = (text: string) => Buffer.from(text).toString("base64");

const skillText = (name: string, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: ${name} described\n---\n\n${body}\n`;

function onMac(app: MacSkillApp, name: string, body?: string): MacSkill {
  const text = skillText(name, body);

  return {
    app,
    folder: `~/.${app}/skills/${name}`,
    name,
    description: `${name} described`,
    bytes: text.length,
    files: [{ path: "SKILL.md", base64: base64(text) }],
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

function content(name: string, body?: string): InstalledSkillContent {
  const text = skillText(name, body);

  return { id: `id-${name}`, skillFile: text, files: [{ path: "SKILL.md", bytes: text.length }] };
}

const READ: MacSkills = {
  sources: [
    { app: MAC_SKILL_APP.CLAUDE_CODE, folder: "~/.claude/skills", present: true },
    { app: MAC_SKILL_APP.CODEX, folder: "~/.codex/skills", present: true },
    { app: MAC_SKILL_APP.CURSOR, folder: "~/.cursor/skills", present: false },
    { app: MAC_SKILL_APP.AGENTS, folder: "~/.agents/skills", present: true },
  ],
  skills: [
    onMac(MAC_SKILL_APP.CLAUDE_CODE, "pr-review"),
    onMac(MAC_SKILL_APP.CLAUDE_CODE, "release-notes", "Drafts from merged PRs."),
    onMac(MAC_SKILL_APP.CODEX, "release-notes", "Another take."),
    onMac(MAC_SKILL_APP.CODEX, "flaky-tests"),
  ],
  left: [
    {
      app: MAC_SKILL_APP.CODEX,
      folder: "~/.codex/skills/.system/plan",
      name: "plan",
      reason: MAC_SKILL_LEFT.APP_OWN,
    },
    {
      app: MAC_SKILL_APP.AGENTS,
      folder: "~/.agents/skills/leaky",
      name: "leaky",
      reason: INSTALLED_SKILL_REFUSAL.CREDENTIAL,
    },
  ],
};

test("a skill already installed with the same files is left out, and a taken name comes in under the first free number", () => {
  const review = macSkillsReview(
    READ,
    [personal("pr-review"), personal("release-notes"), personal("release-notes-2")],
    new Map([
      ["pr-review", content("pr-review")],
      ["release-notes", content("release-notes", "Writes notes in the changelog's voice.")],
    ]),
  );

  assert.deepEqual(
    review.offered.map(({ skill, name, renamedFrom }) => [skill.folder, name, renamedFrom]),
    [
      ["~/.claude-code/skills/release-notes", "release-notes-3", "release-notes"],
      ["~/.codex/skills/release-notes", "release-notes-4", "release-notes"],
      ["~/.codex/skills/flaky-tests", "flaky-tests", undefined],
    ],
  );
  assert.deepEqual(
    review.groups.map((group) => ({
      title: group.title,
      offered: group.offered.map((each) => each.name),
      skipped: group.skipped.map(({ name, why }) => [name, why]),
    })),
    [
      {
        title: "Claude Code",
        offered: ["release-notes-3"],
        skipped: [["pr-review", "Already installed, with the same files"]],
      },
      {
        title: "Codex",
        offered: ["release-notes-4", "flaky-tests"],
        skipped: [["plan", "Codex keeps it itself"]],
      },
      {
        title: "Shared agents folder",
        offered: [],
        skipped: [["leaky", "Holds something shaped like a credential"]],
      },
    ],
  );
  assert.equal(emptyLine(review.empty), "Nothing in Cursor.");
  assert.equal(summaryLine(review), "Found 3 skills to bring in, and left out 3.");
});
