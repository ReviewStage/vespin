import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

/**
 * archive-write-guard.ts -- what the `archive-through-agent-change` rule
 * reads: the store's writes that archive an agent or bring one back, each by
 * the store module that exports it, and the files allowed to call them or to
 * write the agent table's `archivedAt` and `archivedBy` themselves, each
 * with its reason. Every archive goes through `agents/agent-change.ts`, so
 * what follows an archive happens on every path. The rule started clean, so
 * it takes no baseline.
 */
export const ARCHIVE_WRITE_GUARD_RULE = "vespin/archive-through-agent-change";

/** The agent table's archive columns; no other table holds a column of either name. */
export const ARCHIVE_COLUMNS: ReadonlySet<string> = new Set(["archivedAt", "archivedBy"]);

/** Drizzle's builder methods that take the columns a statement writes. */
export const WRITE_METHODS: ReadonlySet<string> = new Set(["set", "values"]);

/** A Drizzle write naming an archive column, as far as the text says. */
const COLUMN_WRITE = /\.(?:set|values)\(\s*\{[^}]*\barchived(?:At|By)\b/u;

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NonEmpty = Schema.NonEmptyString;

const ArchiveWritesFileSchema = Schema.Struct({
  writers: Schema.Record(NonEmpty, NonEmpty),
  allowed: Schema.Record(NonEmpty, NonEmpty),
});

const ARCHIVE_WRITES_FILE = Schema.decodeUnknownSync(
  Schema.fromJsonString(ArchiveWritesFileSchema),
  { onExcessProperty: "error" },
)(readFileSync(path.join(PLUGIN_DIRECTORY, "archive-writes.json"), "utf8"));

/** Each archive writer by the name its store exports it under, with that store module's own name. */
export const ARCHIVE_WRITERS: ReadonlyMap<string, string> = new Map(
  Object.entries(ARCHIVE_WRITES_FILE.writers),
);

/** The files allowed to archive, by repository path, each with the one line that says why. */
export const ARCHIVE_ALLOWED: Readonly<Record<string, string>> = ARCHIVE_WRITES_FILE.allowed;

/** Whether an import's source is the store module named: by package subpath or relative path, with or without its extension. */
export function isStoreModule(source: string, store: string): boolean {
  const bare = source.replace(/\.[cm]?[jt]s$/u, "");
  return bare === store || bare.endsWith(`/${store}`);
}

/** Whether `text`, a file's source, names an archive writer or writes an archive column: the only file that has anything to silence. */
export function namesArchiveWrite(text: string): boolean {
  return (
    COLUMN_WRITE.test(text) ||
    [...ARCHIVE_WRITERS.keys()].some((writer) => new RegExp(`\\b${writer}\\b`, "u").test(text))
  );
}

/** A test sets up archived agents to read them, and what tests share does too, so the rule leaves them be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}
