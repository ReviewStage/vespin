/**
 * agent-pages-procedures.ts -- the pages a coding agent on no task once showed on itself, as the hosted oRPC router still answers a released desktop that asks for them.
 *
 * `GET /api/agents/{id}/pages`, `/api/agents/{id}/pages/{page}/versions/{version}`,
 * and its `/frame` stand only because a released desktop asks them for an
 * agent page tab a restored window holds. Every page stands on a task, so an
 * agent holds none: the list answers none and a version is not found, as
 * for an agent that does not exist, and an id that is no UUID names none.
 * They go with the answers kept for older desktops.
 */

import { pageVersionNumberSchema } from "@repo/features/page-wire";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface AgentPagesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The version a path names, or the invalid-request refusal where it is no whole number from one. */
function pageVersionOf(version: string): Effect.Effect<number, HostedRefusal> {
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(version)));

  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

/** The agent pages resource: the list and one version, to a signed-in caller resolved before its input is read. */
export function agentPagesProcedures(seams: AgentPagesProcedureSeams) {
  const member = hosted.agentPages.use(accountMiddleware(seams.resolveUserId));

  return {
    list: member.list.effect(function* ({ input }) {
      yield* pathUuid(input.id);

      return { pages: [] };
    }),
    version: member.version.effect(function* ({ input }) {
      yield* pathUuid(input.id);
      yield* pathUuid(input.page);
      yield* pageVersionOf(input.version);

      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }),
    frame: member.frame.effect(function* ({ input }) {
      yield* pathUuid(input.id);
      yield* pathUuid(input.page);
      yield* pageVersionOf(input.version);

      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }),
  };
}
