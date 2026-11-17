/**
 * usage-sending.test.ts -- the usage ledger's unsent charges sent to Metronome, over the test's own database and a faked Metronome: a workspace's first send makes its customer and contract, each charge goes once as an event of its workspace and is stamped sent, a 429 is tried again, a refusal leaves its charges unsent, and nothing is sent where no account is configured. Synthetic accounts, workspaces, charges, and ids throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { recordUsageCharges, unsentUsageCharges } from "@repo/database/models/usage-charges";
import { workspaceBilling } from "@repo/database/models/workspace-billing";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { BillingEnvironment, type BillingEnvironmentValues } from "./billing-environment.js";
import type { MetronomeEvent } from "./metronome.js";
import { sendUnsentUsage } from "./usage-sending.js";

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

/** The workspace's unsent charges' row ids, by amount. */
function acmeRows(organizationId: string) {
  return Effect.map(
    unsentUsageCharges({ since: new Date(0), after: null, limit: 10_000 }),
    (page) =>
      new Map(
        page
          .filter((row) => row.organizationId === organizationId)
          .map((row) => [row.amountMicroUsd, row.id]),
      ),
  );
}

it.layer(getTestDB())("usage sent to Metronome", (it) => {
  it.effect(
    "makes a workspace's customer and contract once, from the month of its earliest unsent charge, sends each charge once as its event, and stamps it sent",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);
        yield* recordUsageCharges([
          // Last month's, so the contract starts on its 1st and covers it.
          charge(acme, 2_500, "2026-10-30T08:00:00Z"),
          charge(acme, 400, "2026-11-11T09:30:00Z"),
          // Older than Metronome takes an event, so never read.
          charge(acme, 9_000, "2026-09-01T00:00:00Z"),
        ]);
        const rows = yield* acmeRows(acme);
        const fake = metronome();

        const send = sendUnsentUsage().pipe(
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

  it.effect("tries a 429 again, and leaves a refused batch unsent for the next run", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW.getTime());
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      yield* recordUsageCharges([charge(acme, 700, "2026-11-12T00:00:00Z")]);
      const environment = Layer.succeed(BillingEnvironment, ACCOUNT);

      const refused = metronome((path) => (path === "/v1/ingest" ? 400 : 200));
      yield* sendUnsentUsage().pipe(Effect.provide(Layer.merge(refused.layer, environment)));
      assert.equal(eventsOf(refused, acme).length, 1);

      const limited = metronome((path, attempt) =>
        path === "/v1/ingest" && attempt === 1 ? 429 : 200,
      );

      const pending = yield* Effect.forkChild(
        sendUnsentUsage().pipe(Effect.provide(Layer.merge(limited.layer, environment))),
      );

      yield* TestClock.adjust("1 minute");
      yield* Fiber.join(pending);
      assert.equal(eventsOf(limited, acme).length, 2);

      const after = metronome();
      yield* sendUnsentUsage().pipe(Effect.provide(Layer.merge(after.layer, environment)));
      assert.deepEqual(eventsOf(after, acme), []);
    }),
  );

  it.effect("sends nothing where no Metronome account is configured", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW.getTime());
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      yield* recordUsageCharges([charge(acme, 100, "2026-11-12T00:00:00Z")]);
      const fake = metronome();

      const run = yield* sendUnsentUsage().pipe(
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
