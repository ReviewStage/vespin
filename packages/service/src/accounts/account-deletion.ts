/**
 * account-deletion.ts -- what an account's deletion does of its own around Better Auth's `deleteUser`, which its hooks run (`deletion-hooks.ts`).
 *
 * Better Auth deletes the account's sessions, sign-in accounts, and user row,
 * every dependent row cascading, and before it the workspaces the account is
 * the only member of (`auth/auth-policy.ts`'s `accountDeletion`). What it
 * knows nothing of is done here. Before the delete, once Better Auth has
 * found the session fresh: every session the account's standing agents'
 * conversations run in is retired while those conversations still stand
 * (`retire-sessions.ts`), a session not retired logged and the delete going
 * on; the analytics person is asked to be erased, since nothing after the
 * delete would still name it; and what the delete leaves to settle is read,
 * the integration grants among it, since an added account's subject is no id
 * the account still names after it, its sign-in tokens, since the delete
 * erases them here without telling Google or GitHub, and its scheduled
 * automations in every workspace, since the automations cascade with the user
 * row while their schedules at Vercel would go on firing. After the delete,
 * every grant is revoked at Vercel Connect, as a Disconnect revokes one, a
 * revoke that fails logged by its word, every sign-in token is revoked at the
 * provider that issued it, each under a deadline and a failure logged
 * (`auth/sign-in-revocation.ts`), each schedule is deleted at Vercel, a failure
 * logged, and the onboarding contact Resend keeps under the account's
 * address is deleted (`onboarding-events.ts`). A sandbox left behind expires
 * with its snapshot (`@repo/sandbox`'s retention), and a deleted workspace's
 * agents' conversations and sandboxes, and its automations' schedules, are
 * deleted by its own delete's hooks (`workspace-deletion.ts`).
 */

import { accountScheduledAutomations } from "@repo/database/models/automation-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { Effect, Redacted } from "effect";
import type { HttpClient } from "effect/http";
import { retireSessions, retiringReach } from "../agents/retire-sessions.js";
import { type SignInGrant, SignInRevocation } from "../auth/sign-in-revocation.js";
import { schedulesForgotten } from "../automations/automation-cadence.js";
import { HostedEnvironment } from "../environment.js";
import { revokeIntegrationGrants } from "../integrations/integration-connect.js";
import {
  type IntegrationConnectionRow,
  readIntegrationConnections,
} from "../integrations/integration-store.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";
import { readAccountPerson } from "./account-person.js";
import { onboardingForgotten } from "./onboarding-events.js";

/** Erases the account's analytics person, where the deployment holds both halves of the analytics configuration. */
const forgetAnalytics = /* @__PURE__ */ Effect.fn("web/forgetAnalytics")(function* (
  userId: string,
): Effect.fn.Return<void, never, HostedEnvironment | HttpClient.HttpClient> {
  const environment = yield* HostedEnvironment;
  if (!environment.posthogPersonalApiKey || !environment.posthogProjectId) return;
  const personalApiKey = Redacted.value(environment.posthogPersonalApiKey);
  const projectId = environment.posthogProjectId;
  const host = environment.posthogApiHost;
  yield* forgetPosthogPersonEffect(userId, {
    personalApiKey,
    projectId,
    ...(host ? { host } : undefined),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(`Analytics erasure did not complete: ${error.message}\n`),
      ),
    ),
  );
});

/** What the deletion read before Better Auth deleted the account, which it settles after. */
export interface AccountDeletionPending {
  readonly grants: readonly IntegrationConnectionRow[];
  /** The account's sign-in tokens, opened, which the delete erases here and the deletion revokes at their providers. */
  readonly signIns: readonly SignInGrant[];
  /** The account's scheduled automations in every workspace, named as their schedules are kept at Vercel. */
  readonly schedules: readonly { readonly id: string; readonly organizationId: string }[];
  /** The account's address, which its onboarding contact is deleted by; none where the row had none. */
  readonly email: string | undefined;
}

/** What the deletion does before Better Auth deletes the account, answering what it settles after; a store that cannot be read refuses the delete. */
export const beforeAccountDeletion = /* @__PURE__ */ Effect.fn("web/beforeAccountDeletion")(
  function* (userId: string) {
    const retiring = yield* retiringReach(userId);
    yield* retireSessions(retiring, yield* standingSessionsOf(userId));
    yield* forgetAnalytics(userId);
    const grants = yield* readIntegrationConnections(userId);
    const signIns = yield* (yield* SignInRevocation).grantsOf(userId);
    const schedules = yield* accountScheduledAutomations(userId);
    const email = (yield* readAccountPerson(userId))?.email;
    return { grants, signIns, schedules, email } satisfies AccountDeletionPending;
  },
);

/** What the deletion settles once Better Auth has deleted the account. */
export const afterAccountDeletion = /* @__PURE__ */ Effect.fn("web/afterAccountDeletion")(
  function* (userId: string, pending: AccountDeletionPending) {
    yield* revokeIntegrationGrants(userId, pending.grants);
    yield* (yield* SignInRevocation).revoke(pending.signIns);
    yield* schedulesForgotten(pending.schedules);
    if (pending.email !== undefined) yield* onboardingForgotten(pending.email);
  },
);
