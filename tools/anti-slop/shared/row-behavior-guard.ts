import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

/**
 * row-behavior-guard.ts -- what the `row-behavior-in-row` rule reads: the
 * shared rows whose behavior props (a menu, a rename, a selection, the
 * muted and unread states) only their row components hand them, and those
 * row components, each with why it draws them. Root AGENTS.md's Layout says
 * why: a page that builds a menu around a shared row leaves every other
 * page drawing that row without one. The rule started clean, so it takes no
 * baseline.
 */
export const ROW_BEHAVIOR_GUARD_RULE = "anti-slop/row-behavior-in-row";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NonEmpty = Schema.NonEmptyString;

const RowBehaviorFileSchema = Schema.Struct({
  rows: Schema.Record(
    NonEmpty,
    Schema.Struct({ from: NonEmpty, behavior: Schema.Array(NonEmpty) }),
  ),
  drawers: Schema.Record(NonEmpty, NonEmpty),
});

const ROW_BEHAVIOR_FILE = Schema.decodeUnknownSync(Schema.fromJsonString(RowBehaviorFileSchema), {
  onExcessProperty: "error",
})(readFileSync(path.join(PLUGIN_DIRECTORY, "row-behavior.json"), "utf8"));

/** A guarded row: the module it is imported from, and the props only its row components pass it. */
export interface GuardedRow {
  readonly from: string;
  readonly behavior: ReadonlySet<string>;
}

/** Each guarded row by the name its module exports it under. */
export const GUARDED_ROWS: ReadonlyMap<string, GuardedRow> = new Map(
  Object.entries(ROW_BEHAVIOR_FILE.rows).map(([name, row]) => [
    name,
    { from: row.from, behavior: new Set(row.behavior) },
  ]),
);

/** The row components, by repository path, each with the one line that says what it draws. */
export const ROW_DRAWERS: Readonly<Record<string, string>> = ROW_BEHAVIOR_FILE.drawers;

/** Whether an import's source is a row's module: a package by its name, or a file by its own name at the end of any relative or package path. */
export function isRowModule(source: string, from: string): boolean {
  return source === from || source.endsWith(`/${from}`);
}

/** A test draws what it checks, and what tests share sets rows up, so the rule leaves them be. */
export function isTestFile(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}
