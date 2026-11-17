/**
 * billing-procedures.ts -- a workspace's billing to its owners and admins: read its status, set it up, manage it.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read), then runs the operation in
 * `billing.ts`, which says what each refuses.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { billingPortal, billingSetup, billingStatus } from "./billing.js";

export interface BillingProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The billing resource: every procedure to a signed-in caller. */
export function billingProcedures(seams: BillingProcedureSeams) {
  const signedIn = hosted.billing.use(accountMiddleware(seams.resolveUserId));

  return {
    status: signedIn.status.effect(function* ({ input, context: { userId } }) {
      return yield* billingStatus(userId, input.workspaceId);
    }),

    setup: signedIn.setup.effect(function* ({ input, context: { userId } }) {
      return yield* billingSetup(userId, input.workspaceId);
    }),

    portal: signedIn.portal.effect(function* ({ input, context: { userId } }) {
      return yield* billingPortal(userId, input.workspaceId);
    }),
  };
}
