/**
 * skills.ts -- the installed skills a session is offered: the ones its member installed into the app.
 *
 * An installed skill is read from the store
 * (`installed-skill-store.ts`'s `sessionInstalledSkills`), while the member
 * has the Skills experiment on (`EXPERIMENT.SKILLS`): the ones of the
 * workspace the agent works in, where its member is one of it, and the
 * member's own personal ones, which follow them into every workspace, a name
 * an earlier one offers left out of a later one, since two skills of one
 * name would write the same folder. Its supporting files are handed beside
 * its body, for the launch to write (`../coder-host/native-skills.ts`). A
 * repository's own skills are never read here: the harness finds them in the
 * checkout. Read as the session starts, so a read that fails is logged and
 * offers no skills rather than failing the start. */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import {
  type InstalledSkillWithFiles,
  sessionInstalledSkills,
} from "@repo/database/models/installed-skill-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { INSTALLED_SKILL_MAIN_FILE } from "@repo/features/installed-skill-wire";
import { readSkillFile } from "@repo/features/skill-file";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option } from "effect";

/** One skill as a session is offered it: its name, the description it routes on, its body, and the files beside it. */
export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  /** Its supporting files, by path from its folder, `SKILL.md` aside. */
  readonly files?: Readonly<Record<string, Uint8Array>>;
  /** Its own `SKILL.md` as installed, frontmatter and all, for a native harness that reads the folder whole. */
  readonly skillFile?: Uint8Array;
}

/** How a session's workspace is read, as the caller reaches it: none where the agent's member is no longer in it. */
type WorkspaceOf = Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices>;

/** One installed skill as a session is offered it; nothing where it holds no `SKILL.md`. */
function installedAgentSkill(skill: InstalledSkillWithFiles): AgentSkill | undefined {
  const main = skill.files.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);

  if (main === undefined) return undefined;
  const siblings = skill.files.filter((file) => file.path !== INSTALLED_SKILL_MAIN_FILE);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(main.bytes);
  // The body is handed without its frontmatter.
  const body = readSkillFile(text)?.body ?? text.replace(/^\uFEFF/u, "").trim();

  const offered = {
    name: skill.name,
    description: skill.description,
    markdown: body,
    skillFile: main.bytes,
  };

  if (siblings.length === 0) return offered;

  return { ...offered, files: Object.fromEntries(siblings.map((file) => [file.path, file.bytes])) };
}

/**
 * The skills the member installed into the app, as a session is offered them:
 * the workspace's, where the agent's workspace is one the member is still
 * in, then the member's own personal ones, each with its supporting files.
 * None while the member has the Skills experiment off, and none where the
 * store could not be read, which is logged; a skill with no `SKILL.md` is
 * left out, which is logged too.
 */
export const installedSkills = /* @__PURE__ */ Effect.fn("web/installedSkills")(function* (
  target: ConversationTarget,
  /** The workspace whose skills the session is offered, as the caller reaches it. */
  workspaceOf: WorkspaceOf,
): Effect.fn.Return<readonly AgentSkill[], never, DatabaseServices> {
  const read = Effect.gen(function* () {
    if (!(yield* accountExperimentOn(target.userId, EXPERIMENT.SKILLS))) return [];
    const workspace = yield* workspaceOf;

    return yield* sessionInstalledSkills(target.userId, Option.getOrNull(workspace));
  });

  const installed = yield* read.pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The installed skills of conversation ${target.conversationId} were not read: ${failure._tag}`,
        ),
        [],
      ),
    ),
  );

  const skills: AgentSkill[] = [];

  for (const skill of installed) {
    const offered = installedAgentSkill(skill);

    if (offered === undefined) {
      yield* Effect.logWarning(
        `The installed skill ${skill.id} of conversation ${target.conversationId} was left out: it holds no SKILL.md`,
      );
    } else {
      skills.push(offered);
    }
  }

  return skills;
});

/** The skills of every source as one session is offered them, in the order the sources are given, earliest first: a name an earlier source offers is left out of a later one. */
export function mergedSkills(sources: readonly (readonly AgentSkill[])[]): readonly AgentSkill[] {
  const offered = new Map<string, AgentSkill>();

  for (const skill of sources.flat()) {
    if (!offered.has(skill.name)) offered.set(skill.name, skill);
  }

  return [...offered.values()];
}
