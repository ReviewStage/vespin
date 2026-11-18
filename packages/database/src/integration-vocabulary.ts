/**
 * integration-vocabulary.ts -- the status words of an integration row, declared on the wire below this package
 * (`@repo/features/integration-row-wire`) because the admin pages draw them too.
 */
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { TRIGGER_PROVIDER } from "@repo/features/trigger-catalog";

export {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@repo/features/integration-row-wire";

/**
 * Where an integration's installation on a workspace stands, as its
 * provider last said: active until the provider tells us it was
 * uninstalled, and then deleted, kept so a late delivery under it is known
 * and refused rather than unknown.
 */
export const INTEGRATION_INSTALLATION_STATUS = {
  ACTIVE: "active",
  DELETED: "deleted",
} as const;

export type IntegrationInstallationStatus =
  (typeof INTEGRATION_INSTALLATION_STATUS)[keyof typeof INTEGRATION_INSTALLATION_STATUS];

/**
 * The providers an install intent carries an install to: each trigger's app
 * (`@repo/features/trigger-catalog`), and our Slack app, which an owner or
 * admin installs into the workspace's Slack for its bot.
 */
export const INSTALL_INTENT_PROVIDER = {
  ...TRIGGER_PROVIDER,
  SLACK: INTEGRATION_PROVIDER.SLACK,
} as const;

export type InstallIntentProvider =
  (typeof INSTALL_INTENT_PROVIDER)[keyof typeof INSTALL_INTENT_PROVIDER];
