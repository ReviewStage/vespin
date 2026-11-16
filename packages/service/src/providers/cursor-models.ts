/**
 * cursor-models.ts -- the Cursor models a coding agent may run on: every model the account's own Cursor key lists, read live from Cursor, or a pinned few where Cursor cannot be read.
 *
 * Cursor bills its own models, so they are no AI Gateway entry and no
 * other provider's: each is offered as a catalog entry of its own under
 * `cursor/`, run on Cursor's harness on the account's Cursor API key. The
 * list is Cursor's own, read with the account's key (`GET
 * api.cursor.com/v1/models`, which `@cursor/sdk`'s `Cursor.models.list()`
 * answers too) and kept for a few minutes (`CursorModelCatalog`), so a model
 * Cursor adds is offered with no change here. Beside each entry stand
 * Cursor's own words for it: its model id, the parameter its effort is
 * spelled by (`effort`, `reasoning_effort`, or `reasoning`, as each model
 * names its own), whether it takes `fast`, the parameters every choice of
 * it sends as they are, and whether it runs in Max Mode, so the runner is
 * handed Cursor's `ModelSelection` (`{ id, params, maxMode }`) whole.
 *
 * Each of Cursor's models is read by one rule (`cursorModelsOf`). Its
 * effort is the first of the three effort parameters it lists, and a model
 * listing none still lists one effort (`NO_EFFORT`), since a choice always
 * names one; it sends Cursor nothing. Its other parameters (a context
 * window, thinking) are pinned as its default variant sets them. It is
 * offered at fast speed beside its own, as AI Gateway's fast slugs are,
 * where a variant of it runs `fast`: its own id sends `fast: false`, and
 * the id with `-fast` (`MODEL_SPEED_SUFFIX`) sends `fast: true`. Where it
 * lists variants that run only in Max Mode, Cursor's larger window at a
 * price of its own, it is also offered as a model of its own named so
 * (`… (Max Mode)`, `cursor/<id>-max`), pinned as its Max Mode variant sets
 * its parameters and sent with `maxMode`, so a Max Mode run is always one
 * its starter chose by name. Cursor's `default` is offered as `cursor/auto`,
 * since Cursor answers to `auto` too and a tab reads the label off the id.
 *
 * Where Cursor's list cannot be read (no key yet, Cursor down, an answer
 * of another shape), the few models pinned here stand in, so a member
 * still sees Cursor's mark and a Connect where no key is saved.
 *
 * Who is offered them is `withCursorModels`'s to say: an account with Cursor agents on
 * (`EXPERIMENT.CURSOR`, each person's own choice), on a client that reads
 * Cursor as a provider (`CURSOR_CLIENT_API_VERSION`).
 */

import type { CursorModelSelection } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { modelIdAtSpeed } from "@repo/features/model-effort";
import { MODEL_PROVIDER, MODEL_SPEED, NO_EFFORT } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Clock, Context, Duration, Effect, Layer, Option, type Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ownApiKeyOf } from "../accounts/own-api-key.js";
import { HostedEnvironment } from "../environment.js";
import type { OfferedModel } from "./model-catalog.js";

/** The first hosted API version (`HOSTED_API_VERSION`) whose clients read `cursor` as a provider; a catalog answer to an older one never holds a Cursor entry, which would refuse its whole read. */
const CURSOR_CLIENT_API_VERSION = 4;

/** Where Cursor lists the models a key may run. */
const CURSOR_MODELS_URL = "https://api.cursor.com/v1/models";

/** How long one account's read of Cursor's list stands before it is read again. */
const CURSOR_MODELS_TTL = Duration.minutes(10);

/** How long a read of Cursor's list may take before the pinned models stand in. */
const CURSOR_MODELS_TIMEOUT = Duration.seconds(5);

/** The parameters of Cursor's model list this module names, by Cursor's own ids. */
const CURSOR_PARAMETER = {
  EFFORT: "effort",
  REASONING_EFFORT: "reasoning_effort",
  REASONING: "reasoning",
  FAST: "fast",
  CONTEXT: "context",
} as const;

/** The parameters a model may spell its effort by, in the order one is taken where a model lists several. */
const EFFORT_PARAMETERS: readonly string[] = [
  CURSOR_PARAMETER.EFFORT,
  CURSOR_PARAMETER.REASONING_EFFORT,
  CURSOR_PARAMETER.REASONING,
];

/** The value of `fast` that runs a model's fast version. */
const FAST_ON = "true";

/** Cursor's own id for its choice of model per request, and the name we offer it under. */
const CURSOR_AUTO = { CURSOR_ID: "default", SLUG: "auto" } as const;

