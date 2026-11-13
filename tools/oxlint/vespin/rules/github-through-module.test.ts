import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { githubThroughModuleRule } from "./github-through-module.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const SERVICE_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/github/example.ts");
const MODULE_FILE = path.join(REPOSITORY_ROOT, "packages/github/src/example.ts");
const MEMBER_TOKENS_FILE = path.join(
  REPOSITORY_ROOT,
  "packages/service/src/github/github-token.ts",
);
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/github/example.test.ts");

const OPENER = 'import { openGitHubToken } from "@repo/database/models/provider-key-seal";';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("github-through-module", githubThroughModuleRule, {
  valid: [
    // The module sends to GitHub's API on Octokit.
    {
      code: 'import { Octokit } from "@octokit/core";\nconst url = "https://api.github.com";',
      filename: MODULE_FILE,
    },
    // GitHub's web pages and the store's plain reads are no request to the API and open no token.
    {
      code: 'import { githubTokenOpens, sealGitHubToken } from "@repo/database/models/provider-key-seal";\nconst url = "https://github.com/apps";',
      filename: SERVICE_FILE,
    },
    // A type names no value, so a type-only import or re-export of the opener's module opens nothing.
    {
      code: 'import type { SealedGitHubToken } from "@repo/database/models/provider-key-seal";\nexport type { KeyRing } from "@repo/database/models/provider-key-seal";',
      filename: SERVICE_FILE,
    },
    // The GitHubMemberTokens implementation opens the token.
    { code: OPENER, filename: MEMBER_TOKENS_FILE },
    // A test stands a fake GitHub and seeds a token.
    {
      code: `${OPENER}\nimport { memberGitHubToken } from "./github-token.js";\nconst url = "https://api.github.com/user";`,
      filename: TEST_FILE,
    },
  ],
  invalid: [
    {
      code: 'const api = "https://api.github.com";\nconst at = `https://API.github.com/repos`;\nconst headers = { "X-GitHub-Api-Version": "2022-11-28" };',
      filename: SERVICE_FILE,
      errors: [
        { messageId: "apiOutsideModule", data: { name: "api.github.com" } },
        { messageId: "apiOutsideModule", data: { name: "api.github.com" } },
        { messageId: "apiOutsideModule", data: { name: "x-github-api-version" } },
      ],
    },
    {
      code: 'import { request } from "@octokit/request";',
      filename: SERVICE_FILE,
      errors: [{ messageId: "octokitOutsideModule", data: { name: "@octokit/request" } }],
    },
    // Opening a saved token, by the opener under any alias or through the implementation's own exports.
    {
      code: 'import { openGitHubToken as open } from "@repo/database/models/provider-key-seal";\nimport { memberGitHubToken } from "./github-token.js";',
      filename: SERVICE_FILE,
      errors: [
        { messageId: "tokenOpenedOutsideModule", data: { name: "openGitHubToken" } },
        { messageId: "tokenOpenedOutsideModule", data: { name: "./github-token.js" } },
      ],
    },
    // However the opener is reached: re-exported, through every export, imported at run time, or by the service's subpath.
    {
      code: 'export { openGitHubToken } from "@repo/database/models/provider-key-seal";\nexport * from "@repo/database/models/provider-key-seal";\nawait import("@repo/database/models/provider-key-seal");\nimport { memberGitHubToken } from "@repo/service/github/github-token";',
      filename: SERVICE_FILE,
      errors: [
        { messageId: "tokenOpenedOutsideModule", data: { name: "openGitHubToken" } },
        { messageId: "tokenOpenedOutsideModule", data: { name: "openGitHubToken" } },
        { messageId: "tokenOpenedOutsideModule", data: { name: "openGitHubToken" } },
        {
          messageId: "tokenOpenedOutsideModule",
          data: { name: "@repo/service/github/github-token" },
        },
      ],
    },
  ],
});
