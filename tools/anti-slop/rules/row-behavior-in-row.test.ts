import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { ROW_DRAWERS } from "../shared/row-behavior-guard.ts";
import { rowBehaviorInRowRule } from "./row-behavior-in-row.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PAGE_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/example-page.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/example-page.test.tsx");
const DRAWER_FILE = path.join(REPOSITORY_ROOT, Object.keys(ROW_DRAWERS)[0] ?? "");

const TASK_ROW = 'import { TaskRow } from "@repo/ui";\n';
const MENU = "function A() { return <TaskRow taskId={t} name={n} menu={m} onOpen={o} />; }";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function page(code: string): { code: string; filename: string } {
  return { code, filename: PAGE_FILE };
}

tester.run("row-behavior-in-row", rowBehaviorInRowRule, {
  valid: [
    // A page hands a shared row what it draws, never what it does.
    page(
      `${TASK_ROW}function A() { return <TaskRow taskId={t} name={n} cells={c} onOpen={o} />; }`,
    ),
    // A row component builds the row's behavior itself.
    { code: `${TASK_ROW}${MENU}`, filename: DRAWER_FILE },
    // A test draws what it checks.
    { code: `${TASK_ROW}${MENU}`, filename: TEST_FILE },
    // A row of the same name from another module is no shared row: the iOS app's own.
    page(
      'import { TaskRow } from "@repo/ui-native";\nfunction A() { return <TaskRow id={i} name={n} unread={u} />; }',
    ),
  ],
  invalid: [
    {
      ...page(`${TASK_ROW}${MENU}`),
      errors: [{ messageId: "behaviorOutsideRow", data: { prop: "menu", row: "TaskRow" } }],
    },
    // An alias, a namespace, or a row component's own module is no way around it.
    {
      ...page(
        'import { AgentListRow as Row } from "./agent-list-row.js";\nfunction A() { return <Row agent={a} editor={e} />; }',
      ),
      errors: [{ messageId: "behaviorOutsideRow", data: { prop: "editor", row: "AgentListRow" } }],
    },
    {
      ...page(
        'import * as ui from "@repo/ui";\nfunction A() { return <ui.TaskRow taskId={t} unread />; }',
      ),
      errors: [{ messageId: "behaviorOutsideRow", data: { prop: "unread", row: "TaskRow" } }],
    },
    // A spread may carry what the rule cannot read.
    {
      ...page(`${TASK_ROW}function A() { return <TaskRow {...props} />; }`),
      errors: [{ messageId: "spreadOntoRow", data: { row: "TaskRow" } }],
    },
  ],
});
