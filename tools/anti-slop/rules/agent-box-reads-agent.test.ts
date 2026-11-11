import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { agentBoxReadsAgentRule } from "./agent-box-reads-agent.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/inbox-answer-box.tsx");
const BOX_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/agent-box.tsx");

const READS = 'import { useAgentModel } from "./use-agent-model.js";\n';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("agent-box-reads-agent", agentBoxReadsAgentRule, {
  valid: [
    // The one file that reads an agent for its box reads it.
    { code: READS, filename: BOX_FILE },
  ],
  invalid: [
    {
      code: READS,
      filename: PANEL_FILE,
      errors: [{ messageId: "readOutsideBox", data: { name: "useAgentModel" } }],
    },
  ],
});
