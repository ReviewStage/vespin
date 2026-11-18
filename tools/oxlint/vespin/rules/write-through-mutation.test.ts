import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { writeThroughMutationRule } from "./write-through-mutation.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-list.ts");
const NEW_UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/not-on-the-list.ts");
const ACT_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/act.ts");
const BASELINED_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/use-active-beat.ts");
const BARE_RENAME = "askAct(ACT_KIND.SUBSCRIPTION_RENAME, { subscriptionId, label });\n";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("write-through-mutation", writeThroughMutationRule, {
  valid: [
    // A write sent inside a mutation, its own options or a factory named for one.
    {
      code: "useMutation({ mutationFn: (asked) => askAct(ACT_KIND.SUBSCRIPTION_RENAME, asked) });",
      filename: NEW_FILE,
    },
    {
      code: "mutationOptions({ mutationFn: (asked) => sendAct(ACT_KIND.SOUND_RENAME, asked) });",
      filename: NEW_FILE,
    },
    {
      code: "taskRenameMutation((asked) => sendAct(ACT_KIND.TASKS_RENAME, asked));",
      filename: NEW_FILE,
    },
    // A read or a fetch draws nothing ahead of its answer.
    { code: "askAct(ACT_KIND.TASKS_FILE, { taskId, path });", filename: NEW_FILE },
    // A write kind named but not sent: a fixture's answer, a comparison, a mutation's key, a failure's facts.
    {
      code: [
        "const answers = { [ACT_KIND.SUBSCRIPTION_RENAME]: () => renamed };",
        "const renaming = kind === ACT_KIND.SUBSCRIPTION_RENAME;",
        "const mutationKey = [ACT_KIND.TASKS_EDIT, taskId];",
        "const failure = { surface, act: ACT_KIND.PORT_FORWARD_SET };",
      ].join("\n"),
      filename: NEW_FILE,
    },
    // The port's own caller sends what a mutation's factory asks of it.
    { code: BARE_RENAME, filename: ACT_FILE },
    // A file the baseline still holds, at its count.
    { code: "tellAct(ACT_KIND.ACCOUNT_ACTIVE);", filename: BASELINED_FILE },
    // A test stands in for the host, and code outside the panel is no business of the rule's.
    {
      code: BARE_RENAME,
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-list.test.ts"),
    },
    { code: BARE_RENAME, filename: path.join(REPOSITORY_ROOT, "packages/host/src/example.ts") },
  ],
  invalid: [
    // A write sent bare through any sender, in the panel or the design system.
    { code: BARE_RENAME, filename: NEW_FILE, errors: [{ messageId: "bareWrite" }] },
    {
      code: "pressAct(ACT_KIND.SOUND_CHOOSE, { slot, id });",
      filename: NEW_UI_FILE,
      errors: [{ messageId: "bareWrite" }],
    },
    // A write sent from a callback that is no mutation's.
    {
      code: "const rename = (label) => void sendAct(ACT_KIND.SUBSCRIPTION_RENAME, { label });",
      filename: NEW_FILE,
      errors: [{ messageId: "bareWrite" }],
    },
    // A baselined file past its count, and one holding fewer than its count.
    {
      code: "tellAct(ACT_KIND.ACCOUNT_ACTIVE);\ntellAct(ACT_KIND.ACCOUNT_ACTIVE);",
      filename: BASELINED_FILE,
      errors: [{ messageId: "bareWrite" }],
    },
    {
      code: "const beat = 1;",
      filename: BASELINED_FILE,
      errors: [{ messageId: "staleBaseline" }],
    },
  ],
});
