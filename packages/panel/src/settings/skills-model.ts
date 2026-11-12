import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import { removeSkillQuestion } from "@repo/features/skills-settings-words";
import type { Workspace } from "@repo/features/workspace-wire";
import { CONFIRM_LOSS } from "@repo/ui";

/**
 * skills-model.ts -- Settings › Skills as the window draws it, judged without drawing: a Delete's weight, over the page's shared words and rows (`@repo/features/skills-settings-words`), and Add skill's own judgment shared with the iOS app (`@repo/features/skill-install-model`).
 *
 * The page lists the workspace's skills, then the account's own, the same
 * split the Automations list makes, because whose a skill is decides who
 * may change it and whose agents load it.
 */

/**
 * What Remove asks first (`removeSkillQuestion`): a personal skill's
 * question is red, since its files are deleted past undoing; a workspace
 * skill's asks in the accent, as any act on others does.
 */
export function removeQuestion(
  skill: Pick<InstalledSkillSummary, "name" | "scope">,
  workspace: Pick<Workspace, "name">,
) {
  return {
    ...removeSkillQuestion(skill, workspace),
    loss:
      skill.scope === INSTALLED_SKILL_SCOPE.WORKSPACE
        ? CONFIRM_LOSS.AFFECTS_OTHERS
        : CONFIRM_LOSS.IRREVERSIBLE,
  };
}
