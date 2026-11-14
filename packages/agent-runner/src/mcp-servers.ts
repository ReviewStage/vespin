/**
 * mcp-servers.ts -- the MCP servers a launch hands its harness, ours and each integration's, as one list that each harness's adapter renders into its own config.
 *
 * Every server is the service's, reached over streamable HTTP under the
 * runner's bearer: ours at the config's `mcpUrl`, and each integration the
 * agent is handed at its own endpoint (`IntegrationServer`). What differs
 * between them is how a launch waits on them. Our server's tools, some of
 * them loaded from the first turn (`workspace-mcp/app.ts`'s
 * `anthropic/alwaysLoad`), are waited on as the harness waits on a server it
 * needs (`MCP_STARTUP.REQUIRED`). An integration connects in the
 * background (`MCP_STARTUP.BACKGROUND`), so a slow provider holds up no
 * first turn: Codex starts on the integration's cached catalog
 * (`startup_readiness`), and Claude Code starts without the server, its
 * tool search waiting on the server where the model looks for one of its
 * tools before it connects.
 */

import { type ClaudeCodeConfig, type CodexConfig, RUNNER_ENV } from "./protocol.js";

/** The name our MCP server is registered under, so its tools reach the model as `mcp__team__<tool>` (`@repo/features/agent-tools`'s `WORKSPACE_MCP_SERVER`). */
export const MCP_SERVER = "team";

/**
 * How long a harness waits on one of our tool calls, in seconds: our MCP
 * function's own duration (`workspace-mcp/app.ts`'s `WORKSPACE_MCP_FUNCTION`, the
 * longest `run_on_mac` and two minutes around it), so a harness never gives up
 * on a call the service is still running. Note that Codex's default is 60 s, past
 * which it fails the call while the service carries it out, and the agent retries a
 * call that already ran.
 */
const MCP_TOOL_TIMEOUT_SECONDS = 600;

/**
 * How long a harness waits on an integration's server to start, in seconds:
 * past the bound the service lists a provider's tools within
 * (`connection-door.ts`'s `LIST_TIMEOUT`, ten seconds), so a slow provider's
 * server answers no tools rather than being failed by Codex at its default
 * of ten (https://learn.chatgpt.com/docs/extend/mcp, `startup_timeout_sec`).
 */
const INTEGRATION_STARTUP_TIMEOUT_SECONDS = 20;

/** How a launch waits on a server as it starts. */
export const MCP_STARTUP = {
  /** Waited on as the harness waits on a server it needs, so its tools are there from the first turn. */
  REQUIRED: "required",
  /** Connected in the background, where a cached catalog may stand in for its tools until it connects; it holds up no first turn. */
  BACKGROUND: "background",
} as const;

export type McpStartup = (typeof MCP_STARTUP)[keyof typeof MCP_STARTUP];

/** One MCP server a launch hands its harness, said once for every harness. */
export interface McpServer {
  /** The name it is registered under, which its tools are named by (`mcp__<name>__<tool>`). */
  readonly name: string;
  /** Its streamable-HTTP endpoint at the service. */
  readonly url: string;
  /** The variable in the runner's environment holding the bearer it is reached under: a placeholder in the cloud's sandbox. */
  readonly bearerVariable: typeof RUNNER_ENV.BEARER;
  /** How long a harness waits on one of its tool calls, in seconds. */
  readonly toolTimeoutSeconds: number;
  /** How long a harness waits on it to start, in seconds; the harness's own default where absent. */
  readonly startupTimeoutSeconds?: number;
  readonly startup: McpStartup;
}

/** The servers a launch's config hands its harness: ours first, then each integration, less one that would take our server's name. */
export function mcpServersOf(
  config: Pick<ClaudeCodeConfig | CodexConfig, "mcpUrl" | "integrations">,
): readonly McpServer[] {
  const ours: McpServer = {
    name: MCP_SERVER,
    url: config.mcpUrl,
    bearerVariable: RUNNER_ENV.BEARER,
    toolTimeoutSeconds: MCP_TOOL_TIMEOUT_SECONDS,
    startup: MCP_STARTUP.REQUIRED,
  };

  const integrations = (config.integrations ?? [])
    .filter((integration) => integration.name !== MCP_SERVER)
    .map(
      (integration): McpServer => ({
        name: integration.name,
        url: integration.url,
        bearerVariable: RUNNER_ENV.BEARER,
        toolTimeoutSeconds: MCP_TOOL_TIMEOUT_SECONDS,
        startupTimeoutSeconds: INTEGRATION_STARTUP_TIMEOUT_SECONDS,
        startup: MCP_STARTUP.BACKGROUND,
      }),
    );

  return [ours, ...integrations];
}
