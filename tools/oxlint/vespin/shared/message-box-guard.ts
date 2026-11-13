import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

/**
 * message-box-guard.ts -- what the `one-message-box` rule reads: the parts a
 * box words are written in is built from (its field, its `@` and `/` lists,
 * its card, and its foot), each by the module that exports it, and the files
 * that may build with them, each with why. Every other box is drawn on
 * `message-box.tsx`'s `MessageBox` or `MessageField`, so a new one takes its
 * files, dictation, lists, note, and narrow-card fold as every box does. The
 * rule started clean, so it takes no baseline.
 */
export const MESSAGE_BOX_GUARD_RULE = "vespin/one-message-box";

const PLUGIN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NonEmpty = Schema.NonEmptyString;

const MessageBoxFileSchema = Schema.Struct({
  parts: Schema.Record(NonEmpty, NonEmpty),
  builders: Schema.Record(NonEmpty, NonEmpty),
});

const MESSAGE_BOX_FILE = Schema.decodeUnknownSync(Schema.fromJsonString(MessageBoxFileSchema), {
  onExcessProperty: "error",
})(readFileSync(path.join(PLUGIN_DIRECTORY, "message-box.json"), "utf8"));

/** Each part of a box by the name its module exports it under, with that module: a package by its name, or a file by its own name. */
export const BOX_PARTS: ReadonlyMap<string, string> = new Map(
  Object.entries(MESSAGE_BOX_FILE.parts),
);

/** The files that may build with the parts, by repository path, each with the one line that says why. */
export const BOX_BUILDERS: Readonly<Record<string, string>> = MESSAGE_BOX_FILE.builders;

/** Whether an import's source is a part's module: a package by its name, or a file by its own name at the end of any relative or package path. */
export function isPartModule(source: string, from: string): boolean {
  return source === from || source.endsWith(`/${from}`);
}

/** Whether a file is the design system, which defines the parts, or a test, which draws what it checks. */
export function isExemptFile(file: string): boolean {
  return (
    file.startsWith("packages/ui/") ||
    /\.test\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)(?:tests|testing)\//u.test(file)
  );
}

/** Whether a file's text names a part, as far as the text says: the only file that has anything to silence. */
export function namesBoxPart(text: string): boolean {
  return [...BOX_PARTS.keys()].some((part) => text.includes(part));
}
