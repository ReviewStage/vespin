/**
 * skills.ts -- `vespin skills list`, `view`, `install`, and `remove`: the skills installed into the app for the member's agents, as Settings › Skills lists and changes them.
 *
 * Each is one `installedSkills` procedure, in the workspace the command
 * acts in, which says who may do what. A skill is named by its id or its
 * name, read from the list. `install` does what Add skill does: it
 * previews the source first and prints what it would install, the skills
 * the source names (or the one there is) chosen as the dialog ticks them,
 * then installs them pinned to the commit the preview read, once the
 * person goes ahead; `--preview` stops at the preview. `remove` asks
 * first, as the page's Delete does.
 */

import { HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT } from "@repo/features/cli-exit";
import {
  type InstalledSkillPreview,
  type InstalledSkillSummary,
  SKILL_PASTE_KIND,
} from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, confirmOrYes, note, readInput } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** The source argument that reads a skill's text from stdin. */
const STDIN_SOURCE = "-";

/** Refusals said in words that name what to do about them. */
const SKILL_REFUSAL_WORDS = {
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: `The workspace's GitHub installation does not reach that repository; add it to the installation in ${PRODUCT_NAME}'s GitHub settings.`,
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: "A skill of that name is already installed there.",
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED]:
    "The skill's files were refused: a SKILL.md with a valid name and description, no file too large, and nothing shaped like a credential.",
  [HOSTED_API_ERROR.NOT_PERMITTED]:
    "You may not remove that skill: a workspace's skill is removed by its installer and the workspace's owners and admins.",
} as const;

/** A skill as every answer prints it. */
function skillJson(skill: InstalledSkillSummary) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    scope: skill.scope,
    source: skill.source,
    workspaceId: skill.workspaceId ?? null,
    installedBy: skill.installedBy,
    manageable: skill.manageable,
  };
}

/** Where a skill's files came from, in a word or a repository's path. */
function sourceWords(skill: InstalledSkillSummary): string {
  const { source } = skill;
  if (source.type === INSTALLED_SKILL_SOURCE.TEXT) return "pasted text";
  return `${source.owner}/${source.repo}${source.path === "" ? "" : `/${source.path}`}`;
}

/** The skills the member sees in a workspace: the workspace's, then their own. */
function skillsOf(workspaceId: string) {
  return Effect.gen(function* () {
    const { hosted } = yield* session;
    const { skills } = yield* askService(hosted.installedSkills.list, { workspaceId });
    return skills;
  });
}

/** The skill an argument names, by its id or its name in any case, or a usage failure where it names none, or several. */
function resolveSkill(workspaceId: string, named: string) {
  return Effect.gen(function* () {
    const skills = yield* skillsOf(workspaceId);
    const lowered = named.toLowerCase();
    const matches = skills.filter(
      (skill) => skill.id === named || skill.name.toLowerCase() === lowered,
    );
    const [only, ...others] = matches;
    if (only !== undefined && others.length === 0) return only;
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: [
        only === undefined
          ? `${named} is none of the skills installed here.`
          : `${named} names several skills; name one by id.`,
        ...(skills.length === 0
          ? ["No skills are installed here; add one with vespin skills install."]
          : ["Skills:", ...columns(skills.map((skill) => [`  ${skill.id}`, skill.name]))]),
      ].join("\n"),
    });
  });
}

/** A preview as a person reads it, each skill ticked where an install takes it. */
function previewLines(preview: InstalledSkillPreview, chosen: readonly string[]): string[] {
  switch (preview.kind) {
    case SKILL_PASTE_KIND.SOURCE:
      return [
        `${preview.owner}/${preview.repo} at ${preview.ref} (${preview.sha.slice(0, 12)}):`,
        ...(preview.skills.length === 0
          ? ["  No skills found."]
          : columns(
              preview.skills.map((skill) => [
                chosen.includes(skill.name) ? "  [x]" : "  [ ]",
                skill.name,
                skill.path === "" ? "/" : skill.path,
                skill.description ?? "",
              ]),
            )),
      ];
    case SKILL_PASTE_KIND.TEXT:
      return [`A skill's text: ${preview.name ?? "(no name)"}: ${preview.description ?? ""}`];
    case SKILL_PASTE_KIND.UNSUPPORTED:
      return [];
  }
}

/** What an install asks beside the source, as Add skill fills it from the preview: the skills to take and how to say them, or what is missing. */
function installAsked(
  preview: InstalledSkillPreview,
  asked: {
    readonly skill: readonly string[];
    readonly name: Option.Option<string>;
    readonly description: Option.Option<string>;
  },
) {
  if (preview.kind === SKILL_PASTE_KIND.SOURCE) {
    const chosen =
      asked.skill.length > 0
        ? asked.skill
        : preview.skills.filter((skill) => skill.selected).map((skill) => skill.name);
    return {
      chosen,
      request: { skills: chosen, sha: preview.sha },
      missing: "Name the skills to install with --skill.",
    };
  }
  const name =
    Option.getOrUndefined(asked.name) ??
    (preview.kind === SKILL_PASTE_KIND.TEXT ? preview.name : undefined);
  const description =
    Option.getOrUndefined(asked.description) ??
    (preview.kind === SKILL_PASTE_KIND.TEXT ? preview.description : undefined);
  return {
    chosen: name === undefined || description === undefined ? [] : [name],
    request: {
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    },
    missing: "Name the skill with --name and --description; its text declares none.",
  };
}

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const skills = yield* skillsOf(workspace.id);
    yield* answer({
      json: { skills: skills.map(skillJson) },
      lines:
        skills.length === 0
          ? ["No skills installed."]
          : columns(skills.map((skill) => [skill.id, skill.scope, skill.name, sourceWords(skill)])),
      ids: skills.map(({ id }) => id),
    });
  }),
).pipe(
  Command.withDescription("List the skills installed for your agents: the workspace's, then yours"),
  Command.withExamples([{ command: "vespin skills list", description: "Every skill here" }]),
);

