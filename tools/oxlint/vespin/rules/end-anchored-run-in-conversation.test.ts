import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { endAnchoredRunInConversationRule } from "./end-anchored-run-in-conversation.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const PANE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/a-pane.tsx");
const END = "const anchor = VIRTUAL_ROWS_ANCHOR.END;";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("end-anchored-run-in-conversation", endAnchoredRunInConversationRule, {
  valid: [
    // A list read from its top anchors to its start anywhere.
    { code: "const anchor = VIRTUAL_ROWS_ANCHOR.START;", filename: PANE },
    // The log anchors its lines to their end.
    {
      code: END,
      filename: path.join(
        REPOSITORY_ROOT,
        "packages/ui/src/components/conversation/conversation.tsx",
      ),
    },
    // The run and its tests name its own anchors.
    {
      code: END,
      filename: path.join(
        REPOSITORY_ROOT,
        "packages/ui/src/components/virtual-rows/virtual-rows.test.ts",
      ),
    },
  ],
  invalid: [
    { code: END, filename: PANE, errors: [{ messageId: "endAnchor" }] },
    {
      code: 'const anchor = VIRTUAL_ROWS_ANCHOR["END"];',
      filename: PANE,
      errors: [{ messageId: "endAnchor" }],
    },
  ],
});