/** What ends a Max Mode model's catalog id, and its name. */
const MAX_MODE = { ID_SUFFIX: "-max", NAME_SUFFIX: " (Max Mode)" } as const;

/** One parameter of Cursor's `ModelSelection`, as its model list spells it. */
interface CursorParameterValue {
  readonly id: string;
  readonly value: string;
}

/** One Cursor model as we offer it, and Cursor's own words for it. */
export interface CursorModel {
  /** Its catalog id at standard speed (`cursor/grok-4.7`, `cursor/grok-4.7-max`). */
  readonly catalogId: string;
  /** Cursor's model id, which `ModelSelection.id` takes. */
  readonly cursorId: string;
  /** Cursor's name for it. */
  readonly name: string;
  /** The parameter its effort is spelled by and the values it lists, which are the catalog's efforts as they are; none for a model with no effort of its own. */
  readonly effort: { readonly parameter: string; readonly values: readonly string[] } | undefined;
  /** Whether it takes `fast`, and so is offered at fast speed beside its own. */
  readonly fast: boolean;
  /** What every choice of it sends as it is: its window, and any other parameter its variant sets. */
  readonly pinned: readonly CursorParameterValue[];
  /** Whether it runs only in Max Mode, which every choice of it asks for. */
  readonly maxMode: boolean;
}

/**
 * The models offered where Cursor's own list cannot be read, read from it
 * on Nov 16, 2026: Composer 2.5, Cursor's own, whose default variant is its
 * fast one; Auto, Cursor's choice of model per request; and Grok 4.7,
 * pinned to its 256K window, its 500K one being Max Mode's.
 */
const PINNED_CURSOR_MODELS: readonly CursorModel[] = [
  {
    catalogId: "cursor/composer-2.5",
    cursorId: "composer-2.5",
    name: "Composer 2.5",
    effort: undefined,
    fast: true,
    pinned: [],
    maxMode: false,
  },
  {
    catalogId: "cursor/auto",
    cursorId: CURSOR_AUTO.CURSOR_ID,
    name: "Auto",
    effort: undefined,
    fast: false,
    pinned: [],
    maxMode: false,
  },
  {
    catalogId: "cursor/grok-4.7",
    cursorId: "grok-4.7",
    name: "Grok 4.7",
    effort: {
      parameter: CURSOR_PARAMETER.REASONING_EFFORT,
      values: ["low", "medium", "high", "xhigh"],
    },
    fast: true,
    pinned: [{ id: CURSOR_PARAMETER.CONTEXT, value: "256k" }],
    maxMode: false,
  },
];

// ------------------------------------------------------------- the boundary

const ParameterValueSchema = Schema.Struct({ id: Schema.String, value: Schema.String });

/** One model of Cursor's list, the fields this module reads alone, so a field Cursor adds changes nothing here. */
const CursorListItemSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  parameters: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        values: Schema.Array(Schema.Struct({ value: Schema.String })),
      }),
    ),
  ),
  variants: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        params: Schema.Array(ParameterValueSchema),
        isDefault: Schema.optionalKey(Schema.Boolean),
        isMaxMode: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
});

type CursorListItem = typeof CursorListItemSchema.Type;

type CursorVariant = NonNullable<CursorListItem["variants"]>[number];

/** Cursor's answer to a read of its list. */
const CursorListSchema = Schema.Struct({ items: Schema.Array(CursorListItemSchema) });

// ------------------------------------------------------------- the rule

/** A variant's parameters but its effort and speed, which a choice names itself. */
function otherParams(variant: CursorVariant | undefined): readonly CursorParameterValue[] {
  return (variant?.params ?? []).filter(
    (param) => !EFFORT_PARAMETERS.includes(param.id) && param.id !== CURSOR_PARAMETER.FAST,
  );
}

/**
 * What a model offered at one speed alone pins of its variant's speed: the
 * variant's own `fast`, where it sets one, so Cursor never picks the speed.
 */
function pinnedSpeed(variant: CursorVariant | undefined, offeredFast: boolean) {
  if (offeredFast) return [];

  return (variant?.params ?? []).filter((param) => param.id === CURSOR_PARAMETER.FAST);
}

/** Whether any of the variants runs `fast`. */
function runsFast(variants: readonly CursorVariant[]): boolean {
  return variants.some((variant) =>
    variant.params.some((param) => param.id === CURSOR_PARAMETER.FAST && param.value === FAST_ON),
  );
}

/** Whether two sets of parameters say the same, whatever their order. */
function sameParams(
  left: readonly CursorParameterValue[],
  right: readonly CursorParameterValue[],
): boolean {
  return (
    left.length === right.length &&
    left.every((param) =>
      right.some((other) => other.id === param.id && other.value === param.value),
    )
  );
}

