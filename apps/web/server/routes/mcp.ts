import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { agentSandboxLayer } from "@repo/service/agents/terminal/agent-sandbox";
import { auth } from "@repo/service/auth/auth";
import { authDeployment } from "@repo/service/auth/auth-deployment";
import { memberMcpApp, memberMcpAuth } from "@repo/service/member-mcp/app";
import { Layer } from "effect";
import { agentImage, nativeAgents } from "../native-agents.js";
import { routeFromHttpRouter } from "../route-effect.js";

/** The member MCP server (POST), where an outside MCP client acts for a member on an access token the auth service minted for the server, verified by Better Auth's resource client over the deployment's own auth service, every address the deployment's base URL's. Its starts, messages, and stops, and the answers, messages, and closes it writes on a thread, reach the native harnesses as the desktop's do (`native-agents.ts`), its `list_agent_ports` and `share_agent_port` an agent's sandbox (`agentSandboxLayer`), and its `create_workspace` the organization plugin's create (`workspaceSeams`). The logic lives in `packages/service/src/member-mcp/app.ts`. */
export default routeFromHttpRouter(
  memberMcpApp(
    memberMcpAuth(
      oauthProviderResourceClient(auth).getActions(),
      authDeployment(process.env).baseURL,
    ),
    agentSandboxLayer.pipe(Layer.provide(agentImage)),
    workspaceSeams(auth.api),
  ),
  nativeAgents,
);
