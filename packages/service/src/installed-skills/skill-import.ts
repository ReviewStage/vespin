/**
 * skill-import.ts -- a skill's folder the desktop read from the member's Mac, made a skill as an install keeps one.
 *
 * The desktop sends every file of the folder whole, in base64, with where
 * on the Mac it read them; nothing here reads the Mac. The skill is named
 * by its `SKILL.md`, or by its folder where it declares no name, as a
 * repository's skill is, and comes in under the name the member asked
 * where they already hold a skill of its own: that name is written into
 * its `SKILL.md`'s frontmatter, so a harness reading it from disk names it
 * as the store does. The folder is held to the one check every install is
 * (`@repo/features/installed-skill-check`), and to a bound on its bytes
 * together, which one request carries whole.
 */

import {
  fileText,
  type SkillFile,
  skillHead,
  skillRefusal,
} from "@repo/features/installed-skill-check";
import type { InstalledSkillImportRequest } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SOURCE,
} from "@repo/features/installed-skill-wire";
import { Effect } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal, installedSkillRefused } from "../http/http-effect.js";
import { type MadeSkill, withNameAndDescription } from "./skill-paste-install.js";

/** The folder's own name, which names a skill whose `SKILL.md` declares none. */
function folderName(folder: string): string {
  return folder.split("/").at(-1) ?? "";
}

/** The files with `SKILL.md`'s text written in place, where the skill comes in under another name. */
function renamedFiles(
  files: readonly SkillFile[],
  markdown: string,
  name: string,
  description: string,
): readonly SkillFile[] {
  const written = new TextEncoder().encode(withNameAndDescription(markdown, name, description));

  return files.map((file) =>
    file.path === INSTALLED_SKILL_MAIN_FILE ? { path: file.path, bytes: written } : file,
  );
}

/** The skill a folder read from a Mac makes, refused by name for the first check it breaks; a folder naming one path twice is no request. */
export function madeFromMac(
  asked: InstalledSkillImportRequest,
): Effect.Effect<MadeSkill, HostedRefusal> {
  const sent: readonly SkillFile[] = asked.files.map((file) => ({
    path: file.path,
    bytes: new Uint8Array(Buffer.from(file.base64, "base64")),
  }));

  if (new Set(sent.map((file) => file.path)).size !== sent.length) {
    return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  const main = sent.find((file) => file.path === INSTALLED_SKILL_MAIN_FILE);
  const markdown = main === undefined ? "" : fileText(main.bytes);
  const own = skillHead(markdown, folderName(asked.mac.folder));
  const name = asked.name ?? own.name;
  const total = sent.reduce((bytes, file) => bytes + file.bytes.byteLength, 0);

  const refusal =
    total > INSTALLED_SKILL_BOUNDS.MAX_IMPORT_BYTES
      ? INSTALLED_SKILL_REFUSAL.TOO_LARGE
      : skillRefusal({ name, description: own.description }, sent);

  if (refusal !== undefined) {
    return Effect.fail(
      installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, name || undefined, refusal),
    );
  }

  return Effect.succeed({
    name,
    description: own.description,
    userInvocable: own.userInvocable,
    source: { type: INSTALLED_SKILL_SOURCE.TEXT, mac: asked.mac },
    files: name === own.name ? sent : renamedFiles(sent, markdown, name, own.description),
  });
}
