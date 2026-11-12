/**
 * clients-procedures.ts -- the outside MCP clients a member allowed, as Settings › MCP reads them and revokes one.
 *
 * Both take the account's OAuth token, so the desktop, the web app, the
 * command-line tool, and the member MCP server reach each the same way.
 * Each is one operation (`mcp-client-operations.ts`), which says what is
 * listed and what a revoke deletes.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { mcpClientRevoke, mcpClientsRead } from "./mcp-client-operations.js";

export interface McpClientsProcedureSeams {
  resolveUserId: UserIdResolver;
  /** The member MCP server's address on this deployment, which a client is pointed at. */
  memberMcpServerUrl: string;
}

/** The resource: the read and the revoke, both to the account's bearer. */
export function mcpClientsProcedures(seams: McpClientsProcedureSeams) {
  const signedIn = hosted.mcpClients.use(accountMiddleware(seams.resolveUserId));

  return {
    list: signedIn.list.effect(function* ({ context }) {
      return yield* mcpClientsRead(context.userId, seams.memberMcpServerUrl);
    }),
    revoke: signedIn.revoke.effect(function* ({ context, input }) {
      return yield* mcpClientRevoke(context.userId, input.query.clientId, seams.memberMcpServerUrl);
    }),
  };
}
