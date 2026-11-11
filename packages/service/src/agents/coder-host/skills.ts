/**
 * skills.ts -- the agent skills a coding agent's session is offered: its repository's, read where its checkout stands, then the ones its member installed.
 *
 * The skills are merged in `../agent-runtime/skills.ts`'s precedence: the
 * repository's, then the workspace's installed skills, then the member's
 * personal ones. A coding agent's checkout already holds each repository
 * skill's sibling files, so its body is led by the folder it stands in
 * within the checkout; an installed skill's files are written by the launch
 * (`nativeSkills`, `runner-sessions.ts`), which hands the harness the
 * installed skills alone, since it finds the repository's in the checkout
 * itself. An agent with no repository is offered its installed skills
 * alone. The member is the agent's starter, whose conversation it is, and
 * for an automation's agent the automation's owner, who starts it; the
 * workspace is its own, read as that member as the agent reads itself
 * (`ownAgentWorkspace`), so its skills stay while that member no longer sees
 * its task.
 */

import { type Agent, hasRepository } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { Effect } from "effect";
import { agentMember, ownAgentWorkspace } from "../../github/workspace-repository.js";
import {
  type AgentSkill,
  installedSkills,
  mergedSkills,
  repositorySkills,
} from "../agent-runtime/skills.js";
import type { RepositorySkill } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import type { CheckoutServices } from "./checkout.js";

/** The body a skill loads as: where it stands in the checkout, so its relative paths resolve, and then its own words. */
function loadedMarkdown(skill: RepositorySkill): string {
  const folder = `${CODER.CHECKOUT_PATH}/${skill.folder}`;
  return `This skill is \`${folder}/SKILL.md\` in the checkout; resolve the files it names relative to \`${folder}/\`.\n\n${skill.markdown}`;
}

/**
 * The installed skills a native harness is handed (`runner-sessions.ts`):
 * the merge of the repository's skills the harness finds itself and the
 * installed ones, less those repository skills, which the harness reads from the checkout. Merged whole first, so
 * an installed skill a repository skill of its name shadows stays out too;
 * a repository skill in a root the harness never reads (`roots`, such as
 * `.claude/skills` for Codex) shadows nothing, since the harness would
 * offer neither. Read from the default branch, and only where the member
 * has a skill installed, since none installed leaves nothing to shadow.
 */
export function nativeSkills(
  target: ConversationTarget,
  agent: Agent,
  roots: readonly string[],
): Effect.Effect<readonly AgentSkill[], never, CheckoutServices> {
  return Effect.gen(function* () {
    // The workspace is read once for both sources, as the agent reads itself.
    const workspaceOf = yield* Effect.cached(ownAgentWorkspace(target.userId, agent));
    const installed = yield* installedSkills(target, workspaceOf);
    // Note that the repository's skills only shadow installed ones, so with none installed they go unread, because
    // each costs a GitHub request in the App's one lane, which the agent's own repository token waits behind.
    if (installed.length === 0) return [];
    const seen = new Set<string>();
    const repository = hasRepository(agent)
      ? yield* repositorySkills(
          target,
          workspaceOf,
          agent.repository,
          agentMember(agent),
          (skill) => {
            if (roots.some((root) => skill.folder.startsWith(`${root}/`))) seen.add(skill.name);
            return loadedMarkdown(skill);
          },
        )
      : [];
    const theirs = repository.filter((skill) => seen.has(skill.name));
    const merged = mergedSkills([theirs, installed]);
    return merged.filter((skill) => !seen.has(skill.name));
  });
}
