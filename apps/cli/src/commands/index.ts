/**
 * index.ts -- every `vespin` command, in the order `--help` lists them.
 *
 * A command group is a file of its own in this folder exporting its
 * commands, built on `../output.js` (the answer, notes, `-F` input) and
 * `../session.js` (the service, the bearer, `askService`), and registered
 * by one line below. A group takes the global flags (`../flags.js`) from
 * the context rather than declaring them.
 */

import { ACCOUNT_COMMANDS } from "./account.js";
import { agentCommand } from "./agent.js";
import { apiCommand } from "./api.js";
import { automationCommand } from "./automation.js";
import { commentCommand } from "./comment.js";
import { descriptionCommand } from "./description.js";
import { githubCommand } from "./github.js";
import { inboxCommand } from "./inbox.js";
import { keysCommand } from "./keys.js";
import { mcpCommand } from "./mcp.js";
import { memoryCommand } from "./memory.js";
import { modelsCommand } from "./models.js";
import { pageCommand } from "./page.js";
import { sectionCommand } from "./section.js";
import { taskCommand } from "./task.js";
import { updateCommand } from "./update.js";
import { versionCommand } from "./version.js";
import { workspaceCommand } from "./workspace.js";

export const COMMANDS = [
  ...ACCOUNT_COMMANDS,
  taskCommand,
  sectionCommand,
  descriptionCommand,
  commentCommand,
  pageCommand,
  agentCommand,
  workspaceCommand,
  githubCommand,
  inboxCommand,
  memoryCommand,
  automationCommand,
  modelsCommand,
  keysCommand,
  mcpCommand,
  apiCommand,
  updateCommand,
  versionCommand,
] as const;
