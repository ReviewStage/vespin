import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

/**
 * sandbox-delete-guard.ts -- what the `sandbox-delete-in-one-place` rule
 * reads: the helpers that delete a sandbox or a drive, and the files that may
 * delete one, each with why. An agent's sandbox is deleted in
 * `session-sandboxes.ts` alone, so a delete written anywhere else is
 * refused. The rule started clean, so it takes no baseline.
 */
export const SANDBOX_DELETE_GUARD_RULE = "anti-slop/sandbox-delete-in-one-place";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NonEmpty = Schema.NonEmptyString;

const SandboxDeletesFileSchema = Schema.Struct({
  helpers: Schema.Array(NonEmpty),
  deleters: Schema.Record(NonEmpty, NonEmpty),
});

const SANDBOX_DELETES_FILE = Schema.decodeUnknownSync(
  Schema.fromJsonString(SandboxDeletesFileSchema),
  { onExcessProperty: "error" },
)(readFileSync(path.join(PLUGIN_DIRECTORY, "sandbox-deletes.json"), "utf8"));

/** The helpers whose call deletes a sandbox or a drive, by the name they are called under. */
export const DELETE_HELPERS: ReadonlySet<string> = new Set(SANDBOX_DELETES_FILE.helpers);

/** The files that may delete a sandbox, by repository path or, ending in `/`, a folder, each with the one line that says why. */
export const SANDBOX_DELETERS: Readonly<Record<string, string>> = SANDBOX_DELETES_FILE.deleters;

/** Whether a file is one of the deleters, or a test, which sets up and checks what it deletes. */
export function isExemptFile(file: string): boolean {
  return (
    Object.keys(SANDBOX_DELETERS).some((entry) =>
      entry.endsWith("/") ? file.startsWith(entry) : file === entry,
    ) ||
    /\.test\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)(?:tests|testing)\//u.test(file)
  );
}

/** Whether a file's text reaches a sandbox or names a helper, as far as the text says: the only file that has anything to silence. */
export function namesSandboxDelete(text: string): boolean {
  return (
    text.includes("@repo/sandbox") ||
    text.includes("deleteDrive") ||
    [...DELETE_HELPERS].some((helper) => text.includes(helper))
  );
}
