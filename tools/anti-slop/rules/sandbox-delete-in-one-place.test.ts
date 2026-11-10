import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { sandboxDeleteInOnePlaceRule } from "./sandbox-delete-in-one-place.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SERVICE_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/agents/example.ts");
const OWNER_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/agents/session-sandboxes.ts");

const SANDBOX = 'import { Sandbox, type SandboxService } from "@repo/sandbox";\n';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

/** The code in a generator's body, after the import, as an `Effect.gen` body yields the service. */
function inGenerator(code: string): string {
  return `${SANDBOX}function* body() {\n${code}\n}`;
}

function service(code: string): { code: string; filename: string } {
  return { code: inGenerator(code), filename: SERVICE_FILE };
}

tester.run("sandbox-delete-in-one-place", sandboxDeleteInOnePlaceRule, {
  valid: [
    // A map's or a table's delete is no sandbox's.
    service(`const api = yield* Sandbox;\nwaiting.delete(id);\ndb.delete(agent);`),
    // The file that owns deleting an agent's sandbox deletes it.
    { code: inGenerator("const api = yield* Sandbox;\napi.delete(name);"), filename: OWNER_FILE },
  ],
  invalid: [
    {
      ...service(`const api = yield* Sandbox;\napi.delete(name);`),
      errors: [{ messageId: "deleteOutsideOwner", data: { name: "delete" } }],
    },
    // However the service is reached: typed, through a callback, or yielded in place.
    {
      ...service(
        `function f(own: SandboxService) { return own.delete(name); }\nSandbox.use((api) => api.deleteDrive(name));\n(yield* Sandbox).delete(name);`,
      ),
      errors: [
        { messageId: "deleteOutsideOwner", data: { name: "delete" } },
        { messageId: "deleteOutsideOwner", data: { name: "deleteDrive" } },
        { messageId: "deleteOutsideOwner", data: { name: "delete" } },
      ],
    },
    // A helper that deletes one is refused by name.
    {
      code: 'import { consumeSandboxRelease } from "./session-sandboxes.js";\nconsumeSandboxRelease(name);',
      filename: SERVICE_FILE,
      errors: [{ messageId: "deleteOutsideOwner", data: { name: "consumeSandboxRelease" } }],
    },
  ],
});
