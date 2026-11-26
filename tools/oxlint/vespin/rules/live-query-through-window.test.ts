import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { liveQueryThroughWindowRule } from "./live-query-through-window.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const SCREEN = path.join(REPOSITORY_ROOT, "apps/mobile/src/tasks/use-example.ts");
const WINDOW = path.join(REPOSITORY_ROOT, "apps/mobile/src/host/use-window.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("live-query-through-window", liveQueryThroughWindowRule, {
  valid: [
    // The hook every window is read through calls the live query itself.
    { code: 'import { useLiveQuery } from "@tanstack/react-db";', filename: WINDOW },
    // The panel reads live queries its own way, outside the iOS app.
    {
      code: 'import { useLiveQuery } from "@tanstack/react-db";',
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/use-agents.ts"),
    },
  ],
  invalid: [
    // A screen's hook, renamed or not, never reads a live query directly.
    {
      code: 'import { eq, useLiveQuery as live } from "@tanstack/react-db";',
      filename: SCREEN,
      errors: [{ messageId: "direct" }],
    },
  ],
});
