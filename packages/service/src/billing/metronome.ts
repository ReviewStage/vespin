/**
 * metronome.ts -- the calls we make to Metronome, which rates each workspace's usage and invoices it: a customer and its contract made for a workspace, and usage events sent on.
 *
 * Metronome is set up once by hand (written down in the pull request that
 * added this): a SUM billable metric over each usage kind's event, a USAGE
 * product on it that divides by 1,000,000 so quantities read in dollars, a
 * rate card pricing it at 100 cents a dollar, and a FIXED product the
 * monthly included-usage credit is made on. The rate card's and the credit
 * product's ids are read from the environment (`billing-environment.ts`);
 * the event each usage kind is sent as is fixed here (`METRONOME_USAGE`).
 *
 * Every workspace is one customer, whose ingest alias is the workspace's id,
 * so an event names the workspace and never Metronome's own id. Its contract
 * runs on the rate card from the 1st of the month it was made in, billed
 * monthly on the 1st, with one recurring credit of the included usage
 * (`INCLUDED_USAGE_MICRO_USD`) a period, unprorated and never rolled over
 * (https://docs.metronome.com/guides/pricing-packaging/billing-model-guides/free-trials/implement-a-trial).
 * Neither names a billing provider, so Metronome keeps its invoices to
 * itself until billing is set up.
 *
 * A call answered 429 or 5xx, or not answered at all, is tried again with
 * backoff; any other refusal fails at once. A failure says the path, the
 * status, and Metronome's own message, never the token.
 */

import {
  INCLUDED_USAGE_MICRO_USD,
  USAGE_KIND,
  type UsageKind,
} from "@repo/database/usage-vocabulary";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Data, Duration, Effect, Redacted, Result, Schedule, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, EXCESS_KEYS, fixedBearer } from "../core.js";
import type { MetronomeAccount } from "./billing-environment.js";

/** Metronome's API, as https://docs.metronome.com/api-reference names it. */
export const METRONOME = {
  BASE_URL: "https://api.metronome.com",
  CUSTOMERS_PATH: "/v1/customers",
  CREATE_CONTRACT_PATH: "/v1/contracts/create",
  INGEST_PATH: "/v1/ingest",
  /** The most events one ingest request takes. */
  INGEST_BATCH: 100,
  REQUEST_TIMEOUT_MS: 15_000,
} as const;

/** What each kind of usage is sent to Metronome as: its event type, and the property its cost in micro-dollars rides in, which the kind's billable metric sums. */
export const METRONOME_USAGE = {
  [USAGE_KIND.SANDBOX_SESSION]: { eventType: "sandbox_session", costProperty: "cost_micro_usd" },
} as const satisfies Record<UsageKind, { eventType: string; costProperty: string }>;

/** How a contract is billed, as Metronome spells it: monthly, on the 1st. */
const USAGE_STATEMENT_SCHEDULE = { frequency: "MONTHLY", day: "FIRST_OF_MONTH" } as const;

/** The included-usage credit, as Metronome spells its terms: one period long, unprorated, nothing rolled over. */
const INCLUDED_CREDIT = {
  NAME: "Included usage",
  PRIORITY: 1,
  DURATION: { value: 1, unit: "PERIODS" },
  PRORATION: "NONE",
  ROLLOVER_FRACTION: 0,
} as const;

/** A contract's name on Metronome's invoices. */
const CONTRACT_NAME = `${PRODUCT_NAME} usage`;

const MICRO_USD_PER_CENT = 10_000;

/** How a call Metronome may answer later is tried again: a second apart, doubling, at most four more times. */
const RETRY = {
  FIRST_WAIT: Duration.seconds(1),
  TIMES: 4,
} as const;

/** The statuses tried again: too many requests, and anything Metronome failed at itself. */
const RETRIED_STATUS = {
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR_FROM: 500,
} as const;

/** The longest of Metronome's own message a failure keeps. */
const MESSAGE_LIMIT = 300;

/** A call Metronome refused or never answered: its path, its status where it answered, its own message where it gave one, and whether it was worth trying again. */
export class MetronomeCallFailed extends Data.TaggedError("MetronomeCallFailed")<{
  readonly path: string;
  readonly status: number | undefined;
  readonly message: string;
  readonly retryable: boolean;
}> {}

/** One usage event as Metronome's ingest takes it (https://docs.metronome.com/api-reference/usage/ingest-events). */
export interface MetronomeEvent {
  readonly transaction_id: string;
  readonly customer_id: string;
  readonly event_type: string;
  readonly timestamp: string;
  readonly properties: Readonly<Record<string, string>>;
}

/** A customer as `POST /v1/customers` takes it: its name, and the aliases its events name it by. */
interface MetronomeCustomerInput {
  readonly name: string;
  readonly ingest_aliases: readonly string[];
}

/** A contract as `POST /v1/contracts/create` takes it, as far as we make one: on the rate card, billed monthly on the 1st, with the included-usage credit. */
interface MetronomeContractInput {
  readonly customer_id: string;
  readonly rate_card_id: string;
  readonly starting_at: string;
  readonly name: string;
  readonly uniqueness_key: string;
  readonly usage_statement_schedule: typeof USAGE_STATEMENT_SCHEDULE;
  readonly recurring_credits: readonly {
    readonly name: string;
    readonly product_id: string;
    readonly priority: number;
    readonly access_amount: { readonly unit_price: number; readonly quantity: number };
    readonly commit_duration: typeof INCLUDED_CREDIT.DURATION;
    readonly starting_at: string;
    readonly proration: typeof INCLUDED_CREDIT.PRORATION;
    readonly rollover_fraction: number;
  }[];
}

