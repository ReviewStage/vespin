/**
 * installed-skills-procedures.ts -- the skills members install into the app, as hosted procedures: list the ones a workspace offers the account, read one, preview a paste, install from it, and remove one.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the
 * resource so it runs before an input is read) and runs the one operation
 * the member MCP tools run too (`installed-skills.ts`), which says who may
 * do what. The list still answers a desktop released before writes
 * answered their transaction.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  installSkills,
  listSkills,
  previewSkillPaste,
  readSkill,
  removeSkill,
} from "./installed-skills.js";

export interface InstalledSkillsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The installed skills resource: every procedure to a signed-in caller. */
export function installedSkillsProcedures(seams: InstalledSkillsProcedureSeams) {
  const skills = hosted.installedSkills.use(accountMiddleware(seams.resolveUserId));

  return {
    /** The skills the account sees in the workspace: the workspace's, then its own. */
    list: skills.list.effect(function* ({ input, context: { userId } }) {
      return yield* listSkills(userId, input.workspaceId);
    }),

    /** One skill the account reads, whole: its `SKILL.md` and its files. */
    read: skills.read.effect(function* ({ input, context: { userId } }) {
      return yield* readSkill(userId, input.id);
    }),

    /** What a paste would install, read as an install reads it; nothing is written. */
    preview: skills.preview.effect(function* ({ input, context: { userId } }) {
      return yield* previewSkillPaste(userId, input);
    }),

    /** The skills a paste makes, installed in the scope asked, all or none. */
    install: skills.install.effect(function* ({ input, context: { userId } }) {
      return yield* installSkills(userId, input);
    }),

    /** One skill removed with its files. */
    remove: skills.remove.effect(function* ({ input, context: { userId } }) {
      return yield* removeSkill(userId, input.id);
    }),
  };
}
