/**
 * conductor-scripts.ts -- a repository's Conductor scripts carried over into the workspace's sandbox setup: its setup and archive scripts and its cloud run actions, read from its default branch, and written only where the workspace has none of its own.
 *
 * Conductor keeps a repository's scripts in the repository: in
 * `.conductor/settings.toml` (`[scripts]`, with `setup`, `archive`, and
 * `run` either one command or `[scripts.run.<name>]` tables), or in the
 * legacy `conductor.json` (a `scripts` object), which Conductor reads only
 * where `settings.toml` stands nowhere; so does this. A member's own
 * `.conductor/settings.local.toml` is never read. A run action Conductor
 * offers only on a member's Mac (`available_in = "local"`) or hides is
 * left out, and `run_mode` has no place here, since every run action runs
 * in its own agent's sandbox.
 *
 * Conductor sets variables of its own for its scripts, which a script, or
 * a file a script runs, may read. Every script and command carried over
 * is prefixed with the `export` lines that set the ones a cloud workspace
 * of Conductor's carries and a sandbox can stand in for, each from where
 * the script runs (the checkout), so it runs unchanged; the ones a cloud
 * workspace leaves unset, as `CONDUCTOR_PORT`, stay unset here too.
 *
 * Nothing a member saved is ever replaced: a setup or archive script is
 * written only where the repository has none of that kind, read and
 * written in one transaction, and the run actions only where the
 * repository has no list, decided under the list's own lock.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  editRunActions,
  type RunActionWrite,
  readRepositorySetup,
  setRepositorySetup,
} from "@repo/database/models/workspace-sandbox-script-store";
import { shellQuoted } from "@repo/features/shell-quote";
import { TASK_SECTION_ICON_KIND, taskSectionIconSchema } from "@repo/features/task-section-wire";
import {
  REPOSITORY_SCRIPT_KIND,
  type RepositoryScriptKind,
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Data, Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import { parse as parseToml } from "smol-toml";
import type { GitHubUnavailable } from "../github/github-app.js";
import { readRepositoryFile } from "../github/repository-file.js";

/** The files Conductor keeps a repository's scripts in, in the order they are looked for. */
export const CONDUCTOR_SCRIPTS_FILE = {
  SETTINGS_TOML: ".conductor/settings.toml",
  CONDUCTOR_JSON: "conductor.json",
} as const;

type ConductorScriptsFile = (typeof CONDUCTOR_SCRIPTS_FILE)[keyof typeof CONDUCTOR_SCRIPTS_FILE];

/** The largest scripts file read; a larger one is taken as unreadable. */
const MAX_FILE_BYTES = 256 * 1024;

/** The label a run action gets where Conductor names none: its one legacy `run` command's. */
const LEGACY_RUN_LABEL = "Run";

/** Where a Conductor run action may run; this carries over the cloud's alone. */
const CONDUCTOR_PLACE = {
  LOCAL: "local",
  CLOUD: "cloud",
} as const;

/**
 * Conductor's own variables a sandbox stands in for, each as the bash that
 * sets it from the checkout a script runs in. In a Conductor cloud
 * workspace the root is the workspace itself, and it is no local one.
 */
const CONDUCTOR_EXPORTS = [
  'export CONDUCTOR_WORKSPACE_PATH="$PWD"',
  'export CONDUCTOR_ROOT_PATH="$PWD"',
  'export CONDUCTOR_BASE_DIR="$(dirname "$PWD")"',
  "export CONDUCTOR_IS_LOCAL=0",
].join("\n");

const RunEntrySchema = Schema.Struct({
  command: Schema.String,
  available_in: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  default: Schema.optionalKey(Schema.Boolean),
  icon: Schema.optionalKey(Schema.String),
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  options: Schema.optionalKey(Schema.Struct({ cwd: Schema.optionalKey(Schema.String) })),
  hide: Schema.optionalKey(Schema.Boolean),
});

type RunEntry = typeof RunEntrySchema.Type;

/** A named action read loosely: one Conductor would refuse reads as none, so it costs that action alone. */
const LooseRunEntrySchema = Schema.NullOr(RunEntrySchema).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
);

/** A file's `run`: one legacy command, or named actions by their names. */
const RunSchema = Schema.Union([Schema.String, Schema.Record(Schema.String, LooseRunEntrySchema)]);

type Run = typeof RunSchema.Type;

/** What either file holds under its scripts. */
const ScriptsSchema = Schema.Struct({
  setup: Schema.optionalKey(Schema.String),
  archive: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(RunSchema),
});

const SettingsTomlSchema = Schema.Struct({ scripts: Schema.optionalKey(ScriptsSchema) });

const ConductorJsonSchema = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optionalKey(ScriptsSchema) }),
);

const decodeSettings = Schema.decodeUnknownOption(SettingsTomlSchema);
const decodeJson = Schema.decodeUnknownOption(ConductorJsonSchema);
const isCommand = Schema.is(Schema.String);
const decodeIcon = Schema.decodeUnknownOption(taskSectionIconSchema);

