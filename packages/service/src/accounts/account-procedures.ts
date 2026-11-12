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
 * The preferences snapshot (`account-preferences.ts`) holds the settings
 * preferences the desktop syncs; the account's own settings, such as where
 * its links open, each a part of its own so a build that predates one
 * neither refuses the snapshot nor clears the choice by writing the shared
 * part back whole; the coding agents' default model, effort, and context
 * window, which read, until Settings writes one, as the fallback a Start
 * naming no model runs on (`accountModelChoices`); the Claude model
 * Generate chapters runs on (`@repo/features/chapters-model-choice`); and
 * the experiments turned on in Settings › Experimental. A write carries any
 * of them. A coding-agent choice is accepted only as the catalog accepts it
 * (`packages/service/src/providers/model-catalog.ts`), and moved only to a
 * model a credential of the account's pays for. The experiments are a patch
 * read as tolerantly as they are answered: a key this deployment does not
 * list is passed over rather than refused, because it is an older or newer
 * build's experiment and refusing it would refuse the build's every other
 * choice too.
 *
 * The access is whether the caller is an admin, read off its own role, so a
 * client can offer the admin dashboard to the account that may open it. It
 * says nothing of any other account and authorizes nothing: the dashboard's
 * own gate (`admin/gate.ts`) decides every admin read on its own.
 *
 * The provider keys are `provider-keys-procedures.ts`'s, the account's
 * own sounds `sounds-procedures.ts`'s, and the commands it always allows its
 * coding agents to run `allowed-commands-procedures.ts`'s.
 */

import type { AccountAccessRow, AccountSeamEffect } from "@repo/database/models/account-store";
import { stampPresence } from "@repo/database/models/presence-store";
import type { PresenceDoneAnswer } from "@repo/features/presence-wire";
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
import { allowedCommandsProcedures } from "./allowed-commands-procedures.js";
import { memoriesProcedures } from "./memories-procedures.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";
import { soundsProcedures } from "./sounds-procedures.js";

export interface AccountProcedureSeams extends AccountPreferenceSeams {
  resolveUserId: UserIdResolver;
  /** The role and the grant of support access on the account's own row, as Better Auth stores them. */
  readAccess: (userId: string) => AccountSeamEffect<AccountAccessRow>;
}

/** What a beat answers once the stamp is kept. */
const PRESENCE_DONE: PresenceDoneAnswer = { done: true };

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

    /** The caller stamped active now, as their desktop or web client's beat says, which holds their phone's pushes (`../push/inbox-pushes.ts`). */
    active: signedIn.active.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(stampPresence(context.userId));
      return PRESENCE_DONE;
    }),

    /** Writes each part the body carries and answers the snapshot as it then stands (`writeOwnPreferences`). */
    writePreferences: signedIn.writePreferences.effect(function* ({ context, input }) {
      return yield* writeOwnPreferences(seams, context.userId, input);
    }),

    ...providerKeysProcedures(seams),
    ...memoriesProcedures(seams),
    ...soundsProcedures(seams),
    ...allowedCommandsProcedures(seams),
  };
}
