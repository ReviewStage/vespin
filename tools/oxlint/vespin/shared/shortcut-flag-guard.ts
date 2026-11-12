/**
 * shortcut-flag-guard.ts -- what the `no-shortcut-flag` rule reads: the
 * panel's menu-item builders that take the menu's subject, and where in their
 * arguments it stands. A menu prints an item's key where the key's target
 * acts on that subject (`packages/panel/src/shortcut-target.ts`), never where
 * a caller worked out a flag of its own. The rule started clean, so it takes
 * no baseline.
 */
export const SHORTCUT_FLAG_GUARD_RULE = "vespin/no-shortcut-flag";

/** Each builder that takes the menu's subject, by the name it is called by, and the argument the subject stands at. */
export const SUBJECT_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ["commandAction", 2],
  ["markReadItem", 1],
  ["versionHistoryItem", 1],
  ["keyedStatusSubmenu", 3],
  ["remindEntries", 2],
  ["resolveAction", 2],
  ["pinAction", 2],
]);

/** Whether `text`, a file's source, calls one of the builders: the only file that has anything to silence. */
export function callsSubjectBuilder(text: string): boolean {
  return [...SUBJECT_ARGUMENT.keys()].some((name) =>
    new RegExp(`\\b${name}\\s*\\(`, "u").test(text),
  );
}
