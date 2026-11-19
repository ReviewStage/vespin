/**
 * new-agent-servers.ts -- which of the account's MCP servers its new agents start switched off.
 *
 * Every connection an agent may be handed is on for it until switched off,
 * on the agent's own row (`disabledServers`). A new agent starts from the
 * account's choice here instead of from every server on, so a member who
 * keeps a large integration connected need not hand every agent its tools.
 * The account stores only the servers it switched off
 * (`APP_SETTING_SCHEMA.newAgentServersOff`), as the JSON list of their
 * connection names, the names an agent's own switches store: nothing stored
 * reads as every server on, and so does a server connected later.
 */

import { disabledServersSchema } from "@repo/features/agent-wire";
import type { UnparsedWireValue } from "@repo/wire";
import { Option, Schema } from "effect";

/**
 * The list as JSON, read as an agent's own switched-off servers are
 * (`disabledServersSchema`): within the bounds an agent's row is answered
 * under, so no new agent can start on a list its own answer would refuse,
 * and a name of a provider this build does not know, a retired one among
 * them, read past rather than refused.
 */
const newAgentServersOffJson = Schema.fromJsonString(disabledServersSchema);

const decodeServersOff = Schema.decodeUnknownOption(newAgentServersOffJson);

const encodeServersOff = Schema.encodeUnknownOption(newAgentServersOffJson);

/** Guards a list arriving from storage or the wire, as its JSON. */
export function isNewAgentServersOffJson(value: UnparsedWireValue): value is string {
  return Option.isSome(decodeServersOff(value));
}

/** The servers a stored list switches off for new agents, each once; none where it holds no list. */
export function newAgentServersOffFrom(value: UnparsedWireValue): readonly string[] {
  return [...new Set(Option.getOrElse(decodeServersOff(value), () => []))];
}

/**
 * The list a new agent's switches are written as, in order; an empty list
 * is still written, since it turns the last server back on. None for a list
 * past the bounds an agent's row is answered under, which is not written.
 */
export function newAgentServersOffJsonOf(servers: readonly string[]): string | undefined {
  return Option.getOrUndefined(encodeServersOff([...new Set(servers)].sort()));
}
