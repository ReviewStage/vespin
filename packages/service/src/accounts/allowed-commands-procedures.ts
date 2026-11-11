/**
 * allowed-commands-procedures.ts -- the shell commands a member always allows their coding agents to run unasked: listed, added by hand, and removed.
 *
 * Each resolves the caller before it touches a row, and every row it
 * touches is the caller's own, so no member reads, adds to, or removes from
 * another's list. An add by hand names no agent and refuses one past the
 * list's bound (`allowed-commands-full`); a prefix already kept answers the
 * list as it stands. Every answer is the list as it then stands. Nothing of
 * a command is counted, traced, or logged here.
 */

import {
  ALLOWED_COMMAND_ADDED,
  type AllowedCommandRow,
  addAllowedCommand,
  listAllowedCommands,
  removeAllowedCommand,
} from "@repo/database/models/account-allowed-commands";
import {
  ALLOWED_COMMAND_QUERY,
  type AllowedCommandsAnswer,
} from "@repo/features/allowed-command-wire";
import { DateTime, Effect } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

/** What the commands' procedures reach beyond the store: who the bearer is. */
export interface AllowedCommandsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The member's list as the wire answers it. */
function answerOf(rows: readonly AllowedCommandRow[]): AllowedCommandsAnswer {
  return {
    commands: rows.map((row) => ({
      id: row.id,
      prefix: row.prefix,
      agentId: row.agentId,
      addedAt: row.createdAt.getTime(),
    })),
  };
}

export function allowedCommandsProcedures(seams: AllowedCommandsProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  const listed = (userId: string) =>
    Effect.map(hostedStoreOrUnavailable(listAllowedCommands(userId)), answerOf);
  return {
    allowedCommands: signedIn.allowedCommands.effect(function* ({ context }) {
      return yield* listed(context.userId);
    }),

    addAllowedCommand: signedIn.addAllowedCommand.effect(function* ({ context, input }) {
      const at = yield* DateTime.nowAsDate;
      const added = yield* hostedStoreOrUnavailable(
        addAllowedCommand({ userId: context.userId, prefix: input.prefix, agentId: null, at }),
      );
      if (added === ALLOWED_COMMAND_ADDED.FULL) {
        return yield* Effect.fail(HOSTED_REFUSAL.ALLOWED_COMMANDS_FULL);
      }
      return yield* listed(context.userId);
    }),

    removeAllowedCommand: signedIn.removeAllowedCommand.effect(function* ({ context, input }) {
      yield* hostedStoreOrUnavailable(
        removeAllowedCommand(context.userId, input.query[ALLOWED_COMMAND_QUERY.ID]),
      );
      return yield* listed(context.userId);
    }),
  };
}
