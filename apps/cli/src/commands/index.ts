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
import { envCommand } from "./env.js";
import { githubCommand } from "./github.js";
import { inboxCommand } from "./inbox.js";
import { integrationsCommand } from "./integrations.js";
import { keysCommand } from "./keys.js";
import { mcpCommand } from "./mcp.js";
import { memoryCommand } from "./memory.js";
import { modelsCommand } from "./models.js";
import { pageCommand } from "./page.js";
import { prCommand } from "./pr.js";
import { preferencesCommand } from "./preferences.js";
import { sectionCommand } from "./section.js";
import { sentryCommand } from "./sentry.js";
import { setupCommand } from "./setup.js";
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
  prCommand,
  workspaceCommand,
  envCommand,
  githubCommand,
  setupCommand,
  inboxCommand,
  memoryCommand,
  automationCommand,
  modelsCommand,
  integrationsCommand,
  sentryCommand,
  preferencesCommand,
  keysCommand,
  mcpCommand,
  apiCommand,
  updateCommand,
  versionCommand,
] as const;
