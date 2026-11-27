/**
 * view-choices-procedures.ts -- the account's view choices: one kept for a workspace or for the account, or forgotten.
 *
 * The write resolves the caller before it touches a row, and every row it
 * touches is the caller's own, so no account keeps or forgets another's
 * choice (`@repo/database/models/account-view-choices`). The value is read
 * through its key's own Schema (`@repo/features/view-choice-wire`'s
 * `viewChoiceStored`) and stored as that Schema writes it back out, so the
 * service holds only a value a build could have chosen. A value its key
 * does not hold, and a place that is not the key's (a workspace for one of
 * the account's, or none for one of a workspace's), are refused as invalid;
 * a workspace the account is not a member of, or a choice first made under
 * an id another row holds, as not found. Nothing of a
 * choice is counted, traced, or logged here.
 */

import { writeViewChoice } from "@repo/database/models/account-view-choices";
import { viewChoicePlaced, viewChoiceStored } from "@repo/features/view-choice-wire";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

/** What the view choices' procedures reach beyond the store: who the bearer is. */
export interface ViewChoicesProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function viewChoicesProcedures(seams: ViewChoicesProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));

  return {
    writeViewChoice: signedIn.writeViewChoice.effect(function* ({ context, input }) {
      const { id, key, workspaceId } = input;

      if (!viewChoicePlaced(key, workspaceId)) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      const value = input.value === null ? null : viewChoiceStored(key, input.value);

      if (value === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

      const written = yield* hostedStoreOrUnavailable(
        writeViewChoice(context.userId, { id, key, organizationId: workspaceId, value }),
      );

      if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return written.value;
    }),
  };
}
