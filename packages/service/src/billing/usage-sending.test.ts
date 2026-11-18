/**
 * usage-sending.test.ts -- the usage-sends consumer's charges sent to Metronome, over the test's own database and a faked Metronome: a workspace's first send makes its customer and contract, each charge goes once as an event of its workspace and is stamped sent, a 429 or 5xx that outlasts the retries fails the send so the queue delivers it again, another refusal is set aside with its charges left unsent, and nothing is sent where no account is configured. Synthetic accounts, workspaces, charges, and ids throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  recordUsageCharges,
  type UsageCharge,
  unsentChargeIdsOf,
  unsentUsageChargesOf,
} from "@repo/database/models/usage-charges";
import { workspaceBilling } from "@repo/database/models/workspace-billing";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Exit, Fiber, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { BillingEnvironment, type BillingEnvironmentValues } from "./billing-environment.js";
import type { MetronomeEvent } from "./metronome.js";
import { sendUsageCharges } from "./usage-sending.js";

const NOW = new Date("2026-11-16T12:00:00Z");

const ACCOUNT: BillingEnvironmentValues = {
  metronome: {
    apiToken: Redacted.make("metronome-test-token"),
    rateCardId: "rate-card-1",
    creditProductId: "credit-product-1",
  },
  metronomeWebhookSecret: undefined,
  live: false,
  stripeSecretKey: undefined,
  stripeWebhookSecret: undefined,
  exemptWorkspaceId: undefined,
};

/** The fields of a create's body the tests pick it out by; the rest is compared whole. */
interface CreateBody {
  readonly ingest_aliases?: readonly string[];
  readonly uniqueness_key?: string;
}

/** A create Metronome was sent: its path, its bearer, and its body as the client wrote it. */
interface SentCreate {
  readonly path: string;
  readonly authorization: string | null;
  readonly body: CreateBody;
}

/**
 * A faked Metronome that takes every request, answering a create with a new
 * id, unless `answer` names another status for the request's path; it keeps
 * every create and every event it was sent, refused or not.
 */
