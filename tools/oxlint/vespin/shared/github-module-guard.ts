import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

/**
 * github-module-guard.ts -- what the `github-through-module` rule reads: the
 * files that may name GitHub's API outside `@repo/github`, and the files
 * that may open a member's saved GitHub token, each with why. Every request
 * to GitHub's API goes through the module, so its identities, throttle, and
 * rate-limit holds see it, and a saved token is used only through the
 * module's `GitHubMemberTokens`. The rule started clean, so it takes no
 * baseline.
 */
export const GITHUB_MODULE_GUARD_RULE = "vespin/github-through-module";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NonEmpty = Schema.NonEmptyString;

const GitHubModuleFileSchema = Schema.Struct({
  apiCallers: Schema.Record(NonEmpty, NonEmpty),
  tokenOpeners: Schema.Record(NonEmpty, NonEmpty),
});

const GITHUB_MODULE_FILE = Schema.decodeUnknownSync(Schema.fromJsonString(GitHubModuleFileSchema), {
  onExcessProperty: "error",
})(readFileSync(path.join(PLUGIN_DIRECTORY, "github-through-module.json"), "utf8"));

/** GitHub's REST API host, which only the module sends to. */
export const GITHUB_API_HOST = "api.github.com";

/** The header naming GitHub's REST API version, which only the module sets. */
export const GITHUB_API_VERSION_HEADER = "x-github-api-version";

/** The packages the module's Octokit comes from, by their scope. */
export const OCTOKIT_SCOPE = "@octokit/";

/** The export that opens a member's saved GitHub token, and the module it is exported from. */
export const TOKEN_OPENER = { NAME: "openGitHubToken", FROM: "provider-key-seal" } as const;

/** The service's `GitHubMemberTokens` implementation, whose exports hand out an opened token. */
export const MEMBER_TOKENS_FILE = "packages/service/src/github/github-token.ts";

/** Whether a file is named in the list given, by repository path or, ending in `/`, a folder. */
function isListed(list: Readonly<Record<string, string>>, file: string): boolean {
  return Object.keys(list).some((entry) =>
    entry.endsWith("/") ? file.startsWith(entry) : file === entry,
  );
}

/** A test or what tests share stands a fake GitHub and seeds tokens, so the rule leaves it be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}

/** Whether a file may name GitHub's API: the module, a listed file, or a test. */
export function mayCallApi(file: string): boolean {
  return isListed(GITHUB_MODULE_FILE.apiCallers, file) || isTestFile(file);
}

/** Whether a file may open a member's saved token: a listed file, or a test. */
export function mayOpenToken(file: string): boolean {
  return isListed(GITHUB_MODULE_FILE.tokenOpeners, file) || isTestFile(file);
}

/** Whether a file's text names what the rule refuses, as far as the text says: the only file that has anything to silence. */
export function namesGitHubBypass(text: string): boolean {
  const lowered = text.toLowerCase();
  return (
    lowered.includes(GITHUB_API_HOST) ||
    lowered.includes(GITHUB_API_VERSION_HEADER) ||
    text.includes(OCTOKIT_SCOPE) ||
    text.includes(TOKEN_OPENER.NAME) ||
    text.includes("github-token.js")
  );
}
