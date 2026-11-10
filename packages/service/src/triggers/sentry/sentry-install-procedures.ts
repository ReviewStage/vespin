/**
 * sentry-install-procedures.ts -- a workspace's installations of our Sentry integration begun, read, and disconnected.
 *
 * Three procedures the signed-in desktop calls with its bearer:
 *
 * - `POST /api/workspaces/sentry/install` takes an owner or admin of the
 *   workspace, opens an install intent bound to the account and the
 *   workspace (`integration-installation-store.ts`), and answers Sentry's
 *   external install address for the integration with the intent's state on
 *   it, which Sentry hands back on the Redirect URL
 *   (`sentry-install-app.ts`).
 * - `GET /api/workspaces/sentry/installations` takes any member, and answers
 *   whether this deployment holds the integration and the workspace's
 *   active installations.
 * - `POST /api/workspaces/sentry/disconnect` takes an owner or admin, and
 *   marks one of the workspace's installations deleted, so its deliveries
 *   fire nothing; the integration stays installed on Sentry until the
 *   organization uninstalls it there. It answers the transaction it was
 *   marked in beside the installations, which a desktop holding the
 *   workspace's integrations live waits for (`WORKSPACE_INTEGRATIONS_READ`).
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource.
 */

import { openIntegrationInstallIntent } from "@repo/database/models/integration-installation-store";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { Effect } from "effect";
import { managedWorkspace } from "../../accounts/workspace-access.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../../http/http-effect.js";
import { accountMiddleware, hosted } from "../../orpc/base.js";
import { SentryApp, type SentryAppSettings } from "./sentry-app-config.js";
import { SENTRY_ORIGIN } from "./sentry-install-app.js";
import { disconnectWorkspaceSentry, readWorkspaceSentry } from "./sentry-installations.js";

/** The query the install address carries to Sentry, which Sentry hands back. */
const INSTALL_STATE_QUERY = "state";

export interface SentryInstallProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The integration's settings, or the unavailable refusal where this deployment holds none. */
const settingsOrUnavailable = Effect.flatMap(SentryApp, (app) =>
  app.settings.pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE)),
);

/** Sentry's external install address for the integration, carrying the intent's state. */
function installUrl(settings: SentryAppSettings, state: string): string {
  const url = new URL(
    `/sentry-apps/${encodeURIComponent(settings.slug)}/external-install/`,
    SENTRY_ORIGIN,
  );
  url.searchParams.set(INSTALL_STATE_QUERY, state);
  return url.toString();
}

/** The workspace Sentry resource: install and disconnect to an owner or admin, and the installations to any member. */
export function sentryInstallProcedures(seams: SentryInstallProcedureSeams) {
  const resource = hosted.workspaceSentry.use(accountMiddleware(seams.resolveUserId));
  return {
    /** An intent opened for the workspace, answered as Sentry's install address. */
    install: resource.install.effect(function* ({ input, context }) {
      const workspace = yield* managedWorkspace(context.userId, input.workspaceId);
      const settings = yield* settingsOrUnavailable;
      const state = yield* hostedStoreOrUnavailable(
        openIntegrationInstallIntent(TRIGGER_PROVIDER.SENTRY, context.userId, workspace.id),
      );
      return { url: installUrl(settings, state) };
    }),
    /** The workspace's Sentry, to any member of it. */
    installations: resource.installations.effect(function* ({ input, context }) {
      return yield* readWorkspaceSentry(context.userId, input.workspaceId);
    }),
    /** One of the workspace's installations disconnected (`disconnectWorkspaceSentry`). */
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      return yield* disconnectWorkspaceSentry(
        context.userId,
        input.workspaceId,
        input.installationId,
      );
    }),
  };
}
