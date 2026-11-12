/**
 * bearer.ts -- the runner's bearer at our MCP server: kept as its digest, and admitting the agent's conversation the digest names.
 *
 * A native harness's runner is handed one bearer for its agent's session,
 * which it presents as `Authorization: Bearer` on every call to the server.
 * The store keeps its SHA-256 alone, on the agent's row
 * (`agent.runner_token_hash`), so a read of the row cannot be replayed
 * as the bearer. A bearer whose digest no standing agent holds, a retired
 * one's among them, admits nothing.
 *
 * A launch is named by its number (`agent.runner_launch`) on every URL the
 * service hands its runner (`launchUrl`), because a bearer alone does not
 * tell launches apart: a sandbox holds one swap of it at its firewall, so a
 * runner a newer launch replaced in the same sandbox posts under the newer
 * bearer once its swap stands. A post that names a launch other than the
 * one its bearer was recorded as admits nothing.
 */

import { createHash } from "node:crypto";
import {
  type AgentStoreEffect,
  readRunnerTokenConversation,
} from "@repo/database/models/agent-store";
import { Effect, Option } from "effect";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";

/** What a bearer header leads with before the bearer. */
export const BEARER_PREFIX = "Bearer ";

/** The query parameter a runner's URLs name its launch by. */
const RUNNER_LAUNCH_PARAM = "runnerLaunch";

/** An agent's conversation as a runner's post admits it, and the launch the post named, where it named one. */
export interface AdmittedRunner extends AdmittedConversation {
  readonly launch: number | undefined;
}

/** The digest the store keeps of a runner's bearer, which a launch records and every call compares: its SHA-256, in hex. */
export function runnerTokenDigest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/** The bearer a request presents; nothing where it presents none, or an empty one. */
export function presentedBearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";

  if (!authorization.startsWith(BEARER_PREFIX)) return undefined;
  const bearer = authorization.slice(BEARER_PREFIX.length).trim();

  return bearer.length > 0 ? bearer : undefined;
}

/** A URL handed to a launch's runner, naming the launch, so each of its posts names it. */
export function launchUrl(url: string, launch: number): string {
  const named = new URL(url);
  named.searchParams.set(RUNNER_LAUNCH_PARAM, String(launch));

  return named.href;
}

/** The launch a request names, as its URL spells it; nothing where it names none. */
export function presentedLaunch(request: Request): string | undefined {
  return new URL(request.url).searchParams.get(RUNNER_LAUNCH_PARAM) ?? undefined;
}

/**
 * The agent's conversation the bearer stands for, admitted as its starter:
 * the account that opened it is the caller, so the tools run as the
 * developer who started the agent, with its conversation's context; nothing
 * for a bearer no standing agent holds, nor for a post naming a launch
 * other than the one the bearer was recorded as. A post that names no
 * launch is admitted on its bearer alone: a compatibility leftover for a
 * launch started before its URLs named it, deleted once no such launch can
 * still run (a sandbox's ends with its sandbox, a Mac's within its warm window).
 */
export function admitRunnerBearer(
  bearer: string,
  named?: string,
): AgentStoreEffect<Option.Option<AdmittedRunner>> {
  return Effect.map(
    readRunnerTokenConversation(runnerTokenDigest(bearer)),
    Option.flatMap((row) =>
      named !== undefined && named !== String(row.launch)
        ? Option.none()
        : Option.some<AdmittedRunner>({
            caller: row.userId,
            target: { userId: row.userId, conversationId: row.conversationId },
            runtimeSessionId: row.runtimeSessionId ?? undefined,
            timeZone: undefined,
            launch: named === undefined ? undefined : row.launch,
          }),
    ),
  );
}
