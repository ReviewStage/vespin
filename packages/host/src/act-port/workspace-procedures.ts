import { Effect } from "effect";
import { isGitHubAddress } from "../acts.js";
import { WORKSPACE_ACT_KIND, WORKSPACE_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";

/**
 * workspace-procedures.ts -- the panel's asks of the host about the account's workspaces that do work at the window: a connection's address opened.
 *
 * Every other workspace act is declared and answered by the tasks'
 * composer directly (`contract/workspaces.ts`). A connection is declared
 * too, but written by hand: its handler answers the address the service
 * named, or its refusal, and only an address on the connection's own origin
 * is opened. A workspace's per-workspace reads are live follows
 * (`act-port/live-follows.ts`).
 */
export interface WorkspaceProceduresDependencies {
  /**
   * Opens an address in the browser: a connection's install or sign-in page
   * the service named, with the page it lands on once settled where one is
   * named, which a client showing it in a sheet of its own closes the sheet
   * on (the iOS app's authentication sheet).
   */
  openExternal: (url: string, landing?: string) => Promise<void>;
  /** The page GitHub's install lands on once settled (`GITHUB_INSTALL_LANDING`), named by a client that opens it in a sheet of its own; none where it opens in a browser. */
  githubLanding?: string;
}

/** Sentry's own origin, the one a Sentry install is opened on. */
const SENTRY_ORIGIN = "https://sentry.io";

/** Whether an address the host answered parses and stands on Sentry's own origin. */
function isSentryAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SENTRY_ORIGIN;
}

/** Slack's own origin, the one an Add to Slack is opened on (https://docs.slack.dev/authentication/installing-with-oauth/). */
const SLACK_ORIGIN = "https://slack.com";

/** Whether an address the host answered parses and stands on Slack's own origin. */
function isSlackAddress(url: string): boolean {
  return URL.canParse(url) && new URL(url).origin === SLACK_ORIGIN;
}

/** Stripe's own origins, the ones its Checkout and its Customer Portal are opened on (https://docs.stripe.com/payments/checkout, https://docs.stripe.com/customer-management). */
const STRIPE_ORIGINS: readonly string[] = [
  "https://checkout.stripe.com",
  "https://billing.stripe.com",
];

/** Whether an address the host answered parses and stands on one of Stripe's own origins. */
function isStripeAddress(url: string): boolean {
  return URL.canParse(url) && STRIPE_ORIGINS.includes(new URL(url).origin);
}

/** The handlers of the connections, whose procedures open what they answer. */
type ConnectActs = Pick<
  HostActTable,
  | "WORKSPACE_GITHUB_CONNECT"
  | "WORKSPACE_SENTRY_INSTALL"
  | "WORKSPACE_SLACK_BOT_INSTALL"
  | "WORKSPACE_BILLING_SETUP"
  | "WORKSPACE_BILLING_PORTAL"
>;

export function workspaceProcedures(
  dependencies: WorkspaceProceduresDependencies,
  acts: ConnectActs,
) {
  const { openExternal, githubLanding } = dependencies;

  return {
    // Note that the address the service answered opens only where it is
    // GitHub's, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_GITHUB_CONNECT,
        acts.WORKSPACE_GITHUB_CONNECT,
        input,
      );

      if (!isGitHubAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({
        try: () => openExternal(url, githubLanding),
        catch: () => errors.REFUSED(),
      });
    }),
    // Note that the address the service answered opens only where it is
    // Sentry's own, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_SENTRY_INSTALL,
        acts.WORKSPACE_SENTRY_INSTALL,
        input,
      );

      if (!isSentryAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    // Note that the address the service answered opens only where it is
    // Stripe's own, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_BILLING_SETUP]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_BILLING_SETUP
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_BILLING_SETUP,
        acts.WORKSPACE_BILLING_SETUP,
        input,
      );

      if (!isStripeAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    [WORKSPACE_ACT_KIND.WORKSPACE_BILLING_PORTAL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_BILLING_PORTAL
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_BILLING_PORTAL,
        acts.WORKSPACE_BILLING_PORTAL,
        input,
      );

      if (!isStripeAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    // Note that the address the service answered opens only where it is
    // Slack's own, because it is the one address here the panel did not name.
    [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_INSTALL]: actPort[
      WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_INSTALL
    ].effect(function* ({ input, errors }) {
      const url = yield* declaredAnswer(
        WORKSPACE_ACTS.WORKSPACE_SLACK_BOT_INSTALL,
        acts.WORKSPACE_SLACK_BOT_INSTALL,
        input,
      );

      if (!isSlackAddress(url)) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
  };
}
