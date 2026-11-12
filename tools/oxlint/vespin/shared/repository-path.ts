import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(PLUGIN_DIRECTORY, "..", "..", "..");

/** A linted file's path relative to the repository root, with forward slashes. */
export function repositoryPathOf(filename: string): string {
  return path.relative(REPOSITORY_ROOT, filename).split(path.sep).join("/");
}

/**
 * The TypeScript sources a rule reads: the repository's `.mjs` build and
 * evidence scripts are plain Node harnesses, so a rule scoped to the app's
 * code is scoped by extension rather than by a row apiece.
 */
export const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts)$/u;
