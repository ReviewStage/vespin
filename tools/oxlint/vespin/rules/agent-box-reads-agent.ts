import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/**
 * A box writing to a started agent reads that agent in one place,
 * `packages/panel/src/tasks/agent-box.tsx` (`useAgentBox`), which the
 * agent's own tab and an Inbox thread's reply both spread onto the box, so
 * the two stand alike. In the panel outside that file, importing a hook
 * that reads an agent for its box (its model chip, its permission mode, its
 * MCP servers, its place chip's move) is refused, by name, so a chip added
 * to one owner's box is added to `useAgentBox` instead and reaches both.
 * The Inbox's box fell behind the tab's three times before this rule, each
 * time a hook called beside the others at the tab alone.
 */

/** The one file that reads an agent for its box. */
const AGENT_BOX_FILE = "packages/panel/src/tasks/agent-box.tsx";

/** Where the rule holds: the panel, the only client that draws the box. */
const PANEL_SOURCE = "packages/panel/src/";

/** Each hook that reads an agent for its box, by the name it is exported under, with the file that exports it. */
const AGENT_READS: ReadonlyMap<string, string> = new Map([
  ["useAgentModel", "use-agent-model.js"],
  ["useAgentPermissionMode", "agent-approvals.js"],
  ["useAgentServers", "use-agent-servers.js"],
  ["useMovePlace", "move-agent.js"],
]);

/** Whether a file is a test, which draws what it checks. */
function isTest(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(file) || /(?:^|\/)(?:tests|testing)\//u.test(file);
}

export const agentBoxReadsAgentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a box writing to a started agent to read the agent through useAgentBox, never a hook of its own beside it.",
    },
    messages: {
      readOutsideBox:
        "`{{name}}` reads an agent for its box. Read it in `packages/panel/src/tasks/agent-box.tsx`'s `useAgentBox`, which the agent's tab and an Inbox thread's box both spread onto `AgentComposer`, so a chip added to one box stands on both.",
    },
  },
  createOnce(context) {
    return {
      before() {
        const file = repositoryPathOf(context.filename);
        return (
          TYPESCRIPT_SOURCE.test(file) &&
          file.startsWith(PANEL_SOURCE) &&
          file !== AGENT_BOX_FILE &&
          !isTest(file)
        );
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const name =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          const from = AGENT_READS.get(name);
          if (from === undefined || !(source === `./${from}` || source.endsWith(`/${from}`))) {
            continue;
          }
          context.report({ node: specifier, messageId: "readOutsideBox", data: { name } });
        }
      },
    };
  },
});