/**
 * One of Cursor's models as we offer it: at most two models, its own,
 * pinned as its default variant runs outside Max Mode, and, where it lists
 * variants that run only in Max Mode, its Max Mode one, pinned as the
 * first of those that sets its parameters otherwise.
 */
function offeredOf(item: CursorListItem): readonly CursorModel[] {
  const slug = item.id === CURSOR_AUTO.CURSOR_ID ? CURSOR_AUTO.SLUG : item.id;
  const effortParameter = item.parameters?.find((param) => EFFORT_PARAMETERS.includes(param.id));

  const effort =
    effortParameter === undefined || effortParameter.values.length === 0
      ? undefined
      : {
          parameter: effortParameter.id,
          values: effortParameter.values.map((each) => each.value),
        };

  const variants = item.variants ?? [];
  const standard = variants.filter((variant) => variant.isMaxMode !== true);
  const maxOnly = variants.filter((variant) => variant.isMaxMode === true);
  const base = standard.find((variant) => variant.isDefault === true) ?? standard[0];

  // Note that a model listing no variants runs as its parameters say, `fast` among them.
  const listsFast =
    item.parameters?.some(
      (param) =>
        param.id === CURSOR_PARAMETER.FAST && param.values.some((each) => each.value === FAST_ON),
    ) ?? false;

  const own: readonly CursorModel[] =
    base === undefined && variants.length > 0
      ? []
      : [
          {
            catalogId: `${MODEL_PROVIDER.CURSOR}/${slug}`,
            cursorId: item.id,
            name: item.displayName,
            effort,
            fast: variants.length === 0 ? listsFast : runsFast(standard),
            pinned: [
              ...otherParams(base),
              ...pinnedSpeed(base, variants.length === 0 ? listsFast : runsFast(standard)),
            ],
            maxMode: false,
          },
        ];

  const maxBase =
    maxOnly.find((variant) => !sameParams(otherParams(variant), otherParams(base))) ?? maxOnly[0];

  const max: readonly CursorModel[] =
    maxBase === undefined
      ? []
      : [
          {
            catalogId: `${MODEL_PROVIDER.CURSOR}/${slug}${MAX_MODE.ID_SUFFIX}`,
            cursorId: item.id,
            name: `${item.displayName}${MAX_MODE.NAME_SUFFIX}`,
            effort,
            fast: runsFast(maxOnly),
            pinned: [...otherParams(maxBase), ...pinnedSpeed(maxBase, runsFast(maxOnly))],
            maxMode: true,
          },
        ];

  return [...own, ...max];
}

/** Cursor's list as the models we offer, in Cursor's order, the first of any two that would take one id kept. */
export function cursorModelsOf(items: readonly CursorListItem[]): readonly CursorModel[] {
  const taken = new Set<string>();

  return items.flatMap(offeredOf).filter((model) => {
    if (taken.has(model.catalogId)) return false;
    taken.add(model.catalogId);

    return true;
  });
}

// ------------------------------------------------------------- the read

/** What reads the models one account is offered of Cursor's, with its own key. */
export interface CursorModelReader {
  readonly forAccount: (
    userId: string,
  ) => Effect.Effect<readonly CursorModel[], never, DatabaseServices>;
}

/**
 * Cursor's list as the service reads it: live where the runtime wires
 * `cursorModelCatalogLayer`, and the pinned models elsewhere, as in a test
 * or a tool that reads no network.
 */
export const CursorModelCatalog = Context.Reference<CursorModelReader>("CursorModelCatalog", {
  defaultValue: () => ({ forAccount: () => Effect.succeed(PINNED_CURSOR_MODELS) }),
});

/** One read of Cursor's list on the key given, answered as the models we offer; none where Cursor did not answer it so. */
const readCursorList = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  key: Redacted.Redacted,
) {
  const request = HttpClientRequest.get(CURSOR_MODELS_URL).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(key),
  );

  return yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(CursorListSchema)),
    Effect.scoped,
    Effect.timeout(CURSOR_MODELS_TIMEOUT),
    Effect.map((answer) => cursorModelsOf(answer.items)),
    Effect.map((models) => (models.length === 0 ? Option.none() : Option.some(models))),
    // Note that the failure is not kept, because the request it describes carries the key.
    Effect.catch(() => Effect.succeed(Option.none())),
  );
});

/**
 * Cursor's list as each account's key reads it, kept for `CURSOR_MODELS_TTL`
 * by the account; the pinned models where the account saved no Cursor key
 * or Cursor's list could not be read, which is read again on the next ask.
 */