/** A repository's Conductor scripts as this workspace would keep them, each already prefixed with Conductor's variables. */
interface ConductorScripts {
  readonly setup?: string;
  readonly archive?: string;
  readonly runActions: readonly RunActionWrite[];
}

/** What a carry-over found in the repository: no scripts file, one it could not read, or the scripts one holds. */
export const CONDUCTOR_SCRIPTS_FOUND = {
  NONE: "none",
  UNREADABLE: "unreadable",
  READ: "read",
} as const;

type ConductorScriptsFound = (typeof CONDUCTOR_SCRIPTS_FOUND)[keyof typeof CONDUCTOR_SCRIPTS_FOUND];

/** What one repository's carry-over did: which file it read, and which of the workspace's empty scripts it filled. */
interface ConductorScriptsCarried {
  readonly found: ConductorScriptsFound;
  readonly file?: ConductorScriptsFile;
  readonly filledSetup: boolean;
  readonly filledArchive: boolean;
  readonly filledRunActions: number;
}

/** The repository's run actions stood when the carry-over came to write them, so it writes none. */
class RunActionsStand extends Data.TaggedError("RunActionsStand") {}

/** The script with Conductor's variables set before it; nothing where it is empty or past the bound a saved script keeps. */
function prefixed(script: string | undefined, maxChars: number): string | undefined {
  if (script === undefined || script.trim() === "") return undefined;
  const full = `${CONDUCTOR_EXPORTS}\n${script}`;

  return full.length > maxChars ? undefined : full;
}

/** Whether Conductor offers the action in its cloud workspaces: where it names no place, it offers it in both. */
function inCloud(entry: RunEntry): boolean {
  const places = entry.available_in;

  if (places === undefined) return true;

  return [places].flat().includes(CONDUCTOR_PLACE.CLOUD);
}

/** The bash a named action runs: its command with its arguments quoted after it, from its folder where it names one. */
function entryCommand(entry: RunEntry): string {
  const args = (entry.args ?? []).map(shellQuoted).join(" ");
  const command = args === "" ? entry.command : `${entry.command} ${args}`;
  const cwd = entry.options?.cwd;

  return cwd === undefined || cwd === "" ? command : `cd ${shellQuoted(cwd)} && ${command}`;
}

/** One run action as this workspace keeps it, or nothing where its command is empty or past the bound. */
function runAction(
  label: string,
  command: string,
  rest: Pick<RunActionWrite, "icon" | "isDefault">,
): RunActionWrite | undefined {
  const bounded = prefixed(command, WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS);

  if (bounded === undefined) return undefined;

  return {
    label: label.slice(0, WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS),
    command: bounded,
    ...rest,
  };
}

/** The run actions a file's `run` names, in its order: one legacy command, or the cloud's named actions; no more than a repository keeps. */
function runActionsOf(run: Run | undefined): RunActionWrite[] {
  if (run === undefined) return [];

  if (isCommand(run)) {
    const action = runAction(LEGACY_RUN_LABEL, run, {});

    return action === undefined ? [] : [action];
  }

  const actions: RunActionWrite[] = [];

  for (const [name, entry] of Object.entries(run)) {
    if (entry === null || entry.hide === true || !inCloud(entry)) continue;

    // Note that an icon is a Lucide glyph by its kebab-case name, as ours are; any other is dropped for the menu's own.
    const icon =
      entry.icon === undefined
        ? undefined
        : Option.getOrUndefined(
            decodeIcon({ kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: entry.icon }),
          );

    const action = runAction(name, entryCommand(entry), {
      ...(icon === undefined ? undefined : { icon }),
      ...(entry.default === true ? { isDefault: true } : undefined),
    });

    if (action !== undefined) actions.push(action);
  }

  return actions.slice(0, WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS);
}

/** A `settings.toml` read, or nothing where it is no valid TOML or holds scripts of no shape Conductor reads. */
function settingsOf(text: string): Option.Option<typeof SettingsTomlSchema.Type> {
  try {
    return decodeSettings(parseToml(text));
  } catch {
    return Option.none();
  }
}

/**
 * A Conductor scripts file's scripts as this workspace would keep them,
 * read as the file it is; nothing where it is no valid file of its kind.
 * A file naming no scripts holds none.
 */
function conductorScriptsOf(
  file: ConductorScriptsFile,
  text: string,
): ConductorScripts | undefined {
  const decoded =
    file === CONDUCTOR_SCRIPTS_FILE.SETTINGS_TOML ? settingsOf(text) : decodeJson(text);

  if (Option.isNone(decoded)) return undefined;
  const scripts = decoded.value.scripts ?? {};
  const setup = prefixed(scripts.setup, WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS);
  const archive = prefixed(scripts.archive, WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS);

  return {
    ...(setup === undefined ? undefined : { setup }),
    ...(archive === undefined ? undefined : { archive }),
    runActions: runActionsOf(scripts.run),
  };
}

