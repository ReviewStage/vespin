/**
 * sentry-installations.ts -- a workspace's installations of our Sentry integration read and one disconnected, whichever door asks: the hosted procedures and the member MCP server alike.
 *
 * Any member of the workspace reads whether this deployment holds the
 * integration and the workspace's active installations; an owner or admin
 * disconnects one, which marks it deleted so its deliveries fire nothing,
 * while the integration stays installed on Sentry until the organization
 * uninstalls it there. A workspace the account is not in is not found,
 * whatever it asked, and no answer carries a Sentry token.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { INTEGRATION_INSTALLATION_STATUS } from "@repo/database/integration-vocabulary";
import {
  markIntegrationInstallationDeleted,
  workspaceIntegrationInstallations,
} from "@repo/database/models/integration-installation-store";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";
import { Effect, Option, Result } from "effect";
import { answeredWorkspace, managedWorkspace } from "../../accounts/workspace-access.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../../http/http-effect.js";
import { SentryApp } from "./sentry-app-config.js";

/** The workspace's Sentry as the wire carries it: its active installations, the first linked first. */
const workspaceSentry = Effect.fn("web/workspaceSentry")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSentry, HostedRefusal, DatabaseServices | SentryApp> {
  const app = yield* SentryApp;
  const configured = Result.isSuccess(yield* Effect.result(app.settings));
  const rows = yield* hostedStoreOrUnavailable(workspaceIntegrationInstallations(workspaceId));

  const installations = rows
    .filter(
      (row) =>
        row.provider === TRIGGER_PROVIDER.SENTRY &&
        row.status === INTEGRATION_INSTALLATION_STATUS.ACTIVE,
    )
    .map((row) =>
      row.accountLabel === null
        ? { installationId: row.externalId }
        : { installationId: row.externalId, account: row.accountLabel },
    );

  return { configured, installations };
});

/** The workspace's Sentry, to any member of it. */
export const readWorkspaceSentry = Effect.fn("web/readWorkspaceSentry")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);

  return yield* workspaceSentry(workspace.id);
});

/**
 * One of the workspace's installations disconnected by an owner or admin,
 * answered with the transaction it was marked in beside the installations,
 * which a desktop holding the workspace's integrations live waits for; one
 * that is not the workspace's is not found, and the write itself names the
 * workspace, so an installation another workspace linked since the read is
 * left alone.
 */
export const disconnectWorkspaceSentry = Effect.fn("web/disconnectWorkspaceSentry")(function* (
  userId: string,
  workspaceId: string,
  installationId: string,
): Effect.fn.Return<
  WorkspaceSentry & { readonly txid?: string },
  HostedRefusal,
  DatabaseServices | SentryApp
> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const before = yield* workspaceSentry(workspace.id);

  if (!before.installations.some((one) => one.installationId === installationId)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }

  const marked = yield* hostedStoreOrUnavailable(
    markIntegrationInstallationDeleted(TRIGGER_PROVIDER.SENTRY, installationId, workspace.id),
  );

  const sentry = yield* workspaceSentry(workspace.id);

  return Option.match(marked, {
    onNone: () => sentry,
    onSome: (txid) => ({ ...sentry, txid }),
  });
});
