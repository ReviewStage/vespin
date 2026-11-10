import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { archiveThroughAgentChangeRule } from "./archive-through-agent-change.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SERVICE_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/tasks/example.ts");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/tasks/example.test.ts");
const AGENT_CHANGE = path.join(REPOSITORY_ROOT, "packages/service/src/agents/agent-change.ts");

const IMPORT_WRITER =
  'import { archiveAgentCommitted } from "@repo/database/models/agent-store";\n';
const COLUMN_WRITE = "db.update(agentTable).set({ archivedAt: now, archivedBy });";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("archive-through-agent-change", archiveThroughAgentChangeRule, {
  valid: [
    // agent-change.ts is where every archive goes through.
    { code: IMPORT_WRITER, filename: AGENT_CHANGE },
    // A test sets up archived agents to read them.
    { code: `${IMPORT_WRITER}${COLUMN_WRITE}`, filename: TEST_FILE },
    // Reading the store, or the columns, is no archive.
    {
      code: 'import { readAgent } from "@repo/database/models/agent-store";\ndb.update(agentTable).set({ title });',
      filename: SERVICE_FILE,
    },
  ],
  invalid: [
    {
      code: IMPORT_WRITER,
      filename: SERVICE_FILE,
      errors: [{ messageId: "writerOutside", data: { writer: "archiveAgentCommitted" } }],
    },
    {
      code: 'import { archiveAgentOfDoneTask as archive } from "../task-store.js";',
      filename: SERVICE_FILE,
      errors: [{ messageId: "writerOutside", data: { writer: "archiveAgentOfDoneTask" } }],
    },
    {
      code: COLUMN_WRITE,
      filename: SERVICE_FILE,
      errors: [
        { messageId: "columnOutside", data: { column: "archivedAt" } },
        { messageId: "columnOutside", data: { column: "archivedBy" } },
      ],
    },
  ],
});
