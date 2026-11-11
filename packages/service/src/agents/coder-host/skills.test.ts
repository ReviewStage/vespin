import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent } from "@repo/database/models/agent-store";
import {
  type InstalledSkillFile,
  type InstalledSkillOwner,
  installSkill,
} from "@repo/database/models/installed-skill-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { EXPERIMENT } from "@repo/settings";
import { noNetwork } from "@repo/wire/testing";
import { sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { nativeSkills } from "./skills.js";

/**
 * The installed skills a native harness is handed, through `nativeSkills`
 * over the real migrations on PGlite: the workspace's, then the member's personal ones, a name offered once by
 * the earliest; none while the member
 * has the Skills experiment off; and an installed read that fails offering
 * none.
 *
 * Synthetic accounts, repositories, and skills throughout.
 */

const REPOSITORY = "acme/relay";

const text = (value: string) => new TextEncoder().encode(value);

const skillText = (name: string, words: string) =>
  `---\nname: ${name}\ndescription: Does ${name}.\n---\n${words}\n`;

const install = (
  userId: string,
  owner: InstalledSkillOwner,
  name: string,
  words: string,
  more: readonly InstalledSkillFile[] = [],
) =>
  Effect.map(
    installSkill(userId, {
      owner,
      name,
      description: `Does ${name}.`,
      userInvocable: true,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      files: [{ path: "SKILL.md", bytes: text(skillText(name, words)) }, ...more],
    }),
    Option.getOrThrow,
  );

const PERSONAL: InstalledSkillOwner = { scope: INSTALLED_SKILL_SCOPE.PERSONAL };

/** An account with an agent on a task of its own workspace, on acme/relay or on no repository, with the Skills experiment on unless asked otherwise. */
const startAgent = (repository: string | null, skillsOn = true) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.SKILLS]: skillsOn } });
    const task = yield* startTask(userId, {
      name: "Teammate invitations",
      ...(repository === null ? {} : { repository }),
    });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: `start-${task.id}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: null,
      prompt: null,
      repository,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    const { agent } = Option.getOrThrow(started);
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    const workspace: InstalledSkillOwner = {
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      organizationId: task.workspaceId,
    };
    return { userId, agent, target, workspace };
  });

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a native harness's skills, unread", (it) => {
  it.effect("hands a native harness no installed skills where they cannot be read", () =>
    Effect.gen(function* () {
      const { userId, agent, target } = yield* startAgent(REPOSITORY);
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");
      const handed = nativeSkills(target, agent);
      const before = yield* handed;
      const db = yield* Database;
      yield* db.execute(sql`drop table installed_skill cascade`);

      const after = yield* handed;

      assert.deepEqual(
        before.map((skill) => skill.name),
        ["pr-style"],
      );
      assert.deepEqual(after, []);
    }),
  );
});

// Note that a database of its own, as the unread case drops a table.
it.layer(Layer.mergeAll(getTestDB(), noNetwork))("a native harness's skills", (it) => {
  it.effect(
    "hands a native harness the installed skills, the workspace's ahead of the member's own, a name once, with their SKILL.md as installed",
    () =>
      Effect.gen(function* () {
        const { userId, agent, target, workspace } = yield* startAgent(REPOSITORY);
        yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
        yield* install(userId, PERSONAL, "release-notes", "My release notes.");
        yield* install(userId, PERSONAL, "pr-style", "My pr style.");

        const skills = yield* nativeSkills(target, agent);

        assert.deepEqual(
          skills.map((skill) => skill.name),
          ["release-notes", "pr-style"],
        );
        assert.equal(
          new TextDecoder().decode(skills[0]?.skillFile),
          skillText("release-notes", "The workspace's release notes."),
        );
      }),
  );

  it.effect("hands none of the installed skills while the member has Skills off", () =>
    Effect.gen(function* () {
      const { userId, agent, target, workspace } = yield* startAgent(null, false);
      yield* install(userId, workspace, "release-notes", "The workspace's release notes.");
      yield* install(userId, PERSONAL, "pr-style", "My pr style.");

      const skills = yield* nativeSkills(target, agent);

      assert.deepEqual(skills, []);
    }),
  );
});
