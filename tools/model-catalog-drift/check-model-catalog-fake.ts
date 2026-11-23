/**
 * check-model-catalog-fake.ts -- hold the fake AI Gateway catalog against the live one, so a hermetic green run cannot hide drift.
 *
 *   pnpm --filter @repo/model-catalog-drift check
 *
 * The end-to-end suite starts agents on `FAKE_GATEWAY_CATALOG` in place of
 * AI Gateway's `/v1/models`. This reads the live catalog and the fake each
 * through the deployment's own `modelCatalogLayer`, so both pass the same
 * schema, filter, and pricing, and fails where a fake model is no longer
 * offered live, or is offered with a field the service reads (its name,
 * efforts, windows, or prices) changed. It reaches the network, so it is no
 * test: the nightly `.github/workflows/model-catalog-drift.yml` runs it, off the PR
 * path. The catalog is public and takes no credential.
 */

import {
  ModelCatalog,
  modelCatalogLayer,
  type OfferedModel,
} from "@repo/service/providers/model-catalog";
import {
  FAKE_GATEWAY_CATALOG,
  fakeModelCatalogLayer,
} from "@repo/service/testing/model-catalog-fake";
import { Effect, Exit, Layer, Schema } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

/** The live catalog's ids alone, to tell a model the gateway dropped from one the service now filters out. */
const CatalogIdsSchema = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

/** One field that differs between the fake's offered model and the live one. */
interface FieldDrift {
  readonly path: string;
  readonly fake: string | undefined;
  readonly live: string | undefined;
}

/**
 * The fields of an offered model the service reads, each as JSON so an
 * array or a price table compares whole: everything the catalog sets but
 * its id, which is what the models are matched on.
 */
const OFFERED_FIELDS = {
  name: (model: OfferedModel) => model.name,
  provider: (model: OfferedModel) => model.provider,
  efforts: (model: OfferedModel) => model.efforts,
  contextWindow: (model: OfferedModel) => model.contextWindow,
  contextWindows: (model: OfferedModel) => model.contextWindows,
  pricing: (model: OfferedModel) => model.pricing,
} as const;

/** Every field the fake and the live model read differently. */
function driftOf(fake: OfferedModel, live: OfferedModel): readonly FieldDrift[] {
  return Object.entries(OFFERED_FIELDS).flatMap(([path, read]) => {
    const field = { path, fake: JSON.stringify(read(fake)), live: JSON.stringify(read(live)) };

    return field.fake === field.live ? [] : [field];
  });
}

/** What the live catalog says of one fake model, as lines to print; none where it agrees. */
function problemsOf(
  fake: OfferedModel,
  live: readonly OfferedModel[],
  liveIds: ReadonlySet<string>,
): readonly string[] {
  const match = live.find((model) => model.id === fake.id);

  if (match !== undefined) {
    return driftOf(fake, match).map(
      (field) => `${fake.id}: ${field.path} is ${field.live} live, ${field.fake} in the fake`,
    );
  }

  return liveIds.has(fake.id)
    ? [`${fake.id}: listed live, but the service no longer offers it from its live entry`]
    : [`${fake.id}: no longer in the live catalog`];
}

const readCatalog = (layer: Layer.Layer<ModelCatalog>) =>
  ModelCatalog.use((catalog) => catalog.read).pipe(Effect.provide(layer));

const readLiveIds = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(MODEL_CATALOG_URL).pipe(HttpClientRequest.acceptJson);

  const response = yield* client
    .execute(request)
    .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));

  const answer = yield* HttpClientResponse.schemaBodyJson(CatalogIdsSchema)(response);

  return new Set(answer.data.map((entry) => entry.id));
}).pipe(Effect.scoped);

const checkModelCatalogFake = Effect.gen(function* () {
  const fake = yield* readCatalog(fakeModelCatalogLayer);
  const live = yield* readCatalog(modelCatalogLayer.pipe(Layer.provide(FetchHttpClient.layer)));
  const liveIds = yield* readLiveIds.pipe(Effect.provide(FetchHttpClient.layer));
  const fakeIds = FAKE_GATEWAY_CATALOG.data.map((entry) => entry.id);
  const offeredIds = new Set(fake.map((model) => model.id));

  // Note that a fake entry the service refuses is drift too, because the suite then starts no agent on it.
  const refused = fakeIds.flatMap((id) =>
    offeredIds.has(id) ? [] : [`${id}: the service does not offer the fake's own entry`],
  );

  const problems = [...refused, ...fake.flatMap((model) => problemsOf(model, live, liveIds))];

  for (const model of fake) yield* Effect.log(`checked ${model.id} against ${MODEL_CATALOG_URL}`);

  return problems;
});

// ------------------------------------------------------------- entry point

const exit = await Effect.runPromiseExit(checkModelCatalogFake);

if (Exit.isFailure(exit)) {
  console.error(`::error::could not read the catalog: ${String(exit.cause)}`);
  process.exitCode = 1;
} else if (exit.value.length > 0) {
  for (const problem of exit.value) console.error(`::error::${problem}`);
  console.error(
    "FAKE_GATEWAY_CATALOG (packages/service/src/testing/model-catalog-fake.ts) has drifted from AI Gateway: refresh its entries from the live /v1/models.",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("FAKE_GATEWAY_CATALOG matches the live AI Gateway catalog.\n");
}
