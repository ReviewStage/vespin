/**
 * account-procedures.ts -- the signed-in account's own procedures: its preferences, its access, and its provider keys; its deletion is Better Auth's (`account-deletion.ts`).
 *
 * Each resolves the caller before touching anything, and answers nothing
 * about any account but the one the caller is: root AGENTS.md pins that no
 * credential or account secret ever travels in an answer, so what each
 * answers is a boolean or the caller's own stored value, never a token or
 * a session id. The caller is resolved on the resource itself, before any
 * input is read, so an unsigned caller is refused as unsigned whatever it
 * sent.
 *
 * The preferences snapshot is six parts: the settings preferences the
 * desktop syncs, where the account's app links open and what Enter does in
 * an agent's box while it works, synced settings each of its own part so a
 * build that predates it neither refuses the snapshot nor clears the choice
 * by writing the shared part back whole, the coding
 * agents' default model, effort, and context window, which Settings alone
 * writes and which reads, until it does, as the fallback a Start naming no
 * model runs on (`accountModelChoices`), the Claude model the account's Generate chapters
 * runs on, one of a fixed set (`@repo/features/chapters-model-choice`), and the experiments the account turned on in
 * Settings › Experimental. A write carries any of them, a coding-agent
 * choice is accepted only as the catalog accepts it
 * (`packages/service/src/providers/model-catalog.ts`), and moved only to a
 * model a credential of the account's pays for, so what is stored is a
 * choice a Start could run unless its credential has since gone, and the
 * experiments are a patch read
 * as tolerantly as they are answered: a key this deployment does not list
 * is passed over rather than refused, because it is an older or newer
 * build's experiment and refusing it would refuse the build's every other
 * choice too.
 *
 * The access is whether the caller is an admin, read off its own role, so a
 * client can offer the admin dashboard to the account that may open it. It
 * says nothing of any other account and authorizes nothing: the dashboard's
 * own gate (`admin/gate.ts`) decides every admin read on its own.
 *
 * The provider keys are `provider-keys-procedures.ts`'s.
 */

import type { AccountAccessRow, AccountSeamEffect } from "@repo/database/models/account-store";
import { Clock } from "effect";
import { isAdminRole } from "../admin/admin-access.js";
import { standingSupportAccess } from "../auth/auth-policy.js";
import { hostedStoreOrUnavailable, type UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  type AccountPreferenceSeams,
  readOwnPreferences,
  writeOwnPreferences,
} from "./account-preferences.js";
import { memoriesProcedures } from "./memories-procedures.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";

export interface AccountProcedureSeams extends AccountPreferenceSeams {
  resolveUserId: UserIdResolver;
  /** The role and the grant of support access on the account's own row, as Better Auth stores them. */
  readAccess: (userId: string) => AccountSeamEffect<AccountAccessRow>;
}

/** The account resource: every procedure but the provider keys' own, which are `provider-keys-procedures.ts`'s. */
export function accountProcedures(seams: AccountProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The caller's own stored snapshot, or the defaults for a user with none stored, the coding agents' the one its credentials pay for. */
    preferences: signedIn.preferences.effect(function* ({ context }) {
      return yield* readOwnPreferences(seams, context.userId);
    }),

    /**
     * Whether the caller's own account is an admin, any role but the admin
     * role not; and when its member's grant of support access runs out, null
     * where none stands or it has run out.
     */
    access: signedIn.access.effect(function* ({ context }) {
      const access = yield* hostedStoreOrUnavailable(seams.readAccess(context.userId));
      const now = yield* Clock.currentTimeMillis;
      return {
        admin: isAdminRole(access.role),
        supportAccessUntil: standingSupportAccess(access.supportAccessUntil, now),
      };
    }),

    /** Writes each part the body carries and answers the snapshot as it then stands (`writeOwnPreferences`). */
    writePreferences: signedIn.writePreferences.effect(function* ({ context, input }) {
      return yield* writeOwnPreferences(seams, context.userId, input);
    }),

    ...providerKeysProcedures(seams),
    ...memoriesProcedures(seams),
  };
}