const skillArgument = Argument.String("skill").pipe(
  Argument.withDescription("The skill, by its id or its name"),
);

const viewCommand = Command.make("view", { skill: skillArgument }, ({ skill }) =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const named = yield* resolveSkill(workspace.id, skill);
    const { hosted } = yield* session;
    const read = yield* askService(hosted.installedSkills.read, { id: named.id });
    yield* answer({
      json: { ...skillJson(named), skillFile: read.skillFile, files: read.files },
      lines: [
        read.skillFile.trimEnd(),
        "",
        "Files:",
        ...columns(read.files.map((file) => [`  ${file.path}`, `${file.bytes} bytes`])),
      ],
      ids: [named.id],
    });
  }),
).pipe(
  Command.withDescription("Print a skill's SKILL.md and list its files"),
  Command.withExamples([{ command: "vespin skills view frontend-design", description: "Read it" }]),
);

const installCommand = Command.make(
  "install",
  {
    source: Argument.String("source").pipe(
      Argument.withDescription(
        "A GitHub repository (owner/name or its address), a link to one of its folders, an `npx skills add` line, or - for a skill's text on stdin",
      ),
    ),
    preview: Flag.Boolean("preview").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print what would be installed, and install nothing"),
    ),
    scope: Flag.Literals("scope", Object.values(INSTALLED_SKILL_SCOPE)).pipe(
      Flag.withDefault(INSTALLED_SKILL_SCOPE.PERSONAL),
      Flag.withDescription("personal (yours alone) or workspace (every member's agents)"),
    ),
    skill: Flag.String("skill").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "From a repository, a skill to install by name; repeat it for several. Defaults to the ones the source names, or the one there is",
      ),
    ),
    name: Flag.String("name").pipe(
      Flag.optional,
      Flag.withDescription("For a skill's text, the name to install it by"),
    ),
    description: Flag.String("description").pipe(
      Flag.optional,
      Flag.withDescription("For a skill's text, the description to install it by"),
    ),
    yes: Flag.Boolean("yes").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Install without asking"),
    ),
  },
  (asked) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const { hosted } = yield* session;
      const text = asked.source === STDIN_SOURCE ? yield* readInput(STDIN_SOURCE) : asked.source;
      const preview = yield* askService(
        hosted.installedSkills.preview,
        { text, workspaceId: workspace.id },
        undefined,
        SKILL_REFUSAL_WORDS,
      );
      if (preview.kind === SKILL_PASTE_KIND.UNSUPPORTED) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message:
            "That is neither a GitHub repository, a link to one of its folders, an `npx skills add` line, nor a skill's text.",
        });
      }
      const install = installAsked(preview, asked);
      if (asked.preview) {
        return yield* answer({ json: preview, lines: previewLines(preview, install.chosen) });
      }
      for (const line of previewLines(preview, install.chosen)) yield* note(line);
      if (install.chosen.length === 0) {
        return yield* new CommandFailed({ exit: CLI_EXIT.USAGE, message: install.missing });
      }
      yield* confirmOrYes(
        `Install ${install.chosen.join(", ")} for ${asked.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? `everyone in ${workspace.name}` : "you alone"}?`,
        asked.yes,
        "Nothing was installed.",
      );
      const installed = yield* askService(
        hosted.installedSkills.install,
        { text, workspaceId: workspace.id, scope: asked.scope, ...install.request },
        undefined,
        SKILL_REFUSAL_WORDS,
      );
      const skills = installed.skills.map(skillJson);
      yield* answer({
        json: { skills },
        lines: skills.map((skill) => `Installed ${skill.name} (${skill.id}).`),
        ids: skills.map(({ id }) => id),
      });
    }),
).pipe(
  Command.withDescription("Install skills from GitHub or a skill's text, after previewing them"),
  Command.withExamples([
    {
      command: "vespin skills install anthropics/skills --preview",
      description: "List the skills a repository holds",
    },
    {
      command: "vespin skills install anthropics/skills --skill frontend-design --yes",
      description: "Install one of them for you alone",
    },
    {
      command: "vespin skills install - --scope workspace < SKILL.md",
      description: "Install a skill's text for the workspace",
    },
  ]),
);

const removeCommand = Command.make(
  "remove",
  {
    skill: skillArgument,
    yes: Flag.Boolean("yes").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Remove without asking"),
    ),
  },
  ({ skill, yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      const named = yield* resolveSkill(workspace.id, skill);
      yield* confirmOrYes(
        named.scope === INSTALLED_SKILL_SCOPE.WORKSPACE
          ? `Delete ${named.name}? Everyone in ${workspace.name} loses it, and its files are deleted.`
          : `Delete ${named.name}? Its files are deleted.`,
        yes,
      );
      const { hosted } = yield* session;
      yield* askService(
        hosted.installedSkills.remove,
        { id: named.id },
        undefined,
        SKILL_REFUSAL_WORDS,
      );
      yield* answer({
        json: skillJson(named),
        lines: [`Removed ${named.name}; agents started from now on no longer load it.`],
        ids: [named.id],
      });
    }),
).pipe(
  Command.withDescription("Remove an installed skill and its files"),
  Command.withExamples([
    { command: "vespin skills remove frontend-design", description: "Asks first" },
  ]),
);

/** The skills group: list, view, install, and remove. */
export const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("List, read, install, and remove the skills your agents load"),
  Command.withSubcommands([listCommand, viewCommand, installCommand, removeCommand]),
  Command.withExamples([{ command: "vespin skills list", description: "Every skill here" }]),
);
