/**
 * billing-environment.ts -- what the deployment's environment says about billing, read once as the services are built: the Metronome account usage is sent to, and the secret its webhook is signed with.
 *
 * Usage is sent to Metronome only where its token and the two ids made in
 * its one-time setup are all set (`metronome.ts`'s `METRONOME_SETUP`); with
 * any of them unset the daily job writes the ledger and sends nothing, so
 * the service deploys before the account exists. A blank value is unset.
 */

import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";

/** The variables billing is read from. */
const BILLING_ENVIRONMENT = {
  /** Metronome's API token, which every call to Metronome carries. */
  METRONOME_API_TOKEN: "METRONOME_API_TOKEN",
  /** The rate card every workspace's contract is made on. */
  METRONOME_RATE_CARD_ID: "METRONOME_RATE_CARD_ID",
  /** The fixed product each contract's monthly included-usage credit is made on. */
  METRONOME_CREDIT_PRODUCT_ID: "METRONOME_CREDIT_PRODUCT_ID",
  /** The secret Metronome signs its webhook deliveries with. */
  METRONOME_WEBHOOK_SECRET: "METRONOME_WEBHOOK_SECRET",
} as const;

/** The Metronome account usage is sent to: its token, and the ids its one-time setup made. */
export interface MetronomeAccount {
  readonly apiToken: Redacted.Redacted;
  readonly rateCardId: string;
  readonly creditProductId: string;
}

export interface BillingEnvironmentValues {
  /** Where usage is sent; absent leaves every charge unsent. */
  readonly metronome: MetronomeAccount | undefined;
  /** The secret Metronome's webhook deliveries are signed with; absent refuses every delivery. */
  readonly metronomeWebhookSecret: Redacted.Redacted | undefined;
}

export class BillingEnvironment extends Context.Service<
  BillingEnvironment,
  BillingEnvironmentValues
>()("BillingEnvironment") {}

/** A secret read, trimmed, and absent where blank. */
function presentSecret(read: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  const value = text(Option.getOrUndefined(Option.map(read, Redacted.value)));

  return value === undefined ? undefined : Redacted.make(value);
}

/** Billing as this deployment's own environment configures it, read as the services are built. */
export const billingEnvironment = Layer.effect(
  BillingEnvironment,
  Effect.map(
    Config.all({
      apiToken: Config.option(Config.Redacted(BILLING_ENVIRONMENT.METRONOME_API_TOKEN)),
      rateCardId: Config.option(Config.String(BILLING_ENVIRONMENT.METRONOME_RATE_CARD_ID)),
      creditProductId: Config.option(
        Config.String(BILLING_ENVIRONMENT.METRONOME_CREDIT_PRODUCT_ID),
      ),
      webhookSecret: Config.option(Config.Redacted(BILLING_ENVIRONMENT.METRONOME_WEBHOOK_SECRET)),
    }),
    (read) => {
      const apiToken = presentSecret(read.apiToken);
      const rateCardId = text(Option.getOrUndefined(read.rateCardId));
      const creditProductId = text(Option.getOrUndefined(read.creditProductId));

      const values: BillingEnvironmentValues = {
        metronome:
          apiToken === undefined || rateCardId === undefined || creditProductId === undefined
            ? undefined
            : { apiToken, rateCardId, creditProductId },
        metronomeWebhookSecret: presentSecret(read.webhookSecret),
      };

      return values;
    },
  ),
);