function metronome(answer: (path: string, attempt: number) => number = () => 200) {
  const creates: SentCreate[] = [];
  const events: MetronomeEvent[] = [];
  const attempts = new Map<string, number>();

  const layer = fakeHttpClientLayer((url, init) => {
    const path = new URL(url).pathname;
    const attempt = (attempts.get(path) ?? 0) + 1;
    const body = JSON.parse(String(init.body));
    attempts.set(path, attempt);

    if (path === "/v1/ingest") {
      events.push(...body);
    } else {
      creates.push({ path, authorization: new Headers(init.headers).get("authorization"), body });
    }

    const status = answer(path, attempt);

    return new Response(
      JSON.stringify(status === 200 ? { data: { id: randomUUID() } } : { message: "refused" }),
      {
        status,
      },
    );
  });

  return { layer, creates, events };
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A sandbox session's charge to the workspace of the amount at the instant. */
function charge(organizationId: string, amountMicroUsd: number, occurredAt: string) {
  return {
    organizationId,
    userId: null,
    kind: USAGE_KIND.SANDBOX_SESSION,
    sourceId: `sbx_${randomUUID()}`,
    figures: {
      sandboxName: `agent-sandbox-${randomUUID()}`,
      status: "stopped",
      region: "iad1",
      vcpus: 4,
      memoryMb: 8192,
      startedAt: null,
      stoppedAt: null,
      durationMs: 60_000,
      billedMinutes: 1,
      activeCpuMs: null,
      ingressBytes: null,
      egressBytes: null,
      cpuMicroUsdPerHour: 128_000,
      memoryMicroUsdPerGbHour: 21_200,
      transferMicroUsdPerGb: 150_000,
    },
    amountMicroUsd,
    occurredAt: new Date(occurredAt),
  };
}

/** The events sent for the workspace, as Metronome was handed them. */
function eventsOf(fake: { readonly events: readonly MetronomeEvent[] }, organizationId: string) {
  return fake.events.filter((event) => event.customer_id === organizationId);
}

/** The charges recorded, and their unsent rows' ids by amount. */
function recorded(charges: readonly UsageCharge[]) {
  return Effect.gen(function* () {
    yield* recordUsageCharges(charges);

    const ids = yield* unsentChargeIdsOf(
      USAGE_KIND.SANDBOX_SESSION,
      charges.map((each) => each.sourceId),
    );

    const rows = yield* unsentUsageChargesOf(ids);

    return { ids, byAmount: new Map(rows.map((row) => [row.amountMicroUsd, row.id])) };
  });
}

it.layer(getTestDB())("usage sent to Metronome", (it) => {
  it.effect(
    "makes a workspace's customer and contract once, from the month of its earliest unsent charge, sends each charge once as its event, and stamps it sent",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);

        const { ids, byAmount: rows } = yield* recorded([
          // Last month's, so the contract starts on its 1st and covers it.
          charge(acme, 2_500, "2026-10-30T08:00:00Z"),
          charge(acme, 400, "2026-11-11T09:30:00Z"),
        ]);

        const fake = metronome();

        // Its message delivered twice, as the queue may.
        const send = sendUsageCharges(ids).pipe(
          Effect.provide(Layer.merge(fake.layer, Layer.succeed(BillingEnvironment, ACCOUNT))),
        );

        yield* send;
        yield* send;

        const customers = fake.creates.filter(
          (request) =>
            request.path === "/v1/customers" && request.body.ingest_aliases?.[0] === acme,
        );

        assert.deepEqual(
          customers.map((request) => request.body),
          [{ name: acme, ingest_aliases: [acme] }],
        );
        assert.equal(customers[0]?.authorization, "Bearer metronome-test-token");

        const contracts = fake.creates.filter(
          (request) =>
            request.path === "/v1/contracts/create" && request.body.uniqueness_key === acme,
        );

        assert.equal(contracts.length, 1);
        assert.deepEqual(contracts[0]?.body, {
          customer_id: Option.getOrThrow(yield* workspaceBilling(acme)).metronomeCustomerId,
          rate_card_id: "rate-card-1",
          starting_at: "2026-10-01T00:00:00.000Z",
          name: "Vespin usage",
          uniqueness_key: acme,
          usage_statement_schedule: { frequency: "MONTHLY", day: "FIRST_OF_MONTH" },
          recurring_credits: [
            {
              name: "Included usage",
              product_id: "credit-product-1",
              priority: 1,
              // $10 in cents.
              access_amount: { unit_price: 1000, quantity: 1 },
              commit_duration: { value: 1, unit: "PERIODS" },
              starting_at: "2026-10-01T00:00:00.000Z",
              proration: "NONE",
              rollover_fraction: 0,
            },
          ],
        });

        // Each charge is sent once, under its own row's id.
        assert.deepEqual(
          eventsOf(fake, acme).toSorted((a, b) => a.timestamp.localeCompare(b.timestamp)),
          [
            {
              transaction_id: rows.get(2_500),
              customer_id: acme,
              event_type: "sandbox_session",
              timestamp: "2026-10-30T08:00:00.000Z",
              properties: { cost_micro_usd: "2500" },
            },
            {
              transaction_id: rows.get(400),
              customer_id: acme,
              event_type: "sandbox_session",
              timestamp: "2026-11-11T09:30:00.000Z",
              properties: { cost_micro_usd: "400" },
            },
          ],
        );

        const billing = yield* workspaceBilling(acme);
        assert.equal(Option.isSome(billing) && billing.value.metronomeContractId !== null, true);
      }),
  );

  it.effect(
    "fails a send whose 429 or 5xx outlasts the retries, so the queue delivers it again, and sets another refusal aside unsent",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        const { ids } = yield* recorded([charge(acme, 700, "2026-11-12T00:00:00Z")]);
        const environment = Layer.succeed(BillingEnvironment, ACCOUNT);

        // Metronome's answer to every ingest, and what the send did over it.
        const sentOver = (status: number) =>
          Effect.gen(function* () {
            const fake = metronome((path) => (path === "/v1/ingest" ? status : 200));

            const pending = yield* Effect.forkChild(
              Effect.exit(
                sendUsageCharges(ids).pipe(Effect.provide(Layer.merge(fake.layer, environment))),
              ),
            );

            yield* TestClock.adjust("1 minute");

            const exit = yield* Fiber.join(pending);

            return {
              failed: Exit.isFailure(exit),
              run: Exit.isSuccess(exit) ? exit.value : undefined,
              events: eventsOf(fake, acme).length,
            };
          });

        for (const status of [429, 503]) {
          const { failed, events } = yield* sentOver(status);

          // Tried five times, then failed for the queue to deliver again.
          assert.deepEqual([failed, events], [true, 5]);
        }

        const refused = yield* sentOver(400);
        assert.deepEqual(refused.run, { configured: true, sent: 0, unsent: 1 });
        assert.equal(refused.events, 1);

        const taken = yield* sentOver(200);
        assert.deepEqual(taken.run, { configured: true, sent: 1, unsent: 0 });

        // Its message again sends nothing, the charge stamped sent.
        assert.deepEqual(yield* unsentUsageChargesOf(ids), []);
      }),
  );

  it.effect("sends nothing where no Metronome account is configured", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW.getTime());
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      const { ids } = yield* recorded([charge(acme, 100, "2026-11-12T00:00:00Z")]);
      const fake = metronome();

      const run = yield* sendUsageCharges(ids).pipe(
        Effect.provide(
          Layer.merge(
            fake.layer,
            Layer.succeed(BillingEnvironment, {
              metronome: undefined,
              metronomeWebhookSecret: undefined,
              live: false,
              stripeSecretKey: undefined,
              stripeWebhookSecret: undefined,
              exemptWorkspaceId: undefined,
            }),
          ),
        ),
      );

      assert.deepEqual(run, { configured: false, sent: 0, unsent: 0 });
      assert.deepEqual([fake.creates, fake.events], [[], []]);
      assert.equal(Option.isNone(yield* workspaceBilling(acme)), true);
    }),
  );
});
