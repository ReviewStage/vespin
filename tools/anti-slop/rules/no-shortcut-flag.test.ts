import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noShortcutFlagRule } from "./no-shortcut-flag.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MENU = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/task-actions.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-shortcut-flag", noShortcutFlagRule, {
  valid: [
    { code: "commandAction(PANEL_COMMAND.PIN, pin, subject);", filename: MENU },
    { code: "markReadItem(read, shortcutSubject(SHORTCUT_SUBJECT.TASK, id));", filename: MENU },
    // A menu no key reaches names no subject.
    { code: "commandAction(PANEL_COMMAND.RENAME, rename, undefined);", filename: MENU },
    { code: "commandAction(PANEL_COMMAND.CLOSE_TAB, close, shown?.subject);", filename: MENU },
    { code: "resolveAction([item], onResolve);", filename: MENU },
    // Another function's third argument is no subject.
    { code: "useAppCommand(APP_COMMAND.PIN, pin, focused);", filename: MENU },
  ],
  invalid: [
    {
      code: "commandAction(PANEL_COMMAND.PIN, pin, true);",
      filename: MENU,
      errors: [{ messageId: "flag" }],
    },
    {
      code: "versionHistoryItem(open, opened !== undefined);",
      filename: MENU,
      errors: [{ messageId: "flag" }],
    },
    {
      code: "markReadItem(read, drawn || rowKeys);",
      filename: MENU,
      errors: [{ messageId: "flag" }],
    },
    {
      code: "keyedStatusSubmenu(standing, id, status, chosen ? subject : undefined);",
      filename: MENU,
      errors: [{ messageId: "flag" }],
    },
    {
      code: "remindEntries(item, remind, !settled);",
      filename: MENU,
      errors: [{ messageId: "flag" }],
    },
  ],
});