export const cursorModelCatalogLayer = Layer.effect(
  CursorModelCatalog,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const environment = yield* HostedEnvironment;

    const kept = new Map<
      string,
      { readonly until: number; readonly models: readonly CursorModel[] }
    >();

    const forAccount = Effect.fnUntraced(function* (userId: string) {
      const now = yield* Clock.currentTimeMillis;
      const standing = kept.get(userId);

      if (standing !== undefined && standing.until > now) return standing.models;

      const key = yield* ownApiKeyOf(userId, PROVIDER_KEY_PROVIDER.CURSOR, environment).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );

      if (key === undefined || key === PROVIDER_KEY_UNREADABLE) return PINNED_CURSOR_MODELS;
      const read = yield* readCursorList(client, key);

      if (Option.isNone(read)) return PINNED_CURSOR_MODELS;
      kept.set(userId, { until: now + Duration.toMillis(CURSOR_MODELS_TTL), models: read.value });

      return read.value;
    });

    return { forAccount } satisfies CursorModelReader;
  }),
);

// ------------------------------------------------------------- the offer

/** The catalog entries one Cursor model is offered as: its own, and its fast version right after it where it takes `fast`. */
function catalogEntriesOf(model: CursorModel): readonly OfferedModel[] {
  const own: OfferedModel = {
    id: model.catalogId,
    name: model.name,
    provider: MODEL_PROVIDER.CURSOR,
    efforts: model.effort?.values ?? [NO_EFFORT],
  };

  if (!model.fast) return [own];

  return [
    own,
    {
      ...own,
      id: modelIdAtSpeed(model.catalogId, MODEL_SPEED.FAST),
      name: `${model.name} (Fast)`,
    },
  ];
}

/** What decides whether a catalog answer holds Cursor's models: the account's choice of Cursor agents, and the hosted API version the client asking was built against, none where it named none. */
export interface CursorOffer {
  readonly experimentOn: boolean;
  readonly apiVersion: number | undefined;
}

/** Whether Cursor's models are offered: to an account with Cursor agents on, on a client that reads Cursor as a provider. */
export function offersCursor(offer: CursorOffer): boolean {
  return (
    offer.experimentOn &&
    offer.apiVersion !== undefined &&
    offer.apiVersion >= CURSOR_CLIENT_API_VERSION
  );
}

/**
 * The models given with Cursor's after them where the offer holds
 * (`offersCursor`), the models as they are where it does not. Note that a
 * reader inside the service, which decodes no wire, passes this build's own
 * `HOSTED_API_VERSION`, so only the account's choice decides there.
 */
export function withCursorModels(
  models: readonly OfferedModel[],
  offer: CursorOffer,
  cursorModels: readonly CursorModel[],
): readonly OfferedModel[] {
  return offersCursor(offer) ? [...models, ...cursorModels.flatMap(catalogEntriesOf)] : models;
}

/** The Cursor model a catalog id names, at the speed it names; none for an id that names none of them. */
function cursorModelAt(
  cursorModels: readonly CursorModel[],
  catalogId: string,
): { readonly model: CursorModel; readonly fast: boolean } | undefined {
  for (const model of cursorModels) {
    if (model.catalogId === catalogId) return { model, fast: false };

    if (model.fast && modelIdAtSpeed(model.catalogId, MODEL_SPEED.FAST) === catalogId) {
      return { model, fast: true };
    }
  }

  return undefined;
}

/**
 * The model a Cursor agent on the catalog id and effort given runs, as
 * Cursor's SDK takes it (`ModelSelection`): Cursor's id, every parameter
 * the model pins, its effort under the parameter it spells it by where it
 * lists the effort, `fast` where it takes it, true for the fast version,
 * and Max Mode for a Max Mode model. None for an id that is not one of the
 * Cursor models given.
 */
export function cursorModelSelectionOf(
  cursorModels: readonly CursorModel[],
  catalogId: string,
  effort: string,
): CursorModelSelection | undefined {
  const found = cursorModelAt(cursorModels, catalogId);

  if (found === undefined) return undefined;
  const { model } = found;

  const effortParam =
    model.effort?.values.includes(effort) === true
      ? [{ id: model.effort.parameter, value: effort }]
      : [];

  const fastParam = model.fast ? [{ id: CURSOR_PARAMETER.FAST, value: String(found.fast) }] : [];
  const params = [...model.pinned, ...effortParam, ...fastParam];

  return {
    id: model.cursorId,
    ...(params.length === 0 ? undefined : { params }),
    ...(model.maxMode ? { maxMode: true } : undefined),
  };
}