/** The repository's script of the kind written where it has none, read and written in one transaction; whether it was. */
const fillScript = Effect.fnUntraced(function* (
  workspaceId: string,
  repository: string,
  kind: RepositoryScriptKind,
  script: string | undefined,
  now: Date,
): Effect.fn.Return<boolean, StoreFailure, DatabaseServices> {
  if (script === undefined) return false;
  const client = yield* SqlClient.SqlClient;

  return yield* client.withTransaction(
    Effect.gen(function* () {
      const standing = yield* readRepositorySetup(workspaceId, repository, kind);

      if (Option.isSome(standing)) return false;
      yield* setRepositorySetup(workspaceId, repository, kind, script, now);

      return true;
    }),
  );
});

/**
 * The scripts written into the workspace for the repository wherever it has
 * none of its own: its setup script, its archive script, and its run
 * actions, each only where nothing of that kind is saved, so no script a
 * member set is ever replaced. Answers which it filled.
 */
const fillEmptyScripts = Effect.fn("service/fillEmptyConductorScripts")(function* (
  workspaceId: string,
  repository: string,
  scripts: ConductorScripts,
  now: Date,
): Effect.fn.Return<
  Omit<ConductorScriptsCarried, "found" | "file">,
  StoreFailure,
  DatabaseServices
> {
  const filledSetup = yield* fillScript(
    workspaceId,
    repository,
    REPOSITORY_SCRIPT_KIND.SETUP,
    scripts.setup,
    now,
  );

  const filledArchive = yield* fillScript(
    workspaceId,
    repository,
    REPOSITORY_SCRIPT_KIND.ARCHIVE,
    scripts.archive,
    now,
  );

  if (scripts.runActions.length === 0) return { filledSetup, filledArchive, filledRunActions: 0 };

  // Note that a list standing fails the edit, which then writes nothing, rather than writing the same list again.
  const written = yield* editRunActions(
    workspaceId,
    repository,
    (standing) =>
      standing.length > 0 ? Effect.fail(new RunActionsStand()) : Effect.succeed(scripts.runActions),
    now,
  ).pipe(Effect.catchTag("RunActionsStand", () => Effect.succeed([])));

  return { filledSetup, filledArchive, filledRunActions: written.length };
});

/** The repository's Conductor scripts file read from its default branch: the first that stands, as text; or why there is none. */
const readScriptsFile = Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  repository: { readonly fullName: string; readonly defaultBranch: string },
): Effect.fn.Return<
  | { readonly found: typeof CONDUCTOR_SCRIPTS_FOUND.NONE }
  | {
      readonly found:
        | typeof CONDUCTOR_SCRIPTS_FOUND.UNREADABLE
        | typeof CONDUCTOR_SCRIPTS_FOUND.READ;
      readonly file: ConductorScriptsFile;
      readonly text?: string;
    },
  GitHubUnavailable,
  HttpClient.HttpClient
> {
  for (const file of Object.values(CONDUCTOR_SCRIPTS_FILE)) {
    const read = yield* readRepositoryFile(token, repository, repository.defaultBranch, file);

    if (!read.regular) continue;

    if (read.content === undefined || read.bytes > MAX_FILE_BYTES) {
      return { found: CONDUCTOR_SCRIPTS_FOUND.UNREADABLE, file };
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(read.content);

    return { found: CONDUCTOR_SCRIPTS_FOUND.READ, file, text };
  }

  return { found: CONDUCTOR_SCRIPTS_FOUND.NONE };
});

/**
 * The repository's Conductor scripts carried over into the workspace: read
 * from its default branch as GitHub holds it now, on a token minted for
 * that repository, and written wherever the workspace has none of its own.
 * A repository with no scripts file, or one that is no valid file of its
 * kind, fills nothing and says so.
 */
export const carryOverConductorScripts = Effect.fn("service/carryOverConductorScripts")(function* (
  token: Redacted.Redacted,
  workspaceId: string,
  repository: { readonly fullName: string; readonly defaultBranch: string },
  now: Date,
): Effect.fn.Return<
  ConductorScriptsCarried,
  GitHubUnavailable | StoreFailure,
  HttpClient.HttpClient | DatabaseServices
> {
  const none = { filledSetup: false, filledArchive: false, filledRunActions: 0 };
  const read = yield* readScriptsFile(token, repository);

  if (read.found === CONDUCTOR_SCRIPTS_FOUND.NONE) return { found: read.found, ...none };
  const scripts = read.text === undefined ? undefined : conductorScriptsOf(read.file, read.text);

  if (scripts === undefined) {
    return { found: CONDUCTOR_SCRIPTS_FOUND.UNREADABLE, file: read.file, ...none };
  }

  const filled = yield* fillEmptyScripts(workspaceId, repository.fullName, scripts, now);

  return { found: CONDUCTOR_SCRIPTS_FOUND.READ, file: read.file, ...filled };
});