/** What a request to Metronome carries: a customer, a contract, or a batch of events. */
type MetronomeRequestBody =
  | MetronomeCustomerInput
  | MetronomeContractInput
  | readonly MetronomeEvent[];

const CreatedSchema = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) });

const readCreated = readEither(CreatedSchema, { excess: EXCESS_KEYS.DROP });

const ErrorSchema = Schema.Struct({ message: Schema.String });

const readError = readEither(ErrorSchema, { excess: EXCESS_KEYS.DROP });

/** Whether a status is one Metronome may answer otherwise later. */
function retryableStatus(status: number): boolean {
  return status === RETRIED_STATUS.TOO_MANY_REQUESTS || status >= RETRIED_STATUS.SERVER_ERROR_FROM;
}

/** One request to Metronome under the account's token, answered with its body where it was 2xx; tried again while Metronome may answer otherwise later. */
function metronomeRequest(
  account: MetronomeAccount,
  path: string,
  body: MetronomeRequestBody,
): Effect.Effect<UnparsedWireValue, MetronomeCallFailed, HttpClient.HttpClient> {
  const call = accountCall({
    baseUrl: METRONOME.BASE_URL,
    // The token is revealed here alone, into the header the call carries.
    credential: fixedBearer(Redacted.value(account.apiToken)),
    requestTimeoutMs: METRONOME.REQUEST_TIMEOUT_MS,
  });

  const once = Effect.gen(function* () {
    const answer = yield* call.send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(body) });

    if (!callAnswered(answer)) {
      return yield* new MetronomeCallFailed({
        path,
        status: undefined,
        message: answer.errorName ?? answer.fault,
        retryable: true,
      });
    }

    const response = answer.response;

    const read = yield* Effect.promise(
      (): Promise<UnparsedWireValue> => response.json().catch(() => undefined),
    );

    if (answer.response.ok) return read;
    const refusal = readError(read);

    return yield* new MetronomeCallFailed({
      path,
      status: answer.response.status,
      message: Result.isSuccess(refusal) ? refusal.success.message.slice(0, MESSAGE_LIMIT) : "",
      retryable: retryableStatus(answer.response.status),
    });
  });

  return once.pipe(
    Effect.retry({
      schedule: Schedule.exponential(RETRY.FIRST_WAIT),
      times: RETRY.TIMES,
      while: (failure) => failure.retryable,
    }),
  );
}

/** The id of what a create call made, or a failure where its answer named none. */
function createdId(
  path: string,
  read: UnparsedWireValue,
): Effect.Effect<string, MetronomeCallFailed> {
  const created = readCreated(read);

  return Result.isSuccess(created)
    ? Effect.succeed(created.success.data.id)
    : Effect.fail(
        new MetronomeCallFailed({
          path,
          status: undefined,
          message: "the answer named no id",
          retryable: false,
        }),
      );
}

/** Makes the workspace's Metronome customer, known by the workspace's id as its name and its one ingest alias, with no billing provider; answers its id. */
export const createMetronomeCustomer = Effect.fn("web/createMetronomeCustomer")(function* (
  account: MetronomeAccount,
  organizationId: string,
) {
  const read = yield* metronomeRequest(account, METRONOME.CUSTOMERS_PATH, {
    name: organizationId,
    ingest_aliases: [organizationId],
  });

  return yield* createdId(METRONOME.CUSTOMERS_PATH, read);
});

/**
 * Makes the workspace's contract on the customer, from `startingAt` (the 1st
 * of a month, UTC) on the rate card, with the included-usage credit; answers
 * its id. The workspace's id is the contract's uniqueness key, so a second
 * contract is never made for one workspace however often this is asked.
 */
export const createMetronomeContract = Effect.fn("web/createMetronomeContract")(function* (
  account: MetronomeAccount,
  contract: {
    readonly organizationId: string;
    readonly customerId: string;
    readonly startingAt: Date;
  },
) {
  const startingAt = contract.startingAt.toISOString();

  const read = yield* metronomeRequest(account, METRONOME.CREATE_CONTRACT_PATH, {
    customer_id: contract.customerId,
    rate_card_id: account.rateCardId,
    starting_at: startingAt,
    name: CONTRACT_NAME,
    uniqueness_key: contract.organizationId,
    usage_statement_schedule: USAGE_STATEMENT_SCHEDULE,
    recurring_credits: [
      {
        name: INCLUDED_CREDIT.NAME,
        product_id: account.creditProductId,
        priority: INCLUDED_CREDIT.PRIORITY,
        access_amount: { unit_price: INCLUDED_USAGE_MICRO_USD / MICRO_USD_PER_CENT, quantity: 1 },
        commit_duration: INCLUDED_CREDIT.DURATION,
        starting_at: startingAt,
        proration: INCLUDED_CREDIT.PRORATION,
        rollover_fraction: INCLUDED_CREDIT.ROLLOVER_FRACTION,
      },
    ],
  });

  return yield* createdId(METRONOME.CREATE_CONTRACT_PATH, read);
});

/** Sends up to `METRONOME.INGEST_BATCH` events; Metronome ignores an event whose transaction id it took within 34 days. */
export const ingestMetronomeEvents = Effect.fn("web/ingestMetronomeEvents")(function* (
  account: MetronomeAccount,
  events: readonly MetronomeEvent[],
) {
  yield* metronomeRequest(account, METRONOME.INGEST_PATH, events);
});
